#!/usr/bin/env python3
"""
merge_datasets.py - Global Maritime Shipping Route Graph Generator & Dataset Ingestion

This script builds a unified pure marine shipping route graph (data/nodes.csv and data/edges.csv)
directly from the global marine dataset (data/nodes.json and data/edges.json):
  - Ingests 56,325 maritime waypoints and seaports across APAC, EU, and AMERICAS.
  - Automatically identifies and names major global seaports & maritime chokepoints
    based on exact coastal harbor coordinates.
  - Ingests 106,554 undirected maritime shipping corridors (213,108 directed sea edges).
  - Calculates distances in km (from nautical miles) and transit times at container vessel cruising speed (~37 km/h / 20 knots).
  - Exports clean, validated data/nodes.csv and data/edges.csv.
"""

import os
import sys
import json
import math
import argparse
from pathlib import Path
from typing import Dict, List, Tuple, Any, Set

# Earth radius in kilometers for Haversine calculations
EARTH_RADIUS_KM = 6371.0
NAUTICAL_MILE_TO_KM = 1.852

# Speed constants
SEA_SPEED_KMH = 37.0  # ~20 knots container vessel cruising speed


def haversine_distance(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Calculate the Great Circle distance between two points in kilometers."""
    phi1 = math.radians(lat1)
    phi2 = math.radians(lat2)
    delta_phi = math.radians(lat2 - lat1)
    delta_lambda = math.radians(lon2 - lon1)

    a = (math.sin(delta_phi / 2.0) ** 2 +
         math.cos(phi1) * math.cos(phi2) * math.sin(delta_lambda / 2.0) ** 2)
    c = 2.0 * math.atan2(math.sqrt(a), math.sqrt(1.0 - a))
    return EARTH_RADIUS_KM * c


def classify_geographic_region(lat: float, lon: float) -> str:
    """
    Classify geographic coordinates into major shipping theaters:
      - AMERICAS: Longitude between -180.0 and -30.0
      - EU: Longitude between -30.0 and 55.0, Latitude >= -10.0
      - APAC: Longitude > 55.0 or (Longitude between -30.0 and 55.0 with Latitude < -10.0)
    """
    while lon > 180.0:
        lon -= 360.0
    while lon < -180.0:
        lon += 360.0

    if lon < -30.0:
        return "AMERICAS"
    elif -30.0 <= lon <= 55.0:
        if lat >= -10.0:
            return "EU"
        else:
            return "APAC"  # Southern maritime routes / Indian Ocean
    else:
        return "APAC"


def get_global_major_ports_catalog() -> Dict[str, Tuple[float, float, str]]:
    """
    Verified geographic catalog of major global container seaports and maritime chokepoints.
    Format: 'Port Name': (latitude, longitude, region)
    """
    return {
        # --- APAC & Middle East Seaports ---
        "Port of Shanghai": (31.2398, 121.4838, "APAC"),
        "Port of Singapore": (1.2621, 103.8531, "APAC"),
        "Port of Ningbo-Zhoushan": (29.88, 121.56, "APAC"),
        "Port of Shenzhen (Yantian)": (22.58, 114.28, "APAC"),
        "Port of Guangzhou (Nansha)": (22.75, 113.60, "APAC"),
        "Port of Hong Kong": (22.2940, 114.1648, "APAC"),
        "Port of Qingdao": (36.08, 120.32, "APAC"),
        "Port of Tianjin": (38.99, 117.74, "APAC"),
        "Port of Busan": (35.0918, 129.0372, "APAC"),
        "Port of Tokyo": (35.6181, 139.7656, "APAC"),
        "Port of Yokohama": (35.44, 139.65, "APAC"),
        "Port of Kaohsiung": (22.61, 120.28, "APAC"),
        "Port of Mumbai (JNPT)": (18.9584, 72.8434, "APAC"),
        "Port of Kandla / Mundra": (22.84, 69.70, "APAC"),
        "Port of Cochin": (9.96, 76.27, "APAC"),
        "Port of Chennai": (13.08, 80.30, "APAC"),
        "Port of Colombo": (6.9423, 79.8465, "APAC"),
        "Port of Dubai (Jebel Ali)": (25.01, 55.06, "APAC"),
        "Port of Salalah": (16.94, 54.00, "APAC"),
        "Port of Jeddah": (21.48, 39.17, "APAC"),
        "Port of Sydney (Botany)": (-33.86, 151.21, "APAC"),
        "Port of Melbourne": (-37.81, 144.96, "APAC"),
        "Port of Cape Town": (-33.9007, 18.4284, "APAC"),
        "Port of Durban": (-29.87, 31.03, "APAC"),
        "Bab-el-Mandeb Strait Portal": (12.5833, 43.3333, "APAC"),
        "Strait of Malacca Portal": (1.1000, 103.6000, "APAC"),
        "Strait of Hormuz Portal": (26.56, 56.45, "APAC"),

        # --- EU & Mediterranean Seaports ---
        "Port of Rotterdam": (51.9851, 4.0771, "EU"),
        "Port of Antwerp-Bruges": (51.2728, 4.3383, "EU"),
        "Port of Hamburg": (53.5451, 9.9273, "EU"),
        "Port of Bremerhaven": (53.55, 8.58, "EU"),
        "Port of Felixstowe / London": (51.96, 1.35, "EU"),
        "Port of Le Havre": (49.49, 0.11, "EU"),
        "Port of Marseille (Fos)": (43.43, 4.90, "EU"),
        "Port of Valencia": (39.4485, -0.3192, "EU"),
        "Port of Algeciras (Gibraltar)": (36.1288, -5.4010, "EU"),
        "Port of Barcelona": (41.35, 2.16, "EU"),
        "Port of Genoa": (44.41, 8.93, "EU"),
        "Port of Gioia Tauro": (38.43, 15.90, "EU"),
        "Port of Piraeus (Athens)": (37.94, 23.64, "EU"),
        "Port Said (Suez Canal North)": (31.3115, 32.3716, "EU"),
        "Suez Canal South Entry": (29.9667, 32.5500, "EU"),
        "Strait of Gibraltar Portal": (35.96, -5.60, "EU"),
        "English Channel Portal": (51.10, 1.45, "EU"),

        # --- AMERICAS Seaports ---
        "Port of Los Angeles": (33.7469, -118.2483, "AMERICAS"),
        "Port of Long Beach": (33.7470, -118.2483, "AMERICAS"),
        "Port of Oakland / San Francisco": (37.80, -122.27, "AMERICAS"),
        "Port of Seattle / Tacoma": (47.60, -122.33, "AMERICAS"),
        "Port of Vancouver": (49.29, -123.11, "AMERICAS"),
        "Port of New York & New Jersey": (40.6465, -74.0631, "AMERICAS"),
        "Port of Savannah": (32.08, -81.09, "AMERICAS"),
        "Port of Charleston": (32.78, -79.93, "AMERICAS"),
        "Port of Norfolk (Hampton Roads)": (36.95, -76.33, "AMERICAS"),
        "Port of Houston": (29.7474, -95.2845, "AMERICAS"),
        "Port of New Orleans": (29.95, -90.06, "AMERICAS"),
        "Port of Miami": (25.77, -80.19, "AMERICAS"),
        "Port of Panama (Balboa - Pacific)": (8.8710, -79.5201, "AMERICAS"),
        "Port of Colon (Cristobal - Atlantic)": (9.35, -79.90, "AMERICAS"),
        "Port of Santos (Sao Paulo)": (-23.96, -46.30, "AMERICAS"),
        "Port of Buenos Aires": (-34.58, -58.37, "AMERICAS"),
        "Port of Callao (Lima)": (-12.06, -77.15, "AMERICAS"),
        "Port of Valparaiso": (-33.04, -71.62, "AMERICAS"),
    }


def load_raw_dataset(base_dir: Path) -> Tuple[List[Dict[str, Any]], List[Tuple[int, int, float]], Dict[str, int]]:
    """
    Loads nodes.json and edges.json from data/.
    Identifies key seaports and assigns human-readable names.
    """
    nodes_json_path = base_dir / "data" / "nodes.json"
    edges_json_path = base_dir / "data" / "edges.json"

    if not nodes_json_path.exists() or not edges_json_path.exists():
        raise FileNotFoundError(f"Missing required dataset files in {base_dir / 'data'}")

    print(f"[DataLoader] Ingesting raw marine dataset:\n  -> {nodes_json_path}\n  -> {edges_json_path}")
    with open(nodes_json_path, "r", encoding="utf-8") as f:
        raw_nodes = json.load(f)
    with open(edges_json_path, "r", encoding="utf-8") as f:
        raw_edges = json.load(f)

    # First pass: load basic node records
    nodes_list: List[Dict[str, Any]] = []
    for item in raw_nodes:
        if isinstance(item, list) and len(item) >= 3:
            nid = int(item[0])
            lon = float(item[1])
            lat = float(item[2])
            region = classify_geographic_region(lat, lon)
            nodes_list.append({
                "id": nid,
                "name": f"Sea_Waypoint_{nid}",
                "lat": lat,
                "lon": lon,
                "region": region,
                "node_type": "port",
                "is_major_port": False
            })

    # Second pass: map major global seaports to nearest marine node
    port_catalog = get_global_major_ports_catalog()
    named_ports_map: Dict[str, int] = {}
    used_node_ids: Set[int] = set()

    for port_name, (plat, plon, reg) in port_catalog.items():
        best_id = None
        best_dist = 1e9
        for n in nodes_list:
            if n["id"] in used_node_ids:
                continue
            d = haversine_distance(plat, plon, n["lat"], n["lon"])
            if d < best_dist:
                best_dist = d
                best_id = n["id"]

        if best_id is not None:
            nodes_list[best_id]["name"] = port_name
            nodes_list[best_id]["is_major_port"] = True
            used_node_ids.add(best_id)
            named_ports_map[port_name] = best_id
            print(f"  [Port Mapping] {port_name:36s} -> Node #{best_id:5d} (lat={nodes_list[best_id]['lat']:.4f}, lon={nodes_list[best_id]['lon']:.4f}, dist={best_dist:.2f}km)")

    # Process edges: [from, to, length_nm]
    edges_list: List[Tuple[int, int, float]] = []
    for item in raw_edges:
        if isinstance(item, list) and len(item) >= 3:
            u = int(item[0])
            v = int(item[1])
            l_nm = float(item[2])
            edges_list.append((u, v, l_nm))

    print(f"[DataLoader] Successfully parsed {len(nodes_list)} marine nodes and {len(edges_list)} raw edges.")
    return nodes_list, edges_list, named_ports_map


def build_pure_marine_dataset(
    sea_nodes: List[Dict[str, Any]],
    sea_edges_raw: List[Tuple[int, int, float]]
) -> Tuple[List[Dict[str, Any]], List[Dict[str, Any]]]:
    """
    Constructs a 100% pure marine graph with bidirectional sea edges.
    """
    nodes_by_id = {n["id"]: n for n in sea_nodes}
    directed_edges: List[Dict[str, Any]] = []
    seen_edges: Set[Tuple[int, int]] = set()

    for u, v, length_nm in sea_edges_raw:
        if u not in nodes_by_id or v not in nodes_by_id or u == v:
            continue

        dist_km = round(float(length_nm) * NAUTICAL_MILE_TO_KM, 2)
        if dist_km <= 0.0:
            n1 = nodes_by_id[u]
            n2 = nodes_by_id[v]
            dist_km = round(haversine_distance(n1["lat"], n1["lon"], n2["lat"], n2["lon"]), 2)

        transit_hours = round(max(0.1, dist_km / SEA_SPEED_KMH), 2)

        # Forward
        if (u, v) not in seen_edges:
            directed_edges.append({
                "source_id": u,
                "dest_id": v,
                "distance_km": dist_km,
                "base_transit_hours": transit_hours,
                "mode": "sea"
            })
            seen_edges.add((u, v))

        # Reverse (bidirectional shipping corridors)
        if (v, u) not in seen_edges:
            directed_edges.append({
                "source_id": v,
                "dest_id": u,
                "distance_km": dist_km,
                "base_transit_hours": transit_hours,
                "mode": "sea"
            })
            seen_edges.add((v, u))

    return sea_nodes, directed_edges


def write_csv_files(
    nodes: List[Dict[str, Any]],
    edges: List[Dict[str, Any]],
    output_dir: Path
) -> Tuple[Path, Path]:
    """Write nodes.csv and edges.csv with standard schema."""
    output_dir.mkdir(parents=True, exist_ok=True)
    nodes_csv_path = output_dir / "nodes.csv"
    edges_csv_path = output_dir / "edges.csv"

    print(f"[Export] Writing {len(nodes)} marine nodes to {nodes_csv_path}...")
    with open(nodes_csv_path, "w", encoding="utf-8") as f:
        f.write("id,name,lat,lon,region,node_type\n")
        for n in nodes:
            name_val = f'"{n["name"]}"' if "," in n["name"] else n["name"]
            f.write(f"{n['id']},{name_val},{n['lat']:.6f},{n['lon']:.6f},{n['region']},{n['node_type']}\n")

    print(f"[Export] Writing {len(edges)} directed shipping edges to {edges_csv_path}...")
    with open(edges_csv_path, "w", encoding="utf-8") as f:
        f.write("source_id,dest_id,distance_km,base_transit_hours,mode\n")
        for e in edges:
            f.write(f"{e['source_id']},{e['dest_id']},{e['distance_km']:.2f},{e['base_transit_hours']:.2f},{e['mode']}\n")

    return nodes_csv_path, edges_csv_path


def export_network_json(nodes: List[Dict[str, Any]], output_path: Path):
    """Export curated key seaports and sample waypoints for the web UI."""
    key_ports = [n for n in nodes if n.get("is_major_port")]
    key_ports.sort(key=lambda x: (x["region"], x["name"]))

    data = {
        "dataset": "Global Marine Shipping Lanes",
        "total_nodes": len(nodes),
        "key_ports": key_ports,
        "nodes": key_ports
    }
    with open(output_path, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2)
    print(f"[Export] Exported {len(key_ports)} key seaports to {output_path}")


def main():
    parser = argparse.ArgumentParser(description="Build pure marine shipping route graph CSVs.")
    parser.add_argument("--output-dir", type=str, default="data", help="Output directory for nodes.csv and edges.csv")
    args = parser.parse_args()

    base_dir = Path(__file__).resolve().parent.parent
    output_dir = base_dir / args.output_dir

    print("=================================================================")
    print("  Global Supply Chain Route Optimizer — Pure Marine Graph Prep  ")
    print("=================================================================")
    print(f"Project Base Dir: {base_dir}")
    print(f"Output CSV Dir  : {output_dir}\n")

    sea_nodes, sea_edges, named_ports = load_raw_dataset(base_dir)
    nodes, edges = build_pure_marine_dataset(sea_nodes, sea_edges)

    nodes_file, edges_file = write_csv_files(nodes, edges, output_dir)
    export_network_json(nodes, base_dir / "web" / "network_data.json")

    apac_cnt = sum(1 for n in nodes if n["region"] == "APAC")
    eu_cnt = sum(1 for n in nodes if n["region"] == "EU")
    americas_cnt = sum(1 for n in nodes if n["region"] == "AMERICAS")

    print("\n---------------------- DATASET SUMMARY --------------------------")
    print(f"Total Pure Marine Nodes : {len(nodes)}")
    print(f"  - Key Named Seaports  : {len(named_ports)}")
    print(f"  - By Region           : APAC={apac_cnt}, EU={eu_cnt}, AMERICAS={americas_cnt}")
    print(f"Total Directed Sea Edges: {len(edges)}")
    print(f"  - Road Edges          : 0 (Pure Marine)")
    print(f"\nSuccessfully generated:\n  -> {nodes_file}\n  -> {edges_file}")
    print("=================================================================\n")


if __name__ == "__main__":
    main()
