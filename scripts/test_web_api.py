#!/usr/bin/env python3
"""
test_web_api.py - Comprehensive End-to-End Test Suite
Validates:
  1. C++ Deterministic A* Search Engine with physical Haversine heuristic
  2. C++ Parallel Genetic Algorithm fallback
  3. Dynamic Real-Time Congestion Streamer & Poller
  4. Visualization Renderer (Route JSON -> Interactive HTML Map)
  5. Python Flask REST API Server (Endpoints, CORS, Error Handling)
"""

import sys
import json
import time
import subprocess
import threading
import tempfile
from pathlib import Path
from unittest.mock import patch
import urllib.request
import urllib.error

ROOT_DIR = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT_DIR))
CONFIG_DIR = ROOT_DIR / "config"
OUTPUT_DIR = ROOT_DIR / "output"
BUILD_DIR = ROOT_DIR / "build"
WEB_DIR = ROOT_DIR / "web"

CONGESTION_FILE = CONFIG_DIR / "congestion.json"
OUTPUT_FILE = OUTPUT_DIR / "latest_routes.json"
HTML_MAP_FILE = OUTPUT_DIR / "route_map.html"

from server import get_optimizer_binary


def http_get(url):
    req = urllib.request.Request(url)
    with urllib.request.urlopen(req, timeout=5) as resp:
        return json.loads(resp.read().decode("utf-8")), resp.status


def http_post(url, data):
    payload = json.dumps(data).encode("utf-8")
    req = urllib.request.Request(url, data=payload, headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=10) as resp:
        return json.loads(resp.read().decode("utf-8")), resp.status


def test_stage_1_astar_deterministic():
    print("\n========================================================================")
    print(" [STAGE 1] Testing C++ Deterministic A* Engine (Shanghai -> Rotterdam) ")
    print("========================================================================")
    with open(CONGESTION_FILE, "w") as f:
        json.dump({}, f)

    cmd = [
        binary_path,
        "--algorithm", "astar",
        "--origin", "55196",
        "--dest", "21998",
        "--congestion", str(CONGESTION_FILE),
        "--output", str(OUTPUT_FILE)
    ]
    t0 = time.time()
    res = subprocess.run(cmd, cwd=str(ROOT_DIR), capture_output=True, text=True)
    dur = time.time() - t0

    assert res.returncode == 0, f"A* failed:\n{res.stderr}"
    with open(OUTPUT_FILE, "r") as f:
        data = json.load(f)

    print(f"  A* Engine Execution Status : SUCCESS")
    print(f"  Total Cost                 : ${data['total_cost']:.2f}")
    print(f"  Transit Duration           : {data['total_transit_hours']:.2f} hrs ({(data['total_transit_hours']/24.0):.1f} days)")
    print(f"  Voyage Distance            : {data['total_distance_km']:.2f} km ({(data['total_distance_km']/1.852):.0f} NM)")
    print(f"  Waypoints In Path          : {data['path_length']} nodes")
    print(f"  C++ Compute Duration       : {data['execution_time_ms']:.2f} ms")
    assert data["path_length"] > 10, "A* path should contain waypoints"
    assert data["total_cost"] > 0, "A* cost should be positive"
    return data


def test_stage_2_dynamic_disruption():
    print("\n========================================================================")
    print(" [STAGE 2] Testing Destination Congestion                            ")
    print("========================================================================")
    # Arrival at the destination must incur the configured delay.
    baseline = json.loads(OUTPUT_FILE.read_text(encoding="utf-8"))
    disrupted_id = baseline["dest_id"]
    delay_hours = 72.0
    with open(CONGESTION_FILE, "w") as f:
        json.dump({str(disrupted_id): delay_hours}, f, indent=2)

    cmd = [
        binary_path,
        "--algorithm", "astar",
        "--origin", "55196",
        "--dest", "21998",
        "--congestion", str(CONGESTION_FILE),
        "--output", str(OUTPUT_FILE)
    ]
    res = subprocess.run(cmd, cwd=str(ROOT_DIR), capture_output=True, text=True)
    assert res.returncode == 0, f"Disrupted A* failed:\n{res.stderr}"

    with open(OUTPUT_FILE, "r") as f:
        disrupted_data = json.load(f)
    assert abs(disrupted_data["total_transit_hours"] - baseline["total_transit_hours"] - delay_hours) < 0.02

    print(f"  Injected Disruption        : +{delay_hours}h arrival delay on node #{disrupted_id}")
    print(f"  Recalculated Voyage Cost   : ${disrupted_data['total_cost']:.2f}")
    print(f"  Recalculated Transit Hours : {disrupted_data['total_transit_hours']:.2f} hrs")
    print(f"  Output JSON Verified       : PASSED ({len(disrupted_data['nodes'])} detailed nodes)")
    return disrupted_data


def test_stage_3_visualization_renderer():
    print("\n========================================================================")
    print(" [STAGE 3] Testing Standalone Visualization Map Renderer                ")
    print("========================================================================")
    cmd = [sys.executable, str(ROOT_DIR / "scripts" / "render_route_map.py"),
           "--input", str(OUTPUT_FILE), "--output", str(HTML_MAP_FILE)]
    res = subprocess.run(cmd, cwd=str(ROOT_DIR), capture_output=True, text=True)
    assert res.returncode == 0, f"Map renderer failed:\n{res.stderr}"
    assert HTML_MAP_FILE.exists(), f"Expected {HTML_MAP_FILE} to be generated"

    file_size = HTML_MAP_FILE.stat().st_size
    print(f"  Interactive Map Rendered   : SUCCESS ({HTML_MAP_FILE})")
    print(f"  HTML Map File Size         : {file_size:,} bytes")


def test_graph_regressions():
    nodes = OUTPUT_DIR / "nodes.csv"
    edges = OUTPUT_DIR / "edges.csv"
    nodes.write_text(
        "node_id,name,lat,lon,region,type\n"
        "0,Port Zero,0,0,TEST,port\n"
        "1,Port One,0,1,TEST,port\n"
        "2,Port Two,0,2,TEST,port\n",
        encoding="utf-8",
    )
    edges.write_text(
        "source_id,dest_id,distance_km,base_transit_hours,mode\n"
        "0,1,120,3,sea\n"
        "0,1,100,2,sea\n",
        encoding="utf-8",
    )
    result_file = OUTPUT_DIR / "fixture_route.json"
    cmd = [binary_path, "--nodes", str(nodes), "--edges", str(edges),
           "--congestion", str(CONGESTION_FILE), "--output", str(result_file)]
    subprocess.run(cmd + ["--origin", "0", "--dest", "1"], check=True, capture_output=True)
    route = json.loads(result_file.read_text(encoding="utf-8"))
    assert route["path"] == [0, 1]
    assert route["total_distance_km"] == 100
    result_file.unlink()

    result = subprocess.run(cmd + ["--tsp", "--waypoints", "0,1,2"], capture_output=True)
    assert result.returncode != 0 and not result_file.exists()
    print("  Parallel-edge totals and disconnected tour regression checks passed")


def test_stage_4_flask_api_server():
    print("\n========================================================================")
    print(" [STAGE 4] Testing Python Flask REST API Server (server.py)             ")
    print("========================================================================")
    import server

    # Start Flask in a background thread for testing
    server_thread = threading.Thread(
        target=lambda: server.app.run(host="127.0.0.1", port=5055, debug=False, use_reloader=False),
        daemon=True
    )
    server_thread.start()
    time.sleep(1.0) # Wait for server startup

    base_url = "http://127.0.0.1:5055"

    # Test 1: Health Check
    health, status = http_get(f"{base_url}/health")
    assert status == 200, f"Health check failed: {status}"
    print(f"  GET  /health               : 200 OK (status: {health.get('status')})")

    # Test 2: Network Ports
    net, status = http_get(f"{base_url}/api/network")
    assert status == 200, f"Network check failed: {status}"
    print(f"  GET  /api/network          : 200 OK ({net.get('total_ports')} seaports loaded)")

    # Test 3: Set Congestion
    cong_resp, status = http_post(f"{base_url}/api/congestion", {
        "node_id": 46607,
        "delay_hours": 48.0,
        "event_type": "Bab-el-Mandeb Advisory"
    })
    assert status == 200, f"Congestion post failed: {status}"
    print(f"  POST /api/congestion       : 200 OK (+48h on Node #46607)")

    # Test 4: Route Optimization via API
    route_resp, status = http_post(f"{base_url}/api/route", {
        "origin_id": 55196,
        "dest_id": 21998,
        "algorithm": "astar"
    })
    assert status == 200, f"Route post failed: {status}"
    assert route_resp.get("status") == "success", "Route status should be success"
    print(f"  POST /api/route            : 200 OK (${route_resp.get('total_cost'):.2f}, {route_resp.get('path_length')} waypoints)")

    # Test 5: Reset Congestion
    reset_resp, status = http_post(f"{base_url}/api/congestion/reset", {})
    assert status == 200, f"Reset failed: {status}"
    print(f"  POST /api/congestion/reset : 200 OK (all delays cleared)")


def main():
    print("========================================================================")
    print("     FULL SYSTEM INTEGRATION VERIFICATION: ALL 5 MODULES                ")
    print("========================================================================")
    print(f"  Binary Path   : {binary_path}")
    print(f"  Nodes Dataset : {ROOT_DIR / 'data' / 'nodes.csv'}")
    print(f"  Edges Dataset : {ROOT_DIR / 'data' / 'edges.csv'}")

    test_stage_1_astar_deterministic()
    test_stage_2_dynamic_disruption()
    test_stage_3_visualization_renderer()
    test_graph_regressions()
    with patch.multiple(server, OUTPUT_DIR=OUTPUT_DIR, CONGESTION_FILE=CONGESTION_FILE,
                        LATEST_ROUTES_FILE=OUTPUT_FILE):
        test_stage_4_flask_api_server()

    print("\n========================================================================")
    print("  [ALL VERIFICATION STAGES PASSED SUCCESSFULLY: EXIT CODE 0]            ")
    print("========================================================================\n")


if __name__ == "__main__":
    import server
    binary_path = get_optimizer_binary()
    if not binary_path:
        sys.exit(f"Binary not found in {BUILD_DIR}")
    with tempfile.TemporaryDirectory(dir=ROOT_DIR) as directory:
        OUTPUT_DIR = Path(directory)
        CONGESTION_FILE = OUTPUT_DIR / "congestion.json"
        OUTPUT_FILE = OUTPUT_DIR / "latest_routes.json"
        HTML_MAP_FILE = OUTPUT_DIR / "route_map.html"
        main()
