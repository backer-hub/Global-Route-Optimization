#!/usr/bin/env python3
"""
server.py - High-Performance Maritime Container Shipping API Server & Dispatcher

Provides REST endpoints for:
- Deterministic A* Least-Cost Route Optimization
- Multi-Stop TSP Permutation Optimization with Order Crossover (OX1) and Swap Mutation
- Optional weather matrix ingestion
- Dynamic Congestion Management (Port Strikes, Typhoons)
- Interactive Map Artifact Generation (scripts/render_route_map.py)
"""

import os
import sys
import json
import time
import subprocess
import threading
import tempfile
import math
import csv
import shutil
from pathlib import Path
from flask import Flask, request, jsonify, send_from_directory

ROOT_DIR = Path(__file__).resolve().parent
BUILD_DIR = ROOT_DIR / "build"
MPI_BUILD_DIR = ROOT_DIR / "build-mpi"
DATA_DIR = ROOT_DIR / "data"
CONFIG_DIR = ROOT_DIR / "config"
OUTPUT_DIR = ROOT_DIR / "output"
WEB_DIR = ROOT_DIR / "web"
SCRIPTS_DIR = ROOT_DIR / "scripts"
PROCESSED_DIR = DATA_DIR / "processed"

CONGESTION_FILE = CONFIG_DIR / "congestion.json"
LATEST_ROUTES_FILE = OUTPUT_DIR / "latest_routes.json"
DYNAMIC_MATRIX_BIN = PROCESSED_DIR / "dynamic_cost_matrix.bin"
DYNAMIC_MATRIX_JSON = PROCESSED_DIR / "dynamic_cost_matrix.json"
NODES_CSV = DATA_DIR / "nodes.csv"
EDGES_CSV = DATA_DIR / "edges.csv"

app = Flask(__name__, static_folder=None)
app.config["MAX_CONTENT_LENGTH"] = 64 * 1024

# Thread safety lock for modifying congestion states
congestion_lock = threading.Lock()
route_output_lock = threading.Lock()


def get_optimizer_binary() -> str:
    candidates = [
        ROOT_DIR / "build-gpu" / "route_optimizer.exe",
        BUILD_DIR / "route_optimizer.exe",
        BUILD_DIR / "route_optimizer",
        BUILD_DIR / "Release" / "route_optimizer.exe",
        BUILD_DIR / "Debug" / "route_optimizer.exe",
        ROOT_DIR / "route_optimizer.exe",
        ROOT_DIR / "route_optimizer"
    ]
    for c in candidates:
        if c.exists() and os.access(c, os.X_OK):
            return str(c)
        if c.exists() and sys.platform.startswith("win"):
            return str(c)
    return None


def get_mpi_command():
    launcher = shutil.which("mpiexec")
    if sys.platform == "win32":
        microsoft_launcher = Path(os.environ.get("ProgramFiles", "C:/Program Files")) / "Microsoft MPI/Bin/mpiexec.exe"
        if microsoft_launcher.is_file():
            launcher = str(microsoft_launcher)
    name = "route_optimizer.exe" if sys.platform == "win32" else "route_optimizer"
    for directory in (MPI_BUILD_DIR, MPI_BUILD_DIR / "Release"):
        binary = directory / name
        if launcher and binary.is_file() and os.access(binary, os.X_OK):
            return [launcher, "-n", "2", str(binary)]
    return None


def read_congestion():
    try:
        with CONGESTION_FILE.open(encoding="utf-8") as source:
            return json.load(source)
    except FileNotFoundError:
        return {}


def write_json_atomically(path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary_path = None
    try:
        with tempfile.NamedTemporaryFile(mode="w", encoding="utf-8", dir=path.parent, delete=False) as target:
            temporary_path = Path(target.name)
            json.dump(data, target, indent=2, allow_nan=False)
        os.replace(temporary_path, path)
    finally:
        if temporary_path is not None:
            temporary_path.unlink(missing_ok=True)


def update_congestion(node_id, delay_hours):
    with congestion_lock:
        delays = read_congestion()
        if delay_hours > 0:
            delays[node_id] = delay_hours
        else:
            delays.pop(node_id, None)
        write_json_atomically(CONGESTION_FILE, delays)
        return delays


def integer_field(value):
    if isinstance(value, bool) or not isinstance(value, (int, str)):
        raise ValueError("Expected an integer")
    number = int(value)
    if not 0 <= number <= 2147483647:
        raise ValueError("Integer out of range")
    return number


def congestion_fields(data):
    node_id = str(integer_field(data.get("node_id")))
    delay = float(data.get("delay_hours", 0))
    if not math.isfinite(delay) or delay < 0:
        raise ValueError("delay_hours must be finite and non-negative")
    return node_id, delay


# Static demonstration vectors, expressed in km/h and intentionally approximate.
DEMO_CURRENTS = [
    (34.0, 143.0, 500.0, 2.7, 1.4),   # Kuroshio extension
    (37.0, -66.0, 550.0, 3.2, 1.3),   # Gulf Stream
    (46.0, -33.0, 750.0, 1.8, 0.9),   # North Atlantic Current
    (-35.0, 30.0, 420.0, -1.0, -2.3), # Agulhas Current
]


def routing_zones(data):
    use_currents = data.get("currents", False)
    if not isinstance(use_currents, bool):
        raise ValueError("currents must be a boolean")
    zones = [(lat, lon, radius, 0, east, north)
             for lat, lon, radius, east, north in DEMO_CURRENTS] if use_currents else []
    for field, radius, delay in (("storms", None, 0.012), ("vessels", 12.0, 0.018)):
        entries = data.get(field, [])
        if not isinstance(entries, list) or len(entries) > 100:
            raise ValueError(f"{field} must be an array of up to 100 positions")
        for entry in entries:
            if not isinstance(entry, dict):
                raise ValueError(f"Invalid {field} position")
            lat, lon = float(entry.get("lat")), float(entry.get("lon"))
            zone_radius = radius if radius is not None else float(entry.get("radius_km"))
            if not (-90 <= lat <= 90 and -180 <= lon <= 180 and 0 < zone_radius <= 1000):
                raise ValueError(f"Invalid {field} coordinates or radius")
            zones.append((lat, lon, zone_radius, delay, 0, 0))
    return zones


def invalid_request(message):
    return jsonify({"status": "error", "message": message}), 400


def json_object():
    data = request.get_json(silent=True)
    if not isinstance(data, dict):
        raise ValueError("Expected a JSON object")
    return data


def load_network_ports():
    ports = []
    if NODES_CSV.exists():
        try:
            with open(NODES_CSV, "r", encoding="utf-8-sig", newline="") as f:
                reader = csv.reader(f)
                header = [h.strip().lower() for h in next(reader)]
                id_idx = header.index("node_id") if "node_id" in header else 0
                name_idx = header.index("name") if "name" in header else 1
                lat_idx = header.index("lat") if "lat" in header else 2
                lon_idx = header.index("lon") if "lon" in header else 3
                reg_idx = header.index("region") if "region" in header else 4

                for row in reader:
                    parts = [part.strip() for part in row]
                    if len(parts) >= 5:
                        p_name = parts[name_idx]
                        if p_name.startswith("Port") or "Strait" in p_name or "Canal" in p_name:
                            ports.append({
                                "id": int(parts[id_idx]),
                                "name": p_name,
                                "lat": float(parts[lat_idx]),
                                "lon": float(parts[lon_idx]),
                                "region": parts[reg_idx]
                            })
        except Exception as e:
            print("[Warning] Could not parse ports CSV:", e)
    return ports


# ==============================================================================
# API Endpoints
# ==============================================================================

@app.route("/map", methods=["GET"])
@app.route("/", methods=["GET"])
def serve_index():
    return send_from_directory(str(WEB_DIR), "index.html")


@app.route("/health", methods=["GET"])
@app.route("/api/health", methods=["GET"])
def health_check():
    binary = get_optimizer_binary()
    return jsonify({
        "status": "healthy",
        "engine_binary": binary,
        "engine_ready": binary is not None,
        "mpi_ready": get_mpi_command() is not None,
        "active_disruptions": len(read_congestion()),
        "timestamp": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    })


@app.route("/api/network", methods=["GET"])
@app.route("/api/ports", methods=["GET"])
def get_network():
    ports = load_network_ports()
    return jsonify({
        "dataset": "Global Marine Shipping Lanes",
        "total_ports": len(ports),
        "key_ports": ports,
        "active_congestion": read_congestion()
    })


@app.route("/api/congestion", methods=["GET"])
def get_congestion():
    with congestion_lock:
        delays = read_congestion()
        return jsonify({
            "status": "success",
            "active_count": len(delays),
            "delays": delays
        })


@app.route("/api/congestion", methods=["POST"])
def set_congestion():
    try:
        data = json_object()
        node_id, delay_hours = congestion_fields(data)
    except (ValueError, TypeError, OverflowError) as error:
        return invalid_request(str(error))
    event_type = data.get("event_type", "port_strike")
    delays = update_congestion(node_id, delay_hours)

    return jsonify({
        "status": "success",
        "message": f"Congestion delay of {delay_hours}h applied to Node #{node_id}",
        "node_id": node_id,
        "delay_hours": delay_hours,
        "event_type": event_type,
        "active_delays": delays
    })


@app.route("/api/congestion/reset", methods=["POST"])
def reset_congestion():
    with congestion_lock:
        write_json_atomically(CONGESTION_FILE, {})

    return jsonify({
        "status": "success",
        "message": "All maritime terminal congestion delays reset to 0.0h.",
        "active_delays": {}
    })


@app.route("/api/ingest_matrix", methods=["POST"])
def ingest_matrix():
    """Trigger real-time weather & traffic ingestion and export dynamic cost matrix."""
    try:
        cmd = [sys.executable, str(SCRIPTS_DIR / "stream_congestion.py"), "--generate-matrix"]
        res = subprocess.run(cmd, cwd=str(ROOT_DIR), capture_output=True, text=True, timeout=30)
        if res.returncode == 0 and DYNAMIC_MATRIX_JSON.exists():
            with open(DYNAMIC_MATRIX_JSON, "r", encoding="utf-8") as f:
                mat_data = json.load(f)
            return jsonify({
                "status": "success",
                "message": "Dynamic cost matrix generated successfully with live weather & traffic penalties",
                "node_count": mat_data.get("node_count"),
                "timestamp": mat_data.get("timestamp")
            })
        else:
            return jsonify({"status": "error", "message": "Matrix generation script failed", "stderr": res.stderr}), 500
    except Exception as e:
        return jsonify({"status": "error", "message": str(e)}), 500


@app.route("/api/live_overlay", methods=["GET"])
@app.route("/api/weather", methods=["GET"])
def get_live_overlay():
    """Return live weather, wave radar zones, AIS vessel fleets, and port anchorages."""
    matrix_weather = {}
    observed_at = None
    if DYNAMIC_MATRIX_JSON.exists():
        try:
            with open(DYNAMIC_MATRIX_JSON, "r", encoding="utf-8") as f:
                mat = json.load(f)
                matrix_weather = mat.get("weather_data", {})
                observed_at = mat.get("timestamp")
        except Exception:
            pass

    return jsonify({
        "status": "success",
        "timestamp": observed_at,
        "weather_data": matrix_weather,
        "active_disruptions": read_congestion()
    })


@app.route("/api/route", methods=["POST"])
@app.route("/api/tsp", methods=["POST"])
@app.route("/api.php", methods=["GET", "POST"])
def optimize_route():
    if request.method == "GET":
        action = request.args.get("action", "get_network")
        if action == "get_network":
            return get_network()
        elif action == "get_latest_route":
            return get_latest_route()
        return invalid_request("Unknown GET action")

    try:
        data = json_object()
    except ValueError as error:
        return invalid_request(str(error))
    action = request.args.get("action", data.get("action", "optimize"))

    if action == "reset_congestion":
        return reset_congestion()

    try:
        raw_waypoints = data.get("waypoints", [])
        if not isinstance(raw_waypoints, list) or len(raw_waypoints) > 64:
            raise ValueError("waypoints must be an array of up to 64 node IDs")
        waypoints = [integer_field(node) for node in raw_waypoints]
        if ("waypoints" in data or request.path == "/api/tsp") and len(waypoints) < 2:
            raise ValueError("At least two waypoints are required")
        if (len(waypoints) > 2 or request.path == "/api/tsp") and len(set(waypoints)) != len(waypoints):
            raise ValueError("A waypoint tour requires distinct node IDs")
        origin_id = integer_field(data.get("origin_id", 55196))
        dest_id = integer_field(data.get("dest_id", 21998))
        if waypoints:
            origin_id, dest_id = waypoints[0], waypoints[-1]
        is_tsp = bool(waypoints) and (request.path == "/api/tsp" or len(waypoints) > 2)
        algorithm = str(data.get("algorithm", data.get("engine", "astar"))).lower()
        if algorithm not in {"astar", "openmp", "cuda", "gpu", "mpi"}:
            raise ValueError("Unknown routing engine")
        pop_size = integer_field(data.get("pop_size", 1000))
        generations = integer_field(data.get("generations", 50))
        if pop_size < 2 or generations < 1:
            raise ValueError("pop_size must be at least 2 and generations must be positive")
        disruption = congestion_fields(data) if "node_id" in data or "delay_hours" in data else None
        zones = routing_zones(data)
    except (ValueError, TypeError, OverflowError) as error:
        return invalid_request(str(error))

    distributed = algorithm == "mpi"
    bin_path = get_optimizer_binary()
    prefix = get_mpi_command() if distributed else [bin_path]
    if distributed and prefix is None:
        return jsonify({"status": "error", "message": "MPI requires a launcher and an MPI-enabled build in build-mpi."}), 503
    if not distributed and not bin_path:
        return jsonify({
            "status": "error",
            "message": "Route optimizer C++ binary not found. Please compile with cmake --build build."
        }), 503

    delays = update_congestion(*disruption) if disruption else read_congestion()

    # If Multi-Stop TSP requested
    if is_tsp and waypoints:
        wp_str = ",".join(str(w) for w in waypoints)
        cmd = [
            *prefix,
            "--tsp",
            "--waypoints", wp_str,
            "--pop", str(min(pop_size, 300)),
            "--gen", str(min(generations, 100))
        ]
        if algorithm in ["cuda", "gpu"]:
            cmd.append("--cuda")

    else:
        # Point-to-point GA mutations search the graph, so bound their HTTP workload.
        cmd = [
            *prefix,
            "--origin", str(origin_id),
            "--dest", str(dest_id),
            "--algorithm", algorithm if algorithm in {"astar", "mpi"} else "ga",
            "--pop", str(min(pop_size, 32)),
            "--gen", str(min(generations, 12)),
        ]
        if algorithm in {"cuda", "gpu"}:
            cmd.append("--cuda")

    if distributed and is_tsp:
        cmd.extend(["--engine", "mpi"])

    try:
        OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
        with tempfile.TemporaryDirectory(dir=OUTPUT_DIR) as directory:
            route_file = Path(directory) / "route.json"
            congestion_file = Path(directory) / "congestion.json"
            write_json_atomically(congestion_file, delays)
            if zones:
                conditions_file = Path(directory) / "marine-conditions.txt"
                conditions_file.write_text("\n".join(" ".join(map(str, zone)) for zone in zones),
                                           encoding="ascii")
                cmd.extend(["--marine-conditions", str(conditions_file)])
            cmd.extend(["--output", str(route_file), "--congestion", str(congestion_file)])
            cmd.extend(["--threads", str(min(os.cpu_count() or 1, 2 if distributed else 4))])
            started = time.perf_counter()
            res = subprocess.run(cmd, cwd=ROOT_DIR, capture_output=True, text=True, timeout=30)
            if res.returncode:
                app.logger.warning("Optimizer failed: %s", res.stderr)
                return jsonify({"status": "error", "message": "Optimizer could not compute a route"}), 422
            route_data = json.loads(route_file.read_text(encoding="utf-8"))
        if route_data.get("status") != "success":
            return jsonify({"status": "error", "message": "Optimizer returned an invalid route"}), 422
        route_data["api_execution_time_ms"] = round((time.perf_counter() - started) * 1000, 2)
        route_data["active_congestion_count"] = len(delays)
        route_data["marine_model"] = (
            "CUDA" if "[Marine conditions]" in res.stdout and "lanes using CUDA" in res.stdout
            else "CPU" if zones else "Off"
        )
        route_data["requested_engine"] = algorithm
        route_data["requested_waypoints"] = waypoints or [origin_id, dest_id]
        if data.get("publish", True) is not False:
            with route_output_lock:
                write_json_atomically(LATEST_ROUTES_FILE, route_data)
    except subprocess.TimeoutExpired:
        return jsonify({"status": "error", "message": "Optimizer timed out"}), 504
    except (OSError, ValueError, UnicodeError):
        app.logger.exception("Failed to run optimizer or publish route")
        return jsonify({"status": "error", "message": "Failed to process route output"}), 500

    return jsonify(route_data)


@app.route("/api/latest_route", methods=["GET"])
def get_latest_route():
    if LATEST_ROUTES_FILE.exists():
        with open(LATEST_ROUTES_FILE, "r", encoding="utf-8") as f:
            return jsonify(json.load(f))
    return jsonify({"status": "error", "message": "No route computed yet"}), 404


@app.route("/api/render_map", methods=["POST", "GET"])
def render_map_endpoint():
    try:
        from scripts.render_route_map import render_html_map
        with route_output_lock:
            if not LATEST_ROUTES_FILE.exists():
                return jsonify({"status": "error", "message": "No route computed yet"}), 404
            route = json.loads(LATEST_ROUTES_FILE.read_text(encoding="utf-8"))
            render_html_map(route, OUTPUT_DIR / "route_map.html")
        return jsonify({"status": "success", "map_url": "/map_viewer.html"})
    except Exception as e:
        return jsonify({"status": "error", "message": str(e)}), 500


@app.route("/map_viewer.html", methods=["GET"])
def serve_rendered_map():
    return send_from_directory(OUTPUT_DIR, "route_map.html")


@app.route("/<path:path>", methods=["GET"])
def serve_static(path):
    file_path = WEB_DIR / path
    if file_path.exists() and file_path.is_file():
        return send_from_directory(str(WEB_DIR), path)
    return jsonify({"status": "error", "message": f"Resource '{path}' not found"}), 404


def main():
    import argparse
    parser = argparse.ArgumentParser(description="MarineRoute HPC Optimizer API Server")
    parser.add_argument("--port", type=int, default=5000, help="Port to listen on (default: 5000)")
    parser.add_argument("--host", default="127.0.0.1", help="Host interface (default: 127.0.0.1)")
    args = parser.parse_args()

    print("=========================================================================")
    print("      MARINEROUTE AI — HPC GLOBAL SHIPPING ROUTE OPTIMIZER SERVER        ")
    print("=========================================================================")
    print(f"  Web Dashboard   : http://localhost:{args.port}/")
    print(f"  API Endpoints   : /api/route, /api/tsp, /api/ports, /api/congestion")
    print(f"  Engine Binary   : {get_optimizer_binary() or 'NOT FOUND (Please compile)'}")
    print(f"  Dynamic Matrix  : {DYNAMIC_MATRIX_BIN}")
    print("=========================================================================\n")

    app.run(host=args.host, port=args.port, debug=False)


if __name__ == "__main__":
    main()
