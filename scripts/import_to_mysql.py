#!/usr/bin/env python3
"""
Seed Data Import Script for MySQL Database
Global Supply Chain Route Optimizer

Imports data/nodes.csv and data/edges.csv into MySQL tables (`nodes` and `edges`).
Supports both direct MySQL connection (via mysql-connector-python / pymysql)
and generating bulk SQL dump files (.sql) for instant execution.
"""

import sys
import os
import csv
import argparse
import time

def parse_args():
    parser = argparse.ArgumentParser(description="Import multimodal network dataset into MySQL")
    parser.add_argument("--host", default=os.getenv("DB_HOST", "127.0.0.1"), help="MySQL Host")
    parser.add_argument("--port", type=int, default=int(os.getenv("DB_PORT", "3306")), help="MySQL Port")
    parser.add_argument("--user", default=os.getenv("DB_USER", "root"), help="MySQL User")
    parser.add_argument("--password", default=os.getenv("DB_PASS", ""), help="MySQL Password")
    parser.add_argument("--database", default=os.getenv("DB_NAME", "route_optimizer_db"), help="Database Name")
    parser.add_argument("--nodes", default="data/nodes.csv", help="Path to nodes.csv")
    parser.add_argument("--edges", default="data/edges.csv", help="Path to edges.csv")
    parser.add_argument("--batch-size", type=int, default=5000, help="Batch insert size")
    parser.add_argument("--generate-sql", action="store_true", help="Generate import.sql instead of connecting")
    parser.add_argument("--sql-output", default="sql/seed_data.sql", help="Output SQL file path if generating SQL")
    return parser.parse_args()

def generate_sql_dump(nodes_path, edges_path, output_sql_path):
    print(f"[SQL Export] Generating bulk SQL dump to '{output_sql_path}'...")
    start_time = time.time()

    with open(output_sql_path, "w", encoding="utf-8") as out:
        out.write("-- Auto-generated Seed Data SQL Dump for Route Optimizer\n")
        out.write("USE route_optimizer_db;\n\n")
        out.write("SET FOREIGN_KEY_CHECKS = 0;\n")
        out.write("TRUNCATE TABLE edges;\n")
        out.write("TRUNCATE TABLE nodes;\n\n")

        # 1. Export Nodes
        print(f"[SQL Export] Processing nodes from {nodes_path}...")
        node_count = 0
        with open(nodes_path, "r", encoding="utf-8") as f:
            reader = csv.DictReader(f)
            batch = []
            for row in reader:
                node_id = int(row["id"])
                name = row["name"].replace("'", "''").replace("\\", "\\\\")
                lat = float(row["lat"])
                lon = float(row["lon"])
                region = row.get("region", "APAC").replace("'", "''")
                node_type = row.get("node_type", "port").replace("'", "''")
                batch.append(f"({node_id}, '{name}', {lat:.6f}, {lon:.6f}, '{region}', 0.0, '{node_type}')")
                node_count += 1

                if len(batch) >= 1000:
                    out.write(f"INSERT INTO nodes (id, name, lat, lon, region, congestion_delay, node_type) VALUES\n  " + ",\n  ".join(batch) + ";\n")
                    batch = []

            if batch:
                out.write(f"INSERT INTO nodes (id, name, lat, lon, region, congestion_delay, node_type) VALUES\n  " + ",\n  ".join(batch) + ";\n")

        # 2. Export Edges
        print(f"[SQL Export] Processing edges from {edges_path}...")
        edge_count = 0
        with open(edges_path, "r", encoding="utf-8") as f:
            reader = csv.DictReader(f)
            batch = []
            for row in reader:
                src = int(row["source_id"])
                dst = int(row["dest_id"])
                dist = float(row["distance_km"])
                transit = float(row["base_transit_hours"])
                mode = row.get("mode", "sea").replace("'", "''")
                batch.append(f"({src}, {dst}, {dist:.2f}, {transit:.2f}, '{mode}')")
                edge_count += 1

                if len(batch) >= 1000:
                    out.write(f"INSERT INTO edges (source_id, dest_id, distance_km, base_transit_hours, mode) VALUES\n  " + ",\n  ".join(batch) + ";\n")
                    batch = []

            if batch:
                out.write(f"INSERT INTO edges (source_id, dest_id, distance_km, base_transit_hours, mode) VALUES\n  " + ",\n  ".join(batch) + ";\n")

        out.write("\nSET FOREIGN_KEY_CHECKS = 1;\n")

    duration = time.time() - start_time
    print(f"[SQL Export Complete] Exported {node_count} nodes and {edge_count} edges into '{output_sql_path}' in {duration:.2f}s.")

def import_direct_mysql(args):
    try:
        import mysql.connector
    except ImportError:
        try:
            import pymysql as mysql
        except ImportError:
            print("[Warning] Neither 'mysql-connector-python' nor 'pymysql' is installed.")
            print("[Notice] Falling back to generating SQL seed dump file...")
            generate_sql_dump(args.nodes, args.edges, args.sql_output)
            return

    print(f"[MySQL Import] Connecting to MySQL at {args.host}:{args.port} as '{args.user}'...")
    try:
        conn = mysql.connector.connect(
            host=args.host,
            port=args.port,
            user=args.user,
            password=args.password,
            database=args.database,
            autocommit=False
        )
    except Exception as e:
        print(f"[Error] Failed to connect to MySQL: {e}")
        print("[Notice] Generating SQL seed dump file instead...")
        generate_sql_dump(args.nodes, args.edges, args.sql_output)
        return

    cursor = conn.cursor()
    cursor.execute("SET FOREIGN_KEY_CHECKS = 0;")
    cursor.execute("TRUNCATE TABLE edges;")
    cursor.execute("TRUNCATE TABLE nodes;")

    # 1. Insert Nodes
    print(f"[MySQL Import] Ingesting nodes from {args.nodes}...")
    node_query = "INSERT INTO nodes (id, name, lat, lon, region, congestion_delay, node_type) VALUES (%s, %s, %s, %s, %s, %s, %s)"
    with open(args.nodes, "r", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        batch = []
        for row in reader:
            batch.append((
                int(row["id"]),
                row["name"],
                float(row["lat"]),
                float(row["lon"]),
                row.get("region", "APAC"),
                0.0,
                row.get("node_type", "port")
            ))
            if len(batch) >= args.batch_size:
                cursor.executemany(node_query, batch)
                conn.commit()
                batch = []
        if batch:
            cursor.executemany(node_query, batch)
            conn.commit()

    # 2. Insert Edges
    print(f"[MySQL Import] Ingesting edges from {args.edges}...")
    edge_query = "INSERT INTO edges (source_id, dest_id, distance_km, base_transit_hours, mode) VALUES (%s, %s, %s, %s, %s)"
    with open(args.edges, "r", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        batch = []
        for row in reader:
            batch.append((
                int(row["source_id"]),
                int(row["dest_id"]),
                float(row["distance_km"]),
                float(row["base_transit_hours"]),
                row.get("mode", "sea")
            ))
            if len(batch) >= args.batch_size:
                cursor.executemany(edge_query, batch)
                conn.commit()
                batch = []
        if batch:
            cursor.executemany(edge_query, batch)
            conn.commit()

    cursor.execute("SET FOREIGN_KEY_CHECKS = 1;")
    conn.commit()
    cursor.close()
    conn.close()
    print("[MySQL Import Complete] All tables successfully populated.")

def main():
    args = parse_args()
    if args.generate_sql:
        generate_sql_dump(args.nodes, args.edges, args.sql_output)
    else:
        import_direct_mysql(args)

if __name__ == "__main__":
    main()
