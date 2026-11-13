#!/usr/bin/env python3
"""
main.py - Unified Python Entrypoint for Global Marine Route Optimizer
Allows running:
  1. API Web Server:           python main.py --serve [--port 5000]
  2. Route Optimization CLI:   python main.py --optimize --origin 55196 --dest 21998 [--algorithm astar|ga]
  3. Interactive Map Renderer: python main.py --render [--show]
  4. Dynamic Traffic Streamer: python main.py --stream [--inject 49102 --delay 72]
"""

import sys
import os
import argparse
from pathlib import Path

# Add root directory to path
ROOT_DIR = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT_DIR))


def main():
    parser = argparse.ArgumentParser(description="Global Marine Container Route Optimizer — Master CLI")
    group = parser.add_mutually_exclusive_group(required=False)
    group.add_argument("--serve", action="store_true", help="Start the Flask REST API server & web dashboard")
    group.add_argument("--optimize", action="store_true", help="Run route optimization (A* or GA)")
    group.add_argument("--render", action="store_true", help="Render output route JSON to visual HTML map")
    group.add_argument("--stream", action="store_true", help="Run dynamic real-time traffic congestion streamer")

    # Options
    parser.add_argument("--host", default="127.0.0.1", help="API server host (default: 127.0.0.1)")
    parser.add_argument("--port", type=int, default=5000, help="API server port (default: 5000)")
    parser.add_argument("--origin", type=int, default=55196, help="Origin seaport ID (default: 55196 [Shanghai])")
    parser.add_argument("--dest", type=int, default=21998, help="Destination seaport ID (default: 21998 [Rotterdam])")
    parser.add_argument("--algorithm", default="astar", choices=["astar", "ga", "ASTAR", "GA"], help="Algorithm to use (default: astar)")
    parser.add_argument("--engine", type=str.lower, choices=["astar", "openmp", "cuda"], help="Compute engine")
    parser.add_argument("--input", default="output/latest_routes.json", help="Input route JSON for rendering")
    parser.add_argument("--output", default="output/route_map.html", help="Output HTML map path")
    parser.add_argument("--show", action="store_true", help="Open rendered map in web browser")
    parser.add_argument("--inject", type=int, default=None, help="Inject delay on node ID")
    parser.add_argument("--delay", type=float, default=48.0, help="Disruption delay hours")
    parser.add_argument("--continuous", action="store_true", help="Run continuous traffic streamer")

    args = parser.parse_args()

    if args.render:
        import scripts.render_route_map as renderer
        sys.argv = [sys.argv[0], "--input", args.input, "--output", args.output]
        if args.show:
            sys.argv.append("--show")
        renderer.main()
        return

    if args.stream:
        import scripts.stream_congestion as streamer
        sys.argv = [sys.argv[0]]
        if args.inject is not None:
            sys.argv.extend(["--inject", str(args.inject), "--delay", str(args.delay)])
        if args.continuous:
            sys.argv.append("--continuous")
        streamer.main()
        return

    if args.optimize:
        import subprocess
        from server import get_optimizer_binary
        bin_path = get_optimizer_binary()

        if not bin_path:
            print("[Error] Optimizer binary not found in build/. Please build with 'cmake --build build'.")
            sys.exit(1)

        selector = ["--engine", args.engine] if args.engine else ["--algorithm", args.algorithm.lower()]
        cmd = [bin_path, "--origin", str(args.origin), "--dest", str(args.dest), *selector]
        print(f"[Main CLI] Executing: {' '.join(cmd)}")
        res = subprocess.run(cmd, cwd=str(ROOT_DIR))
        sys.exit(res.returncode)

    # Default action: start API server
    import server
    print("[Main CLI] Starting REST API server and interactive web dashboard...")
    server.app.run(host=args.host, port=args.port, debug=False)


if __name__ == "__main__":
    main()
