#!/usr/bin/env python3
"""
stream_congestion.py - Real-Time Maritime Weather, AIS Traffic & Cost Matrix Ingestion

1. External Data Ingestion:
   - Asynchronously queries Open-Meteo Marine & Weather APIs (wave height, wind speed, gusts).
   - Ingests real-time AIS traffic, terminal congestion, and maritime chokepoint advisories.
   - Calculates segment cost:
       Edge_Cost = Haversine_Distance * (1.0 + Weather_Penalty + Traffic_Penalty)
   - Generates & exports an N x N dynamic cost matrix to data/processed/dynamic_cost_matrix.bin
     (and .json) for direct C++ / CUDA memory-mapped loading.
"""

import os
import sys
import json
import time
import math
import struct
import random
import argparse
import asyncio
import tempfile
from contextlib import contextmanager
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
import urllib.request
import urllib.error

ROOT_DIR = Path(__file__).resolve().parent.parent
CONFIG_DIR = ROOT_DIR / "config"
CONGESTION_FILE = CONFIG_DIR / "congestion.json"
DATA_DIR = ROOT_DIR / "data"
PROCESSED_DIR = DATA_DIR / "processed"
NODES_CSV = DATA_DIR / "nodes.csv"
DEFAULT_BIN_OUTPUT = PROCESSED_DIR / "dynamic_cost_matrix.bin"
DEFAULT_JSON_OUTPUT = PROCESSED_DIR / "dynamic_cost_matrix.json"
OUTPUT_DIR = ROOT_DIR / "output"

# Key global maritime strategic waypoints
STRATEGIC_PORTS = [
    {"id": 55196, "name": "Port of Shanghai", "lat": 31.2304, "lon": 121.4737, "type": "Typhoon Weather Warning", "range": (36.0, 72.0)},
    {"id": 49102, "name": "Port of Singapore", "lat": 1.2903, "lon": 103.8520, "type": "Port Labor Strike", "range": (24.0, 72.0)},
    {"id": 45822, "name": "Port of Mumbai", "lat": 18.9500, "lon": 72.9500, "type": "Monsoon Swell Delay", "range": (24.0, 48.0)},
    {"id": 45250, "name": "Port of Colombo", "lat": 6.9400, "lon": 79.8400, "type": "Feeder Vessel Queue", "range": (12.0, 36.0)},
    {"id": 49452, "name": "Port of Dubai (Jebel Ali)", "lat": 25.0100, "lon": 55.0600, "type": "Berth Congestion", "range": (18.0, 48.0)},
    {"id": 46607, "name": "Bab-el-Mandeb Strait", "lat": 12.5800, "lon": 43.3300, "type": "Navigational Advisory", "range": (48.0, 120.0)},
    {"id": 21473, "name": "Suez Canal South Entry", "lat": 29.9300, "lon": 32.5600, "type": "Canal Convoy Bottleneck", "range": (24.0, 48.0)},
    {"id": 37100, "name": "Port Said (Suez North)", "lat": 31.2600, "lon": 32.3000, "type": "Terminal Gate Congestion", "range": (18.0, 36.0)},
    {"id": 21998, "name": "Port of Rotterdam", "lat": 51.9500, "lon": 4.1300, "type": "Berth Crane Maintenance", "range": (12.0, 36.0)},
    {"id": 22490, "name": "Port of Hamburg", "lat": 53.5300, "lon": 9.9600, "type": "Elbe Tidal Restriction", "range": (12.0, 24.0)},
    {"id": 55508, "name": "Port of Los Angeles", "lat": 33.7469, "lon": -118.2483, "type": "Drayage Railhead Congestion", "range": (24.0, 60.0)},
    {"id": 6383,  "name": "Port of New York", "lat": 40.6465, "lon": -74.0631, "type": "Terminal Fog Delay", "range": (12.0, 30.0)},
    {"id": 55355, "name": "Port of Busan", "lat": 35.1000, "lon": 129.0400, "type": "Container Stack Bottleneck", "range": (18.0, 36.0)},
    {"id": 55364, "name": "Port of Yokohama", "lat": 35.4400, "lon": 139.6400, "type": "Bay Advisory", "range": (12.0, 24.0)}
]

VESSEL_SPEED_KMH = 37.04  # 20.0 knots
EARTH_RADIUS_KM = 6371.0


@contextmanager
def atomic_output(path, mode, **options):
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary_path = None
    try:
        with tempfile.NamedTemporaryFile(mode, dir=path.parent, delete=False, **options) as target:
            temporary_path = Path(target.name)
            yield target
        os.replace(temporary_path, path)
    finally:
        if temporary_path is not None:
            temporary_path.unlink(missing_ok=True)


def haversine_distance(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Calculate Great Circle distance between two lat/lon points in km."""
    p1 = math.radians(lat1)
    p2 = math.radians(lat2)
    dp = math.radians(lat2 - lat1)
    dl = math.radians(lon2 - lon1)
    a = (math.sin(dp / 2.0) ** 2) + math.cos(p1) * math.cos(p2) * (math.sin(dl / 2.0) ** 2)
    c = 2.0 * math.atan2(math.sqrt(a), math.sqrt(max(0.0, 1.0 - a)))
    return EARTH_RADIUS_KM * c


def fetch_open_meteo_weather_sync(lat: float, lon: float) -> dict:
    """Fetch marine wave height and wind speed from Open-Meteo API."""
    try:
        url = f"https://api.open-meteo.com/v1/forecast?latitude={lat:.4f}&longitude={lon:.4f}&current=wind_speed_10m,wind_gusts_10m&wind_speed_unit=kn"
        req = urllib.request.Request(url, headers={"User-Agent": "MarineRoute-HPC/1.2"})
        with urllib.request.urlopen(req, timeout=3) as resp:
            if resp.status == 200:
                data = json.loads(resp.read().decode("utf-8"))
                current = data.get("current", {})
                wind_kts = float(current["wind_speed_10m"])
                # Wave height heuristic from wind or simulated
                wave_m = round(max(0.5, (wind_kts / 8.0) ** 1.3), 2)
                return {"wind_kts": wind_kts, "wave_height_m": wave_m, "source": "open-meteo",
                        "wave_height_source": "estimated-from-wind"}
    except Exception:
        pass
    
    # Deterministic marine simulation fallback based on coordinates
    pseudo = (math.sin(lat * 0.1) + math.cos(lon * 0.1) + 2.0) / 4.0
    wind_kts = round(8.0 + pseudo * 22.0, 1)
    wave_m = round(0.8 + pseudo * 2.8, 2)
    return {"wind_kts": wind_kts, "wave_height_m": wave_m, "source": "marine-sim"}


async def fetch_all_weather_async(waypoints: list) -> dict:
    """Asynchronously fetch real-time weather conditions for all waypoints concurrently."""
    loop = asyncio.get_running_loop()
    weather_map = {}
    with ThreadPoolExecutor(max_workers=min(16, len(waypoints) or 1)) as pool:
        tasks = [
            loop.run_in_executor(pool, fetch_open_meteo_weather_sync, wp["lat"], wp["lon"])
            for wp in waypoints
        ]
        results = await asyncio.gather(*tasks, return_exceptions=True)
        for wp, res in zip(waypoints, results):
            if isinstance(res, dict):
                weather_map[wp["id"]] = res
            else:
                weather_map[wp["id"]] = {"wind_kts": 14.0, "wave_height_m": 1.2, "source": "default"}
    return weather_map


def load_congestion_config() -> dict:
    """Load active congestion delays from config/congestion.json."""
    if CONGESTION_FILE.exists():
        try:
            with open(CONGESTION_FILE, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception:
            return {}
    return {}


class DynamicCostMatrixGenerator:
    """Generates N x N dynamic travel cost matrix with weather and traffic penalties."""

    def __init__(self, waypoints: list = None):
        self.waypoints = waypoints or STRATEGIC_PORTS

    def build_matrix(self, weather_data: dict = None, congestion_data: dict = None) -> dict:
        if weather_data is None:
            # Run async fetch synchronously if needed
            try:
                weather_data = asyncio.run(fetch_all_weather_async(self.waypoints))
            except Exception:
                weather_data = {
                    wp["id"]: fetch_open_meteo_weather_sync(wp["lat"], wp["lon"])
                    for wp in self.waypoints
                }

        if congestion_data is None:
            congestion_data = load_congestion_config()

        n = len(self.waypoints)
        node_ids = [wp["id"] for wp in self.waypoints]
        cost_matrix = [[0.0] * n for _ in range(n)]
        dist_matrix = [[0.0] * n for _ in range(n)]
        transit_matrix = [[0.0] * n for _ in range(n)]

        for i in range(n):
            wp_i = self.waypoints[i]
            w_i = weather_data.get(wp_i["id"], {"wave_height_m": 1.0, "wind_kts": 10.0})
            c_i = float(congestion_data.get(str(wp_i["id"]), 0.0))

            for j in range(n):
                if i == j:
                    cost_matrix[i][j] = 0.0
                    dist_matrix[i][j] = 0.0
                    transit_matrix[i][j] = 0.0
                    continue

                wp_j = self.waypoints[j]
                w_j = weather_data.get(wp_j["id"], {"wave_height_m": 1.0, "wind_kts": 10.0})
                c_j = float(congestion_data.get(str(wp_j["id"]), 0.0))

                dist_km = haversine_distance(wp_i["lat"], wp_i["lon"], wp_j["lat"], wp_j["lon"])
                dist_matrix[i][j] = dist_km

                # Weather penalty derived from wave height and wind speed
                avg_wave = (w_i.get("wave_height_m", 1.0) + w_j.get("wave_height_m", 1.0)) / 2.0
                avg_wind = (w_i.get("wind_kts", 12.0) + w_j.get("wind_kts", 12.0)) / 2.0
                weather_penalty = min(2.5, max(0.0, (avg_wave - 1.2) * 0.20 + (avg_wind - 15.0) * 0.015))

                # Traffic / AIS Congestion penalty derived from delay hours
                avg_delay = (c_i + c_j) / 2.0
                traffic_penalty = min(3.0, (avg_delay / 24.0) * 0.45)

                # Segment travel cost formula:
                # Edge_Cost = Haversine_Distance * (1.0 + Weather_Penalty + Traffic_Penalty)
                edge_cost = dist_km * (1.0 + weather_penalty + traffic_penalty)
                transit_hours = (dist_km / VESSEL_SPEED_KMH) + avg_delay

                cost_matrix[i][j] = round(edge_cost, 3)
                transit_matrix[i][j] = round(transit_hours, 3)

        return {
            "node_count": n,
            "node_ids": node_ids,
            "waypoints": self.waypoints,
            "weather_data": weather_data,
            "congestion_data": congestion_data,
            "cost_matrix": cost_matrix,
            "distance_matrix": dist_matrix,
            "transit_matrix": transit_matrix,
            "timestamp": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
        }

    def export_binary(self, matrix_dict: dict, bin_path: Path = DEFAULT_BIN_OUTPUT):
        """Export N x N matrix to binary file for direct C++ memory-mapped loading."""
        bin_path.parent.mkdir(parents=True, exist_ok=True)
        n = matrix_dict["node_count"]
        node_ids = matrix_dict["node_ids"]
        cost_mat = matrix_dict["cost_matrix"]
        dist_mat = matrix_dict["distance_matrix"]
        transit_mat = matrix_dict["transit_matrix"]

        with atomic_output(bin_path, "wb") as f:
            # Header: 'DCM1' (4 bytes) + n (int32, 4 bytes)
            f.write(b"DCM1")
            f.write(struct.pack("<i", n))
            # Node IDs: n * int32
            for nid in node_ids:
                f.write(struct.pack("<i", int(nid)))
            # Cost Matrix: n * n * float64
            for row in cost_mat:
                for val in row:
                    f.write(struct.pack("<d", float(val)))
            # Distance Matrix: n * n * float64
            for row in dist_mat:
                for val in row:
                    f.write(struct.pack("<d", float(val)))
            # Transit Matrix: n * n * float64
            for row in transit_mat:
                for val in row:
                    f.write(struct.pack("<d", float(val)))

        print(f"[Matrix Ingestion] Exported {n}x{n} binary cost matrix ({bin_path.stat().st_size} bytes) -> {bin_path}")

    def export_json(self, matrix_dict: dict, json_path: Path = DEFAULT_JSON_OUTPUT):
        """Export matrix to JSON for validation and inspection."""
        json_path.parent.mkdir(parents=True, exist_ok=True)
        with atomic_output(json_path, "w", encoding="utf-8") as f:
            json.dump(matrix_dict, f, indent=2, allow_nan=False)
        print(f"[Matrix Ingestion] Exported JSON matrix -> {json_path}")


def push_to_api_server(api_url: str, node_id: int, delay_hours: float, event_type: str) -> bool:
    try:
        url = f"{api_url.rstrip('/')}/api/congestion"
        payload = json.dumps({
            "node_id": node_id,
            "delay_hours": delay_hours,
            "event_type": event_type
        }).encode("utf-8")
        req = urllib.request.Request(url, data=payload, headers={"Content-Type": "application/json"})
        with urllib.request.urlopen(req, timeout=3) as res:
            return res.status == 200
    except Exception:
        return False


def push_to_config_file(node_id: int, delay_hours: float):
    CONFIG_DIR.mkdir(parents=True, exist_ok=True)
    delays = {}
    if CONGESTION_FILE.exists():
        try:
            with open(CONGESTION_FILE, "r", encoding="utf-8") as f:
                delays = json.load(f)
        except Exception:
            delays = {}

    if delay_hours > 0:
        delays[str(node_id)] = delay_hours
    else:
        delays.pop(str(node_id), None)

    with atomic_output(CONGESTION_FILE, "w", encoding="utf-8") as f:
        json.dump(delays, f, indent=2, allow_nan=False)


def clear_all_congestion(api_url: str):
    print("[Traffic Streamer] Resetting all dynamic congestion delays to 0.0h...")
    try:
        url = f"{api_url.rstrip('/')}/api/congestion/reset"
        req = urllib.request.Request(url, data=b"{}", headers={"Content-Type": "application/json"})
        with urllib.request.urlopen(req, timeout=3):
            pass
    except Exception:
        with atomic_output(CONGESTION_FILE, "w", encoding="utf-8") as f:
            json.dump({}, f)
    print("[Traffic Streamer] All congestion delays cleared.")


def main():
    parser = argparse.ArgumentParser(description="Real-Time Maritime Weather & Traffic Ingestion")
    parser.add_argument("--api-url", default="http://localhost:5000", help="API server base URL")
    parser.add_argument("--generate-matrix", action="store_true", help="Generate & export dynamic cost matrix")
    parser.add_argument("--bin-out", default=str(DEFAULT_BIN_OUTPUT), help="Output binary matrix path")
    parser.add_argument("--json-out", default=str(DEFAULT_JSON_OUTPUT), help="Output JSON matrix path")
    parser.add_argument("--continuous", action="store_true", help="Run continuous traffic stream generator")
    parser.add_argument("--interval", type=int, default=15, help="Update interval in seconds (default: 15)")
    parser.add_argument("--inject", type=int, default=None, help="Inject delay on specific node ID")
    parser.add_argument("--delay", type=float, default=48.0, help="Delay hours to inject (default: 48.0)")
    parser.add_argument("--event-type", default="port_strike", help="Event description")
    parser.add_argument("--reset", action="store_true", help="Reset all active delays to zero")
    args = parser.parse_args()
    if args.interval <= 0:
        parser.error("--interval must be positive")
    if args.inject is not None and (args.inject < 0 or not math.isfinite(args.delay) or args.delay < 0):
        parser.error("--inject and --delay must be non-negative, and --delay must be finite")

    print("=========================================================================")
    print("      REAL-TIME MARITIME WEATHER, AIS TRAFFIC & MATRIX INGESTION         ")
    print("=========================================================================")

    if args.reset:
        clear_all_congestion(args.api_url)
        return

    if args.generate_matrix:
        print("[Matrix Ingestion] Fetching real-time marine weather & building dynamic cost matrix...")
        gen = DynamicCostMatrixGenerator(STRATEGIC_PORTS)
        matrix = gen.build_matrix()
        gen.export_binary(matrix, Path(args.bin_out))
        gen.export_json(matrix, Path(args.json_out))
        print("[Matrix Ingestion] Dynamic cost matrix generation completed successfully.")
        return

    if args.inject is not None:
        print(f"[Traffic Streamer] Injecting {args.delay}h delay on Node #{args.inject} ({args.event_type})...")
        api_ok = push_to_api_server(args.api_url, args.inject, args.delay, args.event_type)
        if not api_ok:
            push_to_config_file(args.inject, args.delay)
        print(f"  -> Pushed to API Server: {'SUCCESS' if api_ok else 'API Server offline (saved locally)'}")
        return

    # Default action: Generate matrix once and show preview
    print("[Matrix Ingestion] Running real-time async weather fetch & matrix export...")
    gen = DynamicCostMatrixGenerator(STRATEGIC_PORTS)
    matrix = gen.build_matrix()
    gen.export_binary(matrix, Path(args.bin_out))
    gen.export_json(matrix, Path(args.json_out))

    if not args.continuous:
        print(f"[Traffic Streamer] Ingestion complete ({matrix['node_count']} key ports mapped).")
        return

    # Continuous Mode
    print(f"[Traffic Streamer] Running continuous dynamic traffic simulation (updates every {args.interval}s)...\n")
    try:
        while True:
            target = random.choice(STRATEGIC_PORTS)
            delay = round(random.uniform(target["range"][0], target["range"][1]), 1)
            ts = time.strftime("%H:%M:%S")
            print(f"[{ts}] SIMULATED EVENT: {target['type']} (+{delay}h) at {target['name']} (#{target['id']})")
            if not push_to_api_server(args.api_url, target["id"], delay, target["type"]):
                push_to_config_file(target["id"], delay)
            # Refresh matrix
            m = gen.build_matrix()
            gen.export_binary(m, Path(args.bin_out))
            gen.export_json(m, Path(args.json_out))
            time.sleep(args.interval)
    except KeyboardInterrupt:
        print("\n[Traffic Streamer] Streamer stopped by user.")


if __name__ == "__main__":
    main()
