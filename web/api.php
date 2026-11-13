<?php
/**
 * Global Supply Chain Route Optimizer — Backend API Gateway
 *
 * Requirements:
 * 1. Accepts POST request with JSON body { node_id, delay_hours, event_type }
 * 2. Uses prepared statements to log disruption events and update congestion_delay in MySQL
 * 3. Writes current non-zero congestion states to config/congestion.json
 * 4. Triggers compiled C++ binary (route_optimizer.exe) using safe, parameterized execution
 * 5. Uses file locking to ensure safe, non-colliding execution and atomic reading of output/latest_routes.json
 * 6. Returns JSON response with Content-Type: application/json
 */

header('Content-Type: application/json; charset=utf-8');
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: GET, POST, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(200);
    exit(0);
}

// =============================================================================
// PATHS & ENVIRONMENT CONFIGURATION
// =============================================================================
$rootDir = realpath(__DIR__ . '/..');
$dataDir = $rootDir . '/data';
$configDir = $rootDir . '/config';
$outputDir = $rootDir . '/output';
$buildDir = $rootDir . '/build';

if (!is_dir($configDir)) {
    @mkdir($configDir, 0777, true);
}
if (!is_dir($outputDir)) {
    @mkdir($outputDir, 0777, true);
}

$nodesCSV = $dataDir . '/nodes.csv';
$edgesCSV = $dataDir . '/edges.csv';
$congestionConfigFile = $configDir . '/congestion.json';
$latestRoutesOutputFile = $outputDir . '/latest_routes.json';
$lockFile = $outputDir . '/engine.lock';

// Locate compiled binary (Windows .exe or Linux ELF)
$binaryPath = null;
$possibleBinaries = [
    $buildDir . '/route_optimizer.exe',
    $buildDir . '/route_optimizer',
    $buildDir . '/Release/route_optimizer.exe',
    $buildDir . '/Debug/route_optimizer.exe',
    $rootDir . '/bin/route_optimizer'
];

foreach ($possibleBinaries as $candidate) {
    if (file_exists($candidate)) {
        $binaryPath = realpath($candidate);
        break;
    }
}

// Database Credentials from Environment or Defaults
$dbHost = getenv('DB_HOST') ?: '127.0.0.1';
$dbPort = getenv('DB_PORT') ?: '3306';
$dbUser = getenv('DB_USER') ?: 'root';
$dbPass = getenv('DB_PASS') ?: '';
$dbName = getenv('DB_NAME') ?: 'route_optimizer_db';

/**
 * Helper: Establish PDO MySQL connection (with graceful degradation if offline)
 */
function getDatabaseConnection($host, $port, $user, $pass, $name) {
    try {
        $dsn = "mysql:host={$host};port={$port};dbname={$name};charset=utf8mb4";
        $pdo = new PDO($dsn, $user, $pass, [
            PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
            PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
            PDO::ATTR_TIMEOUT => 2
        ]);
        return $pdo;
    } catch (Exception $e) {
        return null;
    }
}

$pdo = getDatabaseConnection($dbHost, $dbPort, $dbUser, $dbPass, $dbName);

// =============================================================================
// ROUTING & REQUEST DISPATCH
// =============================================================================
$requestMethod = $_SERVER['REQUEST_METHOD'];
$action = $_GET['action'] ?? ($requestMethod === 'POST' ? 'trigger_disruption' : 'get_network');

// Helper: Parse JSON POST Body
function getJSONInput() {
    $raw = file_get_contents('php://input');
    if (empty($raw)) return [];
    $data = json_decode($raw, true);
    return is_array($data) ? $data : [];
}

/**
 * Synchronize MySQL congestion state or local JSON cache to config/congestion.json
 */
function syncCongestionConfigFile($pdo, $configFile, $disruptedNodeId = null, $delayHours = null) {
    $delays = [];

    // 1. If MySQL is connected, query active non-zero congestion delays
    if ($pdo !== null) {
        try {
            $stmt = $pdo->prepare("SELECT id, congestion_delay FROM nodes WHERE congestion_delay > 0");
            $stmt->execute();
            while ($row = $stmt->fetch()) {
                $delays[strval($row['id'])] = floatval($row['congestion_delay']);
            }
        } catch (Exception $e) {
            // Fallback to cache
        }
    }

    // 2. If MySQL was offline or empty and we have a specific update, use local state
    if ($disruptedNodeId !== null && $delayHours !== null) {
        if ($delayHours > 0) {
            $delays[strval($disruptedNodeId)] = floatval($delayHours);
        } else {
            unset($delays[strval($disruptedNodeId)]);
        }
    }

    // Write atomically to config/congestion.json
    $tempConfigFile = $configFile . '.tmp';
    file_put_contents($tempConfigFile, json_encode($delays, JSON_PRETTY_PRINT));
    @rename($tempConfigFile, $configFile);

    return $delays;
}

switch ($action) {
    // -------------------------------------------------------------------------
    // 1. TRIGGER DISRUPTION (Core Requirement 3)
    // -------------------------------------------------------------------------
    case 'trigger_disruption':
    case 'optimize':
        $input = getJSONInput();

        // Validate and sanitize parameters (Prevent SQL / Shell Injections)
        $nodeId = isset($input['node_id']) ? intval($input['node_id']) : 56332;
        $delayHours = isset($input['delay_hours']) ? max(0.0, min(720.0, floatval($input['delay_hours']))) : 48.0;
        $eventType = isset($input['event_type']) ? preg_replace('/[^a-zA-Z0-9_-]/', '', strtolower(trim($input['event_type']))) : 'port_strike';
        
        $originId = isset($input['origin_id']) ? intval($input['origin_id']) : 55196;
        $destId = isset($input['dest_id']) ? intval($input['dest_id']) : 21998;
        $engine = isset($input['engine']) ? strtoupper(trim($input['engine'])) : 'OPENMP';
        $popSize = isset($input['pop_size']) ? max(50, min(20000, intval($input['pop_size']))) : 1000;
        $generations = isset($input['generations']) ? max(5, min(500, intval($input['generations']))) : 20;

        // 1. Update MySQL with Prepared Statements (Requirement 3)
        $dbUpdated = false;
        if ($pdo !== null) {
            try {
                // Log event
                $stmtLog = $pdo->prepare("INSERT INTO congestion_events (node_id, delay_hours, event_type) VALUES (?, ?, ?)");
                $stmtLog->execute([$nodeId, $delayHours, $eventType]);

                // Update node congestion delay
                $stmtUpdate = $pdo->prepare("UPDATE nodes SET congestion_delay = ? WHERE id = ?");
                $stmtUpdate->execute([$delayHours, $nodeId]);
                $dbUpdated = true;
            } catch (Exception $e) {
                error_log("[MySQL Warning] Disruption update failed: " . $e->getMessage());
            }
        }

        // 2. Write dynamic congestion state to config/congestion.json (Requirement 3)
        $activeDelays = syncCongestionConfigFile($pdo, $congestionConfigFile, $nodeId, $delayHours);

        // 3. Ensure binary exists
        if (!$binaryPath || !file_exists($binaryPath)) {
            http_response_code(500);
            echo json_encode([
                'status' => 'error',
                'message' => 'Route optimizer C++ binary not found. Run "cmake --build build" to compile.'
            ]);
            exit;
        }

        // 4. Safe, Parameterized Subprocess Invocation with File Locking (Requirement 3)
        $lockHandle = fopen($lockFile, 'w+');
        if (!flock($lockHandle, LOCK_EX)) {
            http_response_code(503);
            echo json_encode(['status' => 'error', 'message' => 'Optimizer engine is busy processing another request.']);
            fclose($lockHandle);
            exit;
        }

        // Build safe command using strict escaping
        $cmdArgs = [
            escapeshellcmd($binaryPath),
            '--origin', escapeshellarg(strval($originId)),
            '--dest', escapeshellarg(strval($destId)),
            '--pop', escapeshellarg(strval($popSize)),
            '--gen', escapeshellarg(strval($generations)),
            '--congestion', escapeshellarg($congestionConfigFile),
            '--output', escapeshellarg($latestRoutesOutputFile)
        ];

        if ($engine === 'CUDA') {
            $cmdArgs[] = '--cuda';
        }

        $commandStr = implode(' ', $cmdArgs) . ' 2>&1';

        $cmdStartTime = microtime(true);
        $outputLines = [];
        $exitCode = 0;
        exec($commandStr, $outputLines, $exitCode);
        $execDurationMs = round((microtime(true) - $cmdStartTime) * 1000.0, 2);

        // 5. Read output/latest_routes.json and release lock
        $routeResult = null;
        if (file_exists($latestRoutesOutputFile)) {
            $jsonContent = file_get_contents($latestRoutesOutputFile);
            $routeResult = json_decode($jsonContent, true);
        }

        // 6. Record completed route in route_history table
        if ($pdo !== null && $routeResult !== null && isset($routeResult['total_cost'])) {
            try {
                $stmtHist = $pdo->prepare("INSERT INTO route_history 
                    (source_id, dest_id, total_cost, total_distance_km, total_transit_hours, fuel_cost, mode_switches, path_json, execution_time_ms, engine) 
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)");
                $stmtHist->execute([
                    $originId,
                    $destId,
                    $routeResult['total_cost'] ?? 0.0,
                    $routeResult['total_distance_km'] ?? 0.0,
                    $routeResult['total_transit_hours'] ?? 0.0,
                    $routeResult['fuel_cost'] ?? 0.0,
                    $routeResult['mode_switches'] ?? 0,
                    json_encode($routeResult['path'] ?? []),
                    $execDurationMs,
                    $engine
                ]);
            } catch (Exception $e) {
                // Ignore history insert errors
            }
        }

        flock($lockHandle, LOCK_UN);
        fclose($lockHandle);

        if ($routeResult === null) {
            http_response_code(500);
            echo json_encode([
                'status' => 'error',
                'message' => 'C++ engine execution failed or output file could not be read.',
                'exit_code' => $exitCode,
                'raw_output' => array_slice($outputLines, -15)
            ]);
            exit;
        }

        // Return optimal route result with disruption context
        $routeResult['disruption_applied'] = [
            'node_id' => $nodeId,
            'delay_hours' => $delayHours,
            'event_type' => $eventType,
            'db_synced' => $dbUpdated,
            'active_congestion_count' => count($activeDelays)
        ];
        $routeResult['api_execution_time_ms'] = $execDurationMs;

        echo json_encode($routeResult, JSON_PRETTY_PRINT);
        break;

    // -------------------------------------------------------------------------
    // 2. GET NETWORK TOPOLOGY & ACTIVE DISRUPTIONS
    // -------------------------------------------------------------------------
    case 'get_network':
    case 'get_graph':
        $nodes = [];
        $keyPorts = [];
        $keyHubs = [];

        if (file_exists($nodesCSV)) {
            if (($h = fopen($nodesCSV, 'r')) !== FALSE) {
                $header = fgetcsv($h, 1000, ',');
                while (($row = fgetcsv($h, 1000, ',')) !== FALSE) {
                    if (count($header) === count($row)) {
                        $data = array_combine($header, $row);
                        $id = intval($data['id']);
                        $type = trim($data['node_type']);
                        $item = [
                            'id' => $id,
                            'name' => trim($data['name']),
                            'lat' => floatval($data['lat']),
                            'lon' => floatval($data['lon']),
                            'region' => trim($data['region']),
                            'node_type' => $type
                        ];
                        if (strpos($item['name'], 'Port') !== false || strpos($item['name'], 'Strait') !== false || strpos($item['name'], 'Canal') !== false || strpos($item['name'], 'Portal') !== false || strpos($item['name'], 'Channel') !== false) {
                            $keyPorts[] = $item;
                        }
                    }
                }
                fclose($h);
            }
        }

        // Active congestion states
        $activeEvents = [];
        if ($pdo !== null) {
            try {
                $stmt = $pdo->prepare("SELECT e.node_id, e.delay_hours, e.event_type, e.created_at, n.name 
                                       FROM congestion_events e 
                                       JOIN nodes n ON e.node_id = n.id 
                                       ORDER BY e.id DESC LIMIT 10");
                $stmt->execute();
                $activeEvents = $stmt->fetchAll();
            } catch (Exception $e) {}
        }

        $activeCongestionMap = [];
        if (file_exists($congestionConfigFile)) {
            $activeCongestionMap = json_decode(file_get_contents($congestionConfigFile), true) ?: [];
        }

        echo json_encode([
            'status' => 'success',
            'mysql_connected' => ($pdo !== null),
            'binary_path' => $binaryPath,
            'key_hubs' => $keyHubs,
            'key_ports' => $keyPorts,
            'active_congestion' => $activeCongestionMap,
            'recent_events' => $activeEvents
        ], JSON_PRETTY_PRINT);
        break;

    // -------------------------------------------------------------------------
    // 3. GET LATEST COMPUTED ROUTE
    // -------------------------------------------------------------------------
    case 'get_latest_route':
        if (file_exists($latestRoutesOutputFile)) {
            echo file_get_contents($latestRoutesOutputFile);
        } else {
            http_response_code(404);
            echo json_encode(['status' => 'not_found', 'message' => 'No optimization run recorded yet.']);
        }
        break;

    // -------------------------------------------------------------------------
    // 4. RESET CONGESTION DELAYS
    // -------------------------------------------------------------------------
    case 'reset_congestion':
        if ($pdo !== null) {
            try {
                $pdo->exec("UPDATE nodes SET congestion_delay = 0.0");
                $pdo->exec("INSERT INTO congestion_events (node_id, delay_hours, event_type) VALUES (0, 0.0, 'system_reset')");
            } catch (Exception $e) {}
        }
        file_put_contents($congestionConfigFile, json_encode(new stdClass()));
        echo json_encode(['status' => 'success', 'message' => 'All congestion delays reset to 0 hours.']);
        break;

    default:
        http_response_code(400);
        echo json_encode(['status' => 'error', 'message' => 'Invalid action parameter.']);
        break;
}
