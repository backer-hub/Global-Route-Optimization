#!/usr/bin/env python3
"""
scripts/test_integration.py - Full end-to-end integration test suite
Tests:
1. Flask health and metadata endpoints
2. Port database & network topology
3. Point-to-Point A* route computation (OpenMP)
4. Multi-stop TSP Genetic Algorithm (OX1 Crossover + Swap Mutation)
5. Live Weather & AIS overlay feeds
6. Static assets (index.html, style.css, app.js)
"""

import sys
import json
import tempfile
from concurrent.futures import ThreadPoolExecutor
from unittest.mock import patch
from pathlib import Path

ROOT_DIR = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT_DIR))

import server
from server import app

def run_tests():
    print("=========================================================================")
    print("        MARINEROUTE AI — HPC END-TO-END INTEGRATION TEST SUITE           ")
    print("=========================================================================")
    
    client = app.test_client()
    passed = 0
    total = 0

    def check(name, condition, extra=""):
        nonlocal passed, total
        total += 1
        if condition:
            passed += 1
            print(f" [PASS] {name} {extra}")
        else:
            print(f" [FAIL] {name} {extra}")

    # 1. Health check
    r = client.get('/api/health')
    check("GET /api/health returns 200", r.status_code == 200, f"Status: {r.status_code}")
    if r.status_code == 200:
        check("Binary detected", r.json.get("engine_ready") is True)

    # 2. Ports check
    r = client.get('/api/ports')
    check("GET /api/ports returns 200", r.status_code == 200)
    check("Ports count > 20", r.json.get("total_ports", 0) >= 20, f"Count: {r.json.get('total_ports')}")

    # 3. Weather overlay
    r = client.get('/api/weather')
    check("GET /api/weather returns 200", r.status_code == 200)

    # 4. Static assets
    for asset in ['/', '/style.css', '/app.js']:
        r = client.get(asset)
        check(f"Static asset {asset} accessible", r.status_code == 200, f"Size: {len(r.data)} bytes")

    # 5. Point-to-Point A* Route (Shanghai to Rotterdam: 55196 -> 21998)
    r = client.post('/api/route', json={'origin_id': 55196, 'dest_id': 21998, 'engine': 'astar'})
    check("POST /api/route (A* 2 ports) returns 200", r.status_code == 200)
    if r.status_code == 200:
        data = r.json
        nodes = data.get("nodes", [])
        path = data.get("path", [])
        check("Route has nodes", len(nodes) > 2, f"Nodes: {len(nodes)}")
        check("Route has path", len(path) > 2, f"Path: {len(path)}")
        print(f"       -> Engine: {data.get('engine')}, Dist: {data.get('total_distance_km')} km, Time: {data.get('total_transit_hours')} h, Cost: ${data.get('total_cost')}")

    # 6. Multi-stop TSP Route (Shanghai -> Singapore -> Colombo -> Rotterdam: [55196, 49102, 45250, 21998])
    r = client.post('/api/route', json={'waypoints': [55196, 49102, 45250, 21998], 'engine': 'openmp'})
    check("POST /api/route (TSP Multi-Stop 4 ports) returns 200", r.status_code == 200)
    if r.status_code == 200:
        data = r.json
        nodes = data.get("nodes", [])
        check("TSP Route returned nodes", len(nodes) >= 4, f"Nodes: {len(nodes)}")
        print(f"       -> Engine: {data.get('engine')}, Dist: {data.get('total_distance_km')} km, Time: {data.get('total_transit_hours')} h, Cost: ${data.get('total_cost')}")
        tour_names = " -> ".join(n["name"] for n in data["tsp_waypoints"])
        print(f"       -> Optimized Tour: {tour_names}")

    for payload in ({"waypoints": None}, {"waypoints": [55196, 49102, 49102, 21998]},
                    {"origin_id": "invalid"}):
        result = client.post("/api/route", json=payload)
        check(f"Invalid routing input rejected {payload}", result.status_code == 400)

    mpi_ready = client.get("/api/health").json["mpi_ready"]
    for points in ([55196, 21998], [55196, 49102, 45250, 21998]):
        result = client.post("/api/route", json={
            "waypoints": points, "engine": "mpi", "publish": False,
            "pop_size": 12, "generations": 3,
        })
        if mpi_ready and result.status_code == 200:
            data = result.json
            check(f"MPI computes a {len(points)}-port route across two ranks",
                  data["engine"].startswith("MPI ") and "2 ranks" in data["engine"] and
                  [data["path"][0], data["path"][-1]] == [points[0], points[-1]] and
                  (len(points) == 2 or set(data["tsp_tour"]) == set(points)))
        else:
            check(f"MPI readiness matches routing availability for {len(points)} ports",
                  not mpi_ready and result.status_code == 503)

    before = client.get("/api/latest_route").json
    result = client.post("/api/route", json={
        "waypoints": [55196, 49102, 45250, 21998], "engine": "cuda", "publish": False
    })
    check("CUDA-requested 4-port route succeeds", result.status_code == 200)
    check("Comparison preserves latest route", client.get("/api/latest_route").json == before)
    result = client.post("/api/route", json={
        "waypoints": [55196, 21998], "engine": "openmp", "publish": False
    })
    check("Point-to-point OpenMP reaches the requested endpoints",
          result.status_code == 200 and result.json["engine"] == "OpenMP CPU GA" and
          [result.json["path"][0], result.json["path"][-1]] == [55196, 21998])

    def route_in_thread(pair):
        with app.test_client() as thread_client:
            response = thread_client.post("/api/route", json={"waypoints": pair})
            return response.status_code, response.json.get("path", [])

    pairs = [[55196, 21998], [49102, 45250]]
    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(route_in_thread, pairs))
    for pair, (status, path) in zip(pairs, results):
        check(f"Concurrent route has its own endpoints {pair}",
              status == 200 and bool(path) and [path[0], path[-1]] == pair)

    result = client.post("/api/congestion", json={"node_id": 49102, "delay_hours": "NaN"})
    check("Non-finite congestion rejected", result.status_code == 400)
    result = client.post("/api/render_map")
    check("Generated map is served", result.status_code == 200 and
          client.get(result.json["map_url"]).status_code == 200)

    print("=========================================================================")
    print(f" Test Results: {passed}/{total} checks PASSED.")
    print("=========================================================================")
    return passed == total

if __name__ == "__main__":
    with tempfile.TemporaryDirectory(dir=ROOT_DIR) as directory:
        output = Path(directory)
        congestion = output / "congestion.json"
        congestion.write_text(json.dumps({"49102": 72}), encoding="utf-8")
        with patch.multiple(server, OUTPUT_DIR=output, CONGESTION_FILE=congestion,
                            LATEST_ROUTES_FILE=output / "latest_routes.json"):
            success = run_tests()
    sys.exit(0 if success else 1)
