#include "graph.hpp"
#include "astar.hpp"
#include "ga.hpp"
#include "mpi_partition.hpp"
#include "fitness_kernel.hpp"
#include "marine_conditions.hpp"
#include <cmath>

#include <iostream>
#include <iomanip>
#include <fstream>
#include <sstream>
#include <string>
#include <chrono>
#include <ctime>
#include <filesystem>
#include <cstdlib>
#include <vector>
#include <unordered_set>

namespace fs = std::filesystem;

static std::string escapeJSON(const std::string& value) {
    std::ostringstream escaped;
    for (unsigned char ch : value) {
        if (ch == '"' || ch == '\\') {
            escaped << '\\' << ch;
        } else if (ch < 32) {
            escaped << "\\u" << std::hex << std::setw(4) << std::setfill('0') << static_cast<int>(ch);
        } else {
            escaped << ch;
        }
    }
    return escaped.str();
}

static bool writeOutputJSON(
    const std::string& output_path,
    int origin_id,
    int dest_id,
    const RouteOptimizer::MultimodalGraph& graph,
    const std::vector<int>& path,
    double total_cost,
    double total_distance_km,
    double total_transit_hours,
    double fuel_cost,
    int mode_switches,
    double duration_ms,
    const std::string& engine_name,
    bool is_tsp = false,
    const std::vector<int>& tsp_tour = {}
) {
    try {
        fs::path p(output_path);
        if (p.has_parent_path()) {
            fs::create_directories(p.parent_path());
        }

        std::string tmp_path = output_path + ".tmp";
        std::ofstream out(tmp_path);
        if (!out.is_open()) {
            std::cerr << "[Output Warning] Unable to open " << tmp_path << " for writing.\n";
            return false;
        }

        auto now = std::chrono::system_clock::now();
        std::time_t now_c = std::chrono::system_clock::to_time_t(now);
        char buf[64];
        std::strftime(buf, sizeof(buf), "%Y-%m-%dT%H:%M:%SZ", std::gmtime(&now_c));

        const auto* orig_node = graph.getNode(origin_id);
        const auto* dest_node = graph.getNode(dest_id);

        out << "{\n";
        out << "  \"status\": \"" << (!path.empty() ? "success" : "failed") << "\",\n";
        out << "  \"timestamp\": \"" << buf << "\",\n";
        out << "  \"engine\": \"" << engine_name << "\",\n";
        out << "  \"is_tsp\": " << (is_tsp ? "true" : "false") << ",\n";
        out << "  \"origin_id\": " << origin_id << ",\n";
        out << "  \"origin_name\": \"" << escapeJSON(orig_node ? orig_node->name : "Origin") << "\",\n";
        out << "  \"dest_id\": " << dest_id << ",\n";
        out << "  \"dest_name\": \"" << escapeJSON(dest_node ? dest_node->name : "Destination") << "\",\n";
        out << "  \"total_cost\": " << std::fixed << std::setprecision(2) << total_cost << ",\n";
        out << "  \"total_distance_km\": " << std::fixed << std::setprecision(2) << total_distance_km << ",\n";
        out << "  \"total_transit_hours\": " << std::fixed << std::setprecision(2) << total_transit_hours << ",\n";
        out << "  \"fuel_cost\": " << std::fixed << std::setprecision(2) << fuel_cost << ",\n";
        out << "  \"mode_switches\": " << mode_switches << ",\n";
        out << "  \"execution_time_ms\": " << std::fixed << std::setprecision(2) << duration_ms << ",\n";
        out << "  \"path_length\": " << path.size() << ",\n";

        if (is_tsp && !tsp_tour.empty()) {
            out << "  \"tsp_tour\": [";
            for (size_t i = 0; i < tsp_tour.size(); ++i) {
                out << tsp_tour[i] << (i + 1 < tsp_tour.size() ? ", " : "");
            }
            out << "],\n";

            out << "  \"tsp_waypoints\": [\n";
            for (size_t i = 0; i < tsp_tour.size(); ++i) {
                const auto* node = graph.getNode(tsp_tour[i]);
                if (node) {
                    out << "    {\"id\": " << node->id 
                        << ", \"name\": \"" << escapeJSON(node->name) << "\""
                        << ", \"lat\": " << std::fixed << std::setprecision(6) << node->lat
                        << ", \"lon\": " << std::fixed << std::setprecision(6) << node->lon
                        << ", \"region\": \"" << escapeJSON(node->region) << "\""
                        << "}" << (i + 1 < tsp_tour.size() ? "," : "") << "\n";
                }
            }
            out << "  ],\n";
        }
        
        out << "  \"path\": [";
        for (size_t i = 0; i < path.size(); ++i) {
            out << path[i] << (i + 1 < path.size() ? ", " : "");
        }
        out << "],\n";

        out << "  \"nodes\": [\n";
        for (size_t i = 0; i < path.size(); ++i) {
            const auto* node = graph.getNode(path[i]);
            if (node) {
                out << "    {\"id\": " << node->id 
                    << ", \"name\": \"" << escapeJSON(node->name) << "\""
                    << ", \"lat\": " << std::fixed << std::setprecision(6) << node->lat
                    << ", \"lon\": " << std::fixed << std::setprecision(6) << node->lon
                    << ", \"region\": \"" << escapeJSON(node->region) << "\""
                    << ", \"node_type\": \"" << RouteOptimizer::nodeTypeToString(node->node_type) << "\""
                    << ", \"congestion_delay\": " << std::fixed << std::setprecision(2) << node->congestion_delay
                    << "}" << (i + 1 < path.size() ? "," : "") << "\n";
            }
        }
        out << "  ]\n";
        out << "}\n";
        out.close();
        if (!out) {
            fs::remove(tmp_path);
            std::cerr << "[Output Error] Failed to write " << tmp_path << "\n";
            return false;
        }
        fs::rename(tmp_path, output_path);
        std::cout << "[Output] Latest optimal route written to " << output_path << "\n";
        return true;
    } catch (const std::exception& ex) {
        std::cerr << "[Output Error] Failed to write JSON output: " << ex.what() << "\n";
        return false;
    }
}

static std::vector<int> parseWaypointsList(const std::string& s) {
    std::vector<int> result;
    std::stringstream ss(s);
    std::string item;
    while (std::getline(ss, item, ',')) {
        size_t consumed = 0;
        int waypoint = std::stoi(item, &consumed);
        if (consumed != item.size() || waypoint < 0) {
            throw std::invalid_argument("Invalid waypoint ID: " + item);
        }
        result.push_back(waypoint);
    }
    if (result.empty() || s.back() == ',') throw std::invalid_argument("Invalid waypoint list");
    return result;
}

int main(int argc, char* argv[]) try {
    // 1. Initialize MPI Controller
    RouteOptimizer::MPIController mpi(&argc, &argv);
    int world_size = mpi.getWorldSize();

    if (mpi.isRoot()) {
        std::cout << "========================================================================\n";
        std::cout << "  GLOBAL MARINE ROUTE OPTIMIZER (A* Search + OpenMP + CUDA GPU Engine)  \n";
        std::cout << "========================================================================\n";
        std::cout << "  MPI Process Count : " << world_size << " rank(s)\n";
    }

    // Default parameters
    std::string nodes_path = "data/nodes.csv";
    std::string edges_path = "data/edges.csv";
    std::string congestion_path = "config/congestion.json";
    std::string marine_path;
    std::string matrix_bin_path;
    std::string output_path = "output/latest_routes.json";
    std::string algorithm = "astar"; // Default: deterministic A* fallback
    int origin_id = 55196;          // Port of Shanghai (APAC)
    int dest_id = 21998;            // Port of Rotterdam (EU)
    bool is_tsp_mode = false;
    std::vector<int> custom_waypoints;
    bool run_benchmark = false;

    RouteOptimizer::GAConfig ga_config;
    ga_config.population_size = 1000;
    ga_config.max_generations = 50;
    ga_config.mutation_rate = 0.12;
    ga_config.fuel_rate_sea = 0.6;
    ga_config.fuel_rate_road = 1.4;
    ga_config.mode_switch_penalty = 50.0;
    ga_config.tournament_size = 4;
    ga_config.use_cuda = false;

    // Parse CLI arguments
    for (int i = 1; i < argc; ++i) {
        std::string arg = argv[i];
        if ((arg == "--algorithm" || arg == "-A") && i + 1 < argc) {
            algorithm = argv[++i];
        } else if ((arg == "--engine" || arg == "-E") && i + 1 < argc) {
            std::string eng = argv[++i];
            if (eng == "ASTAR" || eng == "astar") algorithm = "astar";
            else if (eng == "OPENMP" || eng == "openmp") { algorithm = "ga"; ga_config.use_cuda = false; }
            else if (eng == "CUDA" || eng == "cuda") { algorithm = "ga"; ga_config.use_cuda = true; }
            else if (eng == "MPI" || eng == "mpi") { algorithm = "mpi"; }
            else if (eng == "TSP" || eng == "tsp") { is_tsp_mode = true; algorithm = "tsp"; }
            else { throw std::invalid_argument("Unknown engine: " + eng); }
        } else if (arg == "--tsp") {
            is_tsp_mode = true;
        } else if ((arg == "--waypoints" || arg == "-W") && i + 1 < argc) {
            custom_waypoints = parseWaypointsList(argv[++i]);
            is_tsp_mode = true;
        } else if ((arg == "--matrix" || arg == "-M") && i + 1 < argc) {
            matrix_bin_path = argv[++i];
        } else if ((arg == "--nodes" || arg == "-n") && i + 1 < argc) {
            nodes_path = argv[++i];
        } else if ((arg == "--edges" || arg == "-e") && i + 1 < argc) {
            edges_path = argv[++i];
        } else if ((arg == "--congestion" || arg == "--disruption") && i + 1 < argc) {
            congestion_path = argv[++i];
        } else if (arg == "--no-mode-switch-penalty") {
            ga_config.mode_switch_penalty = 0;
        } else if (arg == "--transfer-cost" && i + 1 < argc) {
            ga_config.mode_switch_penalty = std::stod(argv[++i]);
            if (!std::isfinite(ga_config.mode_switch_penalty) || ga_config.mode_switch_penalty < 0) {
                throw std::invalid_argument("Transfer cost must be nonnegative and finite");
            }
        } else if (arg == "--time-cost" && i + 1 < argc) {
            ga_config.time_cost_per_hour = std::stod(argv[++i]);
            if (!std::isfinite(ga_config.time_cost_per_hour) || ga_config.time_cost_per_hour < 0) {
                throw std::invalid_argument("Time cost must be nonnegative and finite");
            }
        } else if (arg == "--sea-rate" && i + 1 < argc) {
            ga_config.fuel_rate_sea = std::stod(argv[++i]);
            if (!std::isfinite(ga_config.fuel_rate_sea) || ga_config.fuel_rate_sea <= 0) {
                throw std::invalid_argument("Sea rate must be positive and finite");
            }
        } else if (arg == "--road-rate" && i + 1 < argc) {
            ga_config.fuel_rate_road = std::stod(argv[++i]);
            if (!std::isfinite(ga_config.fuel_rate_road) || ga_config.fuel_rate_road <= 0) {
                throw std::invalid_argument("Road rate must be positive and finite");
            }
        } else if (arg == "--marine-conditions" && i + 1 < argc) {
            marine_path = argv[++i];
        } else if ((arg == "--output" || arg == "-O") && i + 1 < argc) {
            output_path = argv[++i];
        } else if ((arg == "--origin" || arg == "-o") && i + 1 < argc) {
            origin_id = std::stoi(argv[++i]);
        } else if ((arg == "--dest" || arg == "-d") && i + 1 < argc) {
            dest_id = std::stoi(argv[++i]);
        } else if ((arg == "--pop" || arg == "-p") && i + 1 < argc) {
            ga_config.population_size = static_cast<size_t>(std::stoul(argv[++i]));
        } else if ((arg == "--gen" || arg == "-g") && i + 1 < argc) {
            ga_config.max_generations = static_cast<size_t>(std::stoul(argv[++i]));
        } else if ((arg == "--mutation" || arg == "-m") && i + 1 < argc) {
            ga_config.mutation_rate = std::stod(argv[++i]);
        } else if (arg == "--cuda" || arg == "-c") {
            ga_config.use_cuda = true;
        } else if (arg == "--astar") {
            algorithm = "astar";
        } else if (arg == "--cuda-benchmark" || arg == "--gpu-bench") {
            run_benchmark = true;
            algorithm = "ga";
            ga_config.use_cuda = true;
        } else if (arg == "--benchmark" || arg == "-b") {
            run_benchmark = true;
        } else if ((arg == "--threads" || arg == "-t") && i + 1 < argc) {
            ga_config.num_threads = std::stoi(argv[++i]);
        } else if (arg == "--help" || arg == "-h") {
            if (mpi.isRoot()) {
                std::cout << "Usage: " << argv[0] << " [options]\n"
                          << "Options:\n"
                          << "  -A, --algorithm <astar|ga|tsp> Routing algorithm (default: astar)\n"
                          << "  --tsp                          Run TSP Permutation Optimizer with OX1 & Swap Mutation\n"
                          << "  -W, --waypoints <id1,id2,...>  Waypoint sequence for TSP routing\n"
                          << "  -M, --matrix <file.bin>        Binary dynamic cost matrix path\n"
                          << "  -E, --engine <ASTAR|OPENMP|CUDA|MPI|TSP> Compute engine\n"
                          << "  -o, --origin <id>              Origin node ID (default: 55196 [Shanghai])\n"
                          << "  -d, --dest <id>                Destination node ID (default: 21998 [Rotterdam])\n"
                          << "  --congestion <file>            JSON config file with dynamic congestion delays\n"
                          << "  -O, --output <file>            Output JSON result file\n"
                          << "  -p, --pop <size>               GA Population size (default: 1000)\n"
                          << "  -g, --gen <count>              GA Max generations (default: 50)\n"
                          << "  -c, --cuda                     Enable CUDA GPU acceleration\n"
                          << "  -t, --threads <n>              OpenMP thread count\n";
            }
            return 0;
        } else {
            throw std::invalid_argument("Unknown option or missing argument: " + arg);
        }
    }

    const bool distributed = algorithm == "mpi";
    if (distributed && (!mpi.isMPIActive() || world_size < 2)) {
        throw std::invalid_argument("MPI routing requires an MPI-enabled build launched with at least two ranks");
    }
    if (!distributed && world_size > 1) {
        throw std::invalid_argument("Select --engine mpi for multi-rank execution");
    }
    if (distributed) {
        ga_config.random_seed += static_cast<unsigned int>(mpi.getRank());
        ga_config.use_cuda = false;
        ga_config.verbose_logging = mpi.isRoot();
    }
    if (algorithm != "astar" && algorithm != "ASTAR" && algorithm != "ga" &&
        algorithm != "tsp" && algorithm != "TSP" && !distributed) {
        throw std::invalid_argument("Unknown algorithm: " + algorithm);
    }

    // Auto-locate files relative to executable directory or parent
    if (!fs::exists(nodes_path) || !fs::exists(edges_path)) {
        std::string parent_nodes = "../" + nodes_path;
        std::string parent_edges = "../" + edges_path;
        if (fs::exists(parent_nodes) && fs::exists(parent_edges)) {
            nodes_path = parent_nodes;
            edges_path = parent_edges;
        }
    }

    if (ga_config.use_cuda && !RouteOptimizer::CUDAFitnessEvaluator::hasDevice()) {
        std::cerr << "[CUDA] GPU unavailable. Using OpenMP CPU fitness evaluation.\n";
        ga_config.use_cuda = false;
    }

    // Load full multimodal graph
    RouteOptimizer::MultimodalGraph full_graph;
    if (!full_graph.loadFromCSV(nodes_path, edges_path)) {
        if (mpi.isRoot()) {
            std::cerr << "[Error] Failed to load dataset from " << nodes_path << " and " << edges_path << ".\n";
        }
        return 1;
    }

    // Load dynamic congestion delays
    if (fs::exists(congestion_path)) {
        full_graph.loadCongestionJSON(congestion_path);
    } else if (fs::exists("../" + congestion_path)) {
        full_graph.loadCongestionJSON("../" + congestion_path);
    }

    if (!marine_path.empty()) {
        std::ifstream input(marine_path);
        if (!input) throw std::runtime_error("Cannot open marine conditions");
        std::vector<RouteOptimizer::MarineZone> zones;
        RouteOptimizer::MarineZone zone{};
        while (input >> zone.lat >> zone.lon >> zone.radius_km >> zone.delay_hours_per_km
                     >> zone.east_kmh >> zone.north_kmh) {
            if (!std::isfinite(zone.lat) || std::abs(zone.lat) > 90 ||
                !std::isfinite(zone.lon) || std::abs(zone.lon) > 180 ||
                !std::isfinite(zone.radius_km) || zone.radius_km <= 0 ||
                !std::isfinite(zone.delay_hours_per_km) || zone.delay_hours_per_km < 0 ||
                !std::isfinite(zone.east_kmh) || !std::isfinite(zone.north_kmh)) {
                throw std::runtime_error("Invalid marine zone");
            }
            zones.push_back(zone);
        }
        if (!input.eof() || zones.empty()) throw std::runtime_error("Invalid marine conditions file");
        std::vector<RouteOptimizer::MarineLane> lanes;
        for (const auto& edge : full_graph.getAllEdges()) {
            const auto* from = full_graph.getNode(edge.source_id);
            const auto* to = full_graph.getNode(edge.dest_id);
            const double lat = (from->lat + to->lat) / 2;
            const double longitude_delta = std::remainder(to->lon - from->lon, 360.0);
            const double lon = std::remainder(from->lon + longitude_delta / 2, 360.0);
            lanes.push_back({lat, lon,
                longitude_delta * 111.195 * std::cos(lat * 0.017453292519943295),
                (to->lat - from->lat) * 111.195,
                edge.mode == RouteOptimizer::TransportMode::SEA ? edge.distance_km : 0,
                edge.base_transit_hours});
        }
#ifdef _OPENMP
        if (ga_config.num_threads > 0) omp_set_num_threads(ga_config.num_threads);
#endif
        full_graph.setLaneTimes(RouteOptimizer::marineLaneTimes(lanes, zones, ga_config.use_cuda));
        std::cout << "[Marine conditions] Reweighted " << lanes.size() << " lanes using "
                  << (ga_config.use_cuda ? "CUDA" : "CPU") << ".\n";
    }

    // =========================================================================
    // 0. TSP PERMUTATION GA ROUTING (Permutation Representation + OX1 + Swap Mutation)
    // =========================================================================
    if (is_tsp_mode || algorithm == "tsp" || algorithm == "TSP") {
        if (custom_waypoints.empty()) {
            custom_waypoints = {origin_id, 49102, 45250, 49452, 21473, dest_id};
        }
        if (custom_waypoints.size() < 2) {
            std::cerr << "[Error] A tour requires at least two waypoints.\n";
            return 1;
        }
        std::unordered_set<int> unique_waypoints(custom_waypoints.begin(), custom_waypoints.end());
        if (unique_waypoints.size() != custom_waypoints.size()) {
            std::cerr << "[Error] A tour requires distinct waypoints.\n";
            return 1;
        }
        for (int waypoint : custom_waypoints) {
            if (!full_graph.getNode(waypoint)) {
                std::cerr << "[Error] Unknown waypoint: " << waypoint << "\n";
                return 1;
            }
        }

        if (mpi.isRoot()) {
            std::cout << "  Mode               : TSP Permutation Optimization (OX1 + Swap Mutation)\n";
            std::cout << "  Waypoints to Order : " << custom_waypoints.size() << " ports\n";
            std::cout << "  Start Point (Lock0): #" << custom_waypoints.front() << "\n";
            std::cout << "  End Point (LockEnd): #" << custom_waypoints.back() << "\n";
            std::cout << "========================================================================\n\n";
        }

        // Attempt to load binary dynamic cost matrix or generate from graph
        RouteOptimizer::DynamicCostMatrix cost_matrix;
        if (!matrix_bin_path.empty() && fs::exists(matrix_bin_path)) {
            cost_matrix = RouteOptimizer::DynamicCostMatrix::loadFromBinary(matrix_bin_path);
        } else if (!matrix_bin_path.empty() && fs::exists("../" + matrix_bin_path)) {
            cost_matrix = RouteOptimizer::DynamicCostMatrix::loadFromBinary("../" + matrix_bin_path);
        }

        // Check if all custom_waypoints are present in the matrix
        bool all_in_matrix = (cost_matrix.node_count > 0);
        for (int wp : custom_waypoints) {
            if (cost_matrix.getIndex(wp) == -1) {
                all_in_matrix = false;
                break;
            }
        }

        if (!all_in_matrix) {
            std::cout << "[TSP Ingestion] Dynamic matrix missing one or more waypoints, computing direct graph matrix for waypoints...\n";
            cost_matrix = RouteOptimizer::DynamicCostMatrix::createFromGraph(
                full_graph, custom_waypoints, ga_config.fuel_rate_sea, ga_config.fuel_rate_road,
                ga_config.time_cost_per_hour, ga_config.mode_switch_penalty);
        }

        auto tsp_t_start = std::chrono::high_resolution_clock::now();

        RouteOptimizer::GeneticAlgorithmOptimizer tsp_opt(full_graph, ga_config);
        auto tsp_sol = tsp_opt.optimizeTSPPermutation(custom_waypoints, cost_matrix);
        if (distributed) tsp_sol = mpi.bestRoute(tsp_sol);
        if (!tsp_sol.score.is_valid || tsp_sol.path.size() != custom_waypoints.size()) {
            std::cerr << "[Error] No valid waypoint tour found.\n";
            return 1;
        }

        auto tsp_t_end = std::chrono::high_resolution_clock::now();
        double duration_ms = std::chrono::duration<double, std::milli>(tsp_t_end - tsp_t_start).count();

        // Stitch the actual physical sea lane path between consecutive ports in the optimized tour
        std::vector<int> full_sea_path;
        RouteOptimizer::AStarOptimizer astar(full_graph, ga_config.fuel_rate_sea, ga_config.fuel_rate_road,
                                             37.0, ga_config.time_cost_per_hour, ga_config.mode_switch_penalty);
        double total_actual_dist = 0.0;
        double total_actual_cost = 0.0;
        double total_actual_time = 0.0;
        double total_actual_fuel = 0.0;
        int total_switches = 0;
        auto previous_mode = RouteOptimizer::TransportMode::UNKNOWN;

        for (size_t i = 0; i + 1 < tsp_sol.path.size(); ++i) {
            int leg_start = tsp_sol.path[i];
            int leg_end = tsp_sol.path[i + 1];
            auto leg_res = astar.findOptimalRoute(leg_start, leg_end);
            if (leg_res.is_valid && !leg_res.path.empty()) {
                total_actual_dist += leg_res.total_distance_km;
                total_actual_cost += leg_res.total_cost;
                total_switches += leg_res.mode_switches;
                if (previous_mode != RouteOptimizer::TransportMode::UNKNOWN && previous_mode != leg_res.first_mode) {
                    ++total_switches;
                    total_actual_cost += ga_config.mode_switch_penalty;
                }
                previous_mode = leg_res.last_mode;
                total_actual_time += leg_res.total_transit_hours;
                total_actual_fuel += leg_res.fuel_cost;
                for (size_t k = (i == 0 ? 0 : 1); k < leg_res.path.size(); ++k) {
                    full_sea_path.push_back(leg_res.path[k]);
                }
            } else {
                std::cerr << "[Error] No navigable leg from " << leg_start << " to " << leg_end << ".\n";
                return 1;
            }
        }

        if (mpi.isRoot()) {
            return writeOutputJSON(
                output_path,
                custom_waypoints.front(),
                custom_waypoints.back(),
                full_graph,
                full_sea_path,
                total_actual_cost,
                total_actual_dist,
                total_actual_time,
                total_actual_fuel,
                total_switches,
                duration_ms,
                distributed ? "MPI TSP (" + std::to_string(world_size) + " ranks)" :
                    ga_config.use_cuda ? "CUDA GPU TSP (OX1)" : "OpenMP CPU TSP (OX1)",
                true,
                tsp_sol.path
            ) ? 0 : 1;
        }

        return 0;
    }

    const RouteOptimizer::Node* origin_node = full_graph.getNode(origin_id);
    const RouteOptimizer::Node* dest_node = full_graph.getNode(dest_id);

    if (!origin_node || !dest_node) {
        if (mpi.isRoot()) std::cerr << "[Error] Invalid origin or destination node ID (" << origin_id << " -> " << dest_id << ").\n";
        return 1;
    }

    if (mpi.isRoot()) {
        std::cout << "  Selected Algorithm : " << (algorithm == "astar" ? "Deterministic A* (Optimal Physical Heuristic)" : "Parallel Genetic Algorithm") << "\n";
        std::cout << "  Origin Seaport     : #" << origin_id << " (" << origin_node->name << ", Region: " << origin_node->region << ")\n";
        std::cout << "  Destination Seaport: #" << dest_id << " (" << dest_node->name << ", Region: " << dest_node->region << ")\n";
        std::cout << "========================================================================\n\n";
    }

    // =========================================================================
    // 1. DETERMINISTIC A* SHORTEST/LEAST-COST ROUTING (Default Fallback)
    // =========================================================================
    if (algorithm == "astar" || algorithm == "ASTAR") {
        RouteOptimizer::AStarOptimizer astar(full_graph, ga_config.fuel_rate_sea, ga_config.fuel_rate_road,
                                             37.0, 1.0, ga_config.mode_switch_penalty);
        
        auto astar_res = astar.findOptimalRoute(origin_id, dest_id);

        if (!astar_res.is_valid) {
            std::cerr << "[A* Error] No reachable marine shipping path found between #" << origin_id << " and #" << dest_id << ".\n";
            return 1;
        }

        std::cout << "========================================================================\n";
        std::cout << "            OPTIMAL DETERMINISTIC A* ROUTE DETAILS                      \n";
        std::cout << "========================================================================\n";
        std::cout << "  Total Path Cost      : $" << std::fixed << std::setprecision(2) << astar_res.total_cost << "\n";
        std::cout << "  Total Transit Time   : " << std::fixed << std::setprecision(2) << astar_res.total_transit_hours << " hours (" << (astar_res.total_transit_hours / 24.0) << " days)\n";
        std::cout << "  Total Voyage Distance: " << std::fixed << std::setprecision(2) << astar_res.total_distance_km << " km (" << (astar_res.total_distance_km / 1.852) << " NM)\n";
        std::cout << "  Vessel Fuel Cost     : $" << std::fixed << std::setprecision(2) << astar_res.fuel_cost << "\n";
        std::cout << "  Waypoints in Path    : " << astar_res.path.size() << " nodes\n";
        std::cout << "  Nodes Explored in A* : " << astar_res.nodes_explored << " nodes\n";
        std::cout << "  A* Computation Time  : " << std::fixed << std::setprecision(3) << astar_res.execution_time_ms << " ms\n";
        std::cout << "========================================================================\n";

        if (!mpi.isRoot()) return 0;
        return writeOutputJSON(
            output_path,
            origin_id,
            dest_id,
            full_graph,
            astar_res.path,
            astar_res.total_cost,
            astar_res.total_distance_km,
            astar_res.total_transit_hours,
            astar_res.fuel_cost,
            astar_res.mode_switches,
            astar_res.execution_time_ms,
            "A* (Deterministic)"
        ) ? 0 : 1;
    }

    // =========================================================================
    // 2. PARALLEL GENETIC ALGORITHM & MPI REGIONAL CLUSTER PIPELINE
    // =========================================================================
    auto total_t_start = std::chrono::high_resolution_clock::now();

    RouteOptimizer::GeneticAlgorithmOptimizer ga_opt(full_graph, ga_config);
    auto ga_sol = ga_opt.optimizeRoute(origin_id, dest_id);
    if (distributed) ga_sol = mpi.bestRoute(ga_sol);
    if (!ga_sol.score.is_valid || ga_sol.path.empty()) {
        std::cerr << "[Error] No valid genetic-algorithm route found.\n";
        return 1;
    }

    auto total_t_end = std::chrono::high_resolution_clock::now();
    double duration_ms = std::chrono::duration<double, std::milli>(total_t_end - total_t_start).count();

    bool output_written = true;
    if (mpi.isRoot()) {
        std::cout << "\n========================================================================\n";
        std::cout << "               GENETIC ALGORITHM OPTIMAL ROUTE DETAILS                  \n";
        std::cout << "========================================================================\n";
        ga_opt.printRouteDetails(ga_sol);

        output_written = writeOutputJSON(
            output_path,
            origin_id,
            dest_id,
            full_graph,
            ga_sol.path,
            ga_sol.score.total_cost,
            ga_sol.score.total_distance_km,
            ga_sol.score.total_transit_hours,
            ga_sol.score.total_fuel_cost,
            ga_sol.score.mode_switches,
            duration_ms,
            distributed ? "MPI GA (" + std::to_string(world_size) + " ranks)" :
                ga_config.use_cuda ? "CUDA GPU GA" : "OpenMP CPU GA"
        );
    }

    mpi.synchronize();

    if (run_benchmark && mpi.isRoot()) {
        RouteOptimizer::runOpenMPBenchmark(full_graph, origin_id, dest_id, ga_config);
    }

    if (mpi.isRoot() && output_written) {
        std::cout << "[Execution Status] COMPLETED SUCCESSFULLY.\n";
    }

    return output_written ? 0 : 1;
} catch (const std::exception& error) {
    std::cerr << "[Error] " << error.what() << "\n";
    return 1;
}
