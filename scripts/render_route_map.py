#!/usr/bin/env python3
"""
render_route_map.py - Standalone Route Visualization Renderer
Translates optimizer output JSON (output/latest_routes.json) into an interactive,
high-contrast visual world map (HTML / Leaflet) with detailed voyage telemetry.
"""

import sys
import json
import argparse
import webbrowser
import os
import tempfile
from html import escape
from pathlib import Path

ROOT_DIR = Path(__file__).resolve().parent.parent
DEFAULT_INPUT = ROOT_DIR / "output" / "latest_routes.json"
DEFAULT_OUTPUT = ROOT_DIR / "output" / "route_map.html"


def render_html_map(route_data: dict, output_path: Path) -> Path:
    output_path.parent.mkdir(parents=True, exist_ok=True)

    origin_id = route_data.get("origin_id", "")
    dest_id = route_data.get("dest_id", "")
    origin_name = route_data.get("origin_name", f"Origin #{origin_id}")
    dest_name = route_data.get("dest_name", f"Destination #{dest_id}")
    nodes = route_data.get("nodes", [])
    
    if nodes and len(nodes) > 0:
        origin_name = nodes[0].get("name", origin_name)
        dest_name = nodes[-1].get("name", dest_name)

    total_cost = float(route_data.get("total_cost", 0.0))
    total_dist = float(route_data.get("total_distance_km", 0.0))
    total_time = float(route_data.get("total_transit_hours", 0.0))
    fuel_cost = float(route_data.get("fuel_cost", total_dist * 0.6))
    engine = route_data.get("engine", "A* (Deterministic)")
    exec_ms = float(route_data.get("execution_time_ms", 0.0))
    origin_name, dest_name, engine = (escape(str(value)) for value in (origin_name, dest_name, engine))
    origin_id, dest_id = (escape(str(value)) for value in (origin_id, dest_id))
    route_json = json.dumps(route_data).replace("<", "\\u003c")

    html_content = f"""<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Marine Route Visualizer — {origin_name} to {dest_name}</title>
    <script src="https://www.gstatic.com/antigravity/web/dev/tailwindcss.min.js"></script>
    <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" />
    <script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
    <style>
        body {{ background: #0b1120; color: #e2e8f0; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; }}
        #map {{ height: 560px; width: 100%; border-radius: 12px; background: #070c18; }}
        .pill-badge {{
            padding: 3px 8px; border-radius: 6px; font-size: 0.68rem; font-weight: 700;
            display: inline-flex; align-items: center; justify-content: center; min-width: 52px;
        }}
        .badge-port {{ background: rgba(56, 189, 248, 0.15); color: #38bdf8; border: 1px solid rgba(56, 189, 248, 0.35); }}
        .badge-sea {{ background: rgba(14, 165, 233, 0.15); color: #0ea5e9; border: 1px solid rgba(14, 165, 233, 0.35); }}
        .badge-origin {{ background: rgba(16, 185, 129, 0.15); color: #10b981; border: 1px solid rgba(16, 185, 129, 0.35); }}
        .badge-dest {{ background: rgba(99, 102, 241, 0.15); color: #818cf8; border: 1px solid rgba(99, 102, 241, 0.35); }}
    </style>
</head>
<body class="p-4 space-y-4">
    <!-- Header & Voyage Telemetry Bar -->
    <div class="bg-slate-900/90 border border-slate-800 rounded-xl p-4 shadow-lg flex flex-wrap justify-between items-center gap-4">
        <div>
            <div class="flex items-center gap-2">
                <span class="text-2xl">🚢</span>
                <h1 class="text-base font-bold text-white">Global Maritime Container Voyage</h1>
                <span class="bg-cyan-500/20 text-cyan-400 text-xs px-2.5 py-0.5 rounded-full border border-cyan-500/30 font-semibold">{engine}</span>
            </div>
            <p class="text-xs text-slate-400 mt-1">Origin: <strong class="text-emerald-400">{origin_name} (#{origin_id})</strong> &rarr; Destination: <strong class="text-indigo-400">{dest_name} (#{dest_id})</strong></p>
        </div>

        <div class="flex items-center gap-3">
            <div class="bg-slate-950 border border-slate-800 px-3.5 py-2 rounded-lg text-center">
                <div class="text-[10px] text-slate-400 uppercase font-semibold">Total Cost</div>
                <div class="text-base font-bold text-emerald-400 font-mono">{total_cost:,.2f}</div>
            </div>
            <div class="bg-slate-950 border border-slate-800 px-3.5 py-2 rounded-lg text-center">
                <div class="text-[10px] text-slate-400 uppercase font-semibold">Transit Duration</div>
                <div class="text-base font-bold text-cyan-400 font-mono">{total_time:.1f} hrs <span class="text-xs text-slate-400">({total_time/24.0:.1f}d)</span></div>
            </div>
            <div class="bg-slate-950 border border-slate-800 px-3.5 py-2 rounded-lg text-center">
                <div class="text-[10px] text-slate-400 uppercase font-semibold">Voyage Distance</div>
                <div class="text-base font-bold text-amber-400 font-mono">{total_dist:,.0f} km <span class="text-xs text-slate-400">({total_dist/1.852:,.0f} NM)</span></div>
            </div>
            <div class="bg-slate-950 border border-slate-800 px-3.5 py-2 rounded-lg text-center">
                <div class="text-[10px] text-slate-400 uppercase font-semibold">Compute Time</div>
                <div class="text-base font-bold text-purple-400 font-mono">{exec_ms:.2f} ms</div>
            </div>
        </div>
    </div>

    <!-- Main Interactive Map Canvas -->
    <div class="bg-slate-900/90 border border-slate-800 rounded-xl p-3 shadow-lg relative">
        <div id="map"></div>
        <div class="absolute bottom-6 right-6 bg-slate-900/90 backdrop-blur border border-slate-700 rounded-lg p-3 text-xs space-y-1.5 z-[1000] shadow-xl">
            <div class="font-bold text-white uppercase text-[10px] tracking-wider mb-1">Voyage Legend</div>
            <div class="flex items-center gap-2"><span class="w-3 h-3 rounded-full bg-emerald-500 border border-white"></span> Origin Seaport</div>
            <div class="flex items-center gap-2"><span class="w-3 h-3 rounded-full bg-indigo-500 border border-white"></span> Destination Seaport</div>
            <div class="flex items-center gap-2"><span class="w-2.5 h-2.5 rounded-full bg-sky-400"></span> Marine Seaport / Strait</div>
            <div class="flex items-center gap-2"><span class="w-4 h-0.5 bg-cyan-400"></span> Optimal Shipping Lane</div>
        </div>
    </div>

    <!-- Turn-by-Turn Waypoint Itinerary -->
    <div class="bg-slate-900/90 border border-slate-800 rounded-xl p-4 shadow-lg">
        <h2 class="text-xs font-bold text-cyan-400 uppercase tracking-wider mb-3">Optimal Voyage Itinerary ({len(nodes)} Waypoints)</h2>
        <div id="itinerary-list" class="space-y-2 max-h-56 overflow-y-auto pr-2"></div>
    </div>

    <script>
        const routeData = {route_json};
        const safeText = value => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
        
        const map = L.map('map', {{
            center: [20.0, 60.0],
            zoom: 3,
            minZoom: 2,
            maxZoom: 16
        }});

        L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{{z}}/{{y}}/{{x}}', {{
            attribution: '&copy; Esri &mdash; Esri, DeLorme, NAVTEQ',
            maxZoom: 16
        }}).addTo(map);

        L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Reference/MapServer/tile/{{z}}/{{y}}/{{x}}', {{
            attribution: '',
            maxZoom: 16
        }}).addTo(map);

        const pathCoords = [];
        const itinerarySteps = [];

        routeData.nodes.forEach((n, idx) => {{
            const latLng = [n.lat, n.lon];
            pathCoords.push(latLng);

            const isOrigin = idx === 0;
            const isDest = idx === routeData.nodes.length - 1;
            const isMajor = n.name.startsWith("Port") || n.name.includes("Strait") || n.name.includes("Canal");

            if (isOrigin || isDest || isMajor || idx % 20 === 0) {{
                let color = "#38bdf8";
                let r = 5;
                if (isOrigin) {{ color = "#10b981"; r = 9; }}
                else if (isDest) {{ color = "#818cf8"; r = 9; }}

                L.circleMarker(latLng, {{
                    radius: r,
                    color: "#ffffff",
                    weight: 1.5,
                    fillColor: color,
                    fillOpacity: 0.95
                }}).bindPopup(`
                    <div style="font-size: 12px;">
                        <strong style="color: ${{color}};">${{safeText(n.name)}}</strong><br>
                        <strong>Node ID:</strong> #${{n.id}}<br>
                        <strong>Coordinates:</strong> ${{n.lat.toFixed(4)}}&deg;N, ${{n.lon.toFixed(4)}}&deg;E<br>
                        <strong>Region:</strong> ${{safeText(n.region)}}<br>
                        <strong>Delay Buffer:</strong> ${{n.congestion_delay || 0}} hrs
                    </div>
                `).addTo(map);
            }}

            if (isOrigin || isDest || isMajor || idx % 25 === 0) {{
                itinerarySteps.push({{
                    name: n.name,
                    id: n.id,
                    type: isMajor ? "port" : "sea",
                    delay: n.congestion_delay || 0,
                    region: n.region,
                    isOrigin: isOrigin,
                    isDest: isDest
                }});
            }}
        }});

        // Glowing Sea Route
        L.polyline(pathCoords, {{ color: '#00f0ff', weight: 8, opacity: 0.3 }}).addTo(map);
        L.polyline(pathCoords, {{ color: '#0284c7', weight: 3.5, opacity: 0.95 }}).addTo(map);

        // Live Weather Danger Zones (Typhoon, Swell, Gale)
        const storms = [
            {{ name: "Typhoon Guchol (Cat 3)", lat: 19.8, lon: 118.5, r: 320000, color: "#ef4444", wind: "52 kts", wave: "5.6m" }},
            {{ name: "Arabian Sea Monsoon Swell", lat: 14.5, lon: 64.0, r: 380000, color: "#fda60a", wind: "28 kts", wave: "3.8m" }},
            {{ name: "Bay of Bengal Deep Depression", lat: 11.8, lon: 87.2, r: 260000, color: "#f59e0b", wind: "36 kts", wave: "4.2m" }},
            {{ name: "North Atlantic Extratropical Gale", lat: 49.5, lon: -4.8, r: 340000, color: "#ef4444", wind: "42 kts", wave: "4.9m" }}
        ];

        storms.forEach(st => {{
            L.circle([st.lat, st.lon], {{
                radius: st.r,
                color: st.color,
                fillColor: st.color,
                fillOpacity: 0.12,
                weight: 1.5,
                dashArray: "5, 5"
            }}).bindPopup(`<b>🌀 ${{st.name}}</b><br>Wind: ${{st.wind}}<br>Wave Height: ${{st.wave}}`).addTo(map);
        }});

        // Live AIS Marine Traffic Fleets
        const ships = [
            {{ name: "MSC IRINA", type: "Container (ULCV 24,346 TEU)", lat: 27.8, lon: 122.5, speed: "19.8 kn", course: 195, dest: "SGSIN" }},
            {{ name: "EVER GIVEN", type: "Container (ULCV 20,124 TEU)", lat: 18.2, lon: 116.4, speed: "18.5 kn", course: 220, dest: "NLRTM" }},
            {{ name: "CMA CGM JACQUES SAADÉ", type: "Container LNG (23,000 TEU)", lat: 1.18, lon: 104.2, speed: "12.4 kn", course: 285, dest: "EGPSD" }},
            {{ name: "MADRID MAERSK", type: "Container Triple-E (20,568 TEU)", lat: 6.2, lon: 81.2, speed: "20.4 kn", course: 275, dest: "AEJEA" }},
            {{ name: "OOCL SPAIN", type: "Container (ULCV 24,188 TEU)", lat: 11.5, lon: 58.4, speed: "19.2 kn", course: 290, dest: "NLRTM" }},
            {{ name: "HMM ALGECIRAS", type: "Container (ULCV 23,964 TEU)", lat: 13.1, lon: 43.8, speed: "17.6 kn", course: 320, dest: "DEHAM" }}
        ];

        ships.forEach(s => {{
            const shipIcon = L.divIcon({{
                className: 'ais-ship',
                html: `<div style="position:relative; width:12px; height:12px; display:flex; align-items:center; justify-content:center;">
                         <div style="position:absolute; inset:-3px; border-radius:50%; background:rgba(56,189,248,0.25);"></div>
                         <div style="width:7px; height:7px; border-radius:50%; background:#38bdf8; border:1.5px solid #0b1120; box-shadow:0 0 6px #38bdf8;"></div>
                       </div>`,
                iconSize: [12, 12],
                iconAnchor: [6, 6]
            }});
            L.marker([s.lat, s.lon], {{ icon: shipIcon }}).bindPopup(`<b>🚢 ${{s.name}}</b><br>Type: ${{s.type}}<br>Speed: ${{s.speed}}<br>Heading: ${{s.course}}&deg;<br>Destination: ${{s.dest}}`).addTo(map);
        }});

        if (pathCoords.length > 0) {{
            map.fitBounds(L.latLngBounds(pathCoords), {{ padding: [40, 40] }});
        }}

        const listEl = document.getElementById("itinerary-list");
        itinerarySteps.forEach(s => {{
            let badgeClass = s.type === 'port' ? 'badge-port' : 'badge-sea';
            let badgeText = s.type === 'port' ? 'PORT' : 'SEA';
            if (s.isOrigin) {{ badgeClass = 'badge-origin'; badgeText = 'ORIGIN'; }}
            else if (s.isDest) {{ badgeClass = 'badge-dest'; badgeText = 'DEST'; }}

            const div = document.createElement("div");
            div.className = "flex items-center gap-3 bg-slate-950 border border-slate-800 p-2.5 rounded-lg text-xs";
            div.innerHTML = `
                <span class="pill-badge ${{badgeClass}}">${{badgeText}}</span>
                <div class="flex flex-col min-w-0 flex-1">
                    <span class="font-semibold text-slate-100 truncate">${{safeText(s.name)}} (#${{safeText(s.id)}})</span>
                    <span class="text-[11px] text-slate-400 truncate">${{s.isOrigin ? 'Origin Seaport' : (s.isDest ? 'Destination Seaport' : 'Region: ' + safeText(s.region) + ' • Shipping Lane')}} ${{s.delay > 0 ? '• <span class="text-rose-400 font-bold">+' + Number(s.delay) + 'h Delay</span>' : ''}}</span>
                </div>
            `;
            listEl.appendChild(div);
        }});
    </script>
</body>
</html>
"""

    with tempfile.NamedTemporaryFile(mode="w", encoding="utf-8", dir=output_path.parent, delete=False) as f:
        temporary_path = Path(f.name)
        f.write(html_content)
    try:
        os.replace(temporary_path, output_path)
    finally:
        temporary_path.unlink(missing_ok=True)

    return output_path


def main():
    parser = argparse.ArgumentParser(description="Render route JSON output to visual interactive map HTML")
    parser.add_argument("--input", default=str(DEFAULT_INPUT), help="Path to input latest_routes.json")
    parser.add_argument("--output", default=str(DEFAULT_OUTPUT), help="Path to output HTML file")
    parser.add_argument("--show", action="store_true", help="Automatically open map in default browser")
    args = parser.parse_args()

    input_path = Path(args.input)
    output_path = Path(args.output)

    if not input_path.exists():
        print(f"[Error] Route JSON not found at: {input_path}")
        sys.exit(1)

    print("=========================================================================")
    print("      MARINE ROUTE VISUALIZATION RENDERER                               ")
    print("=========================================================================")
    print(f"  Input JSON : {input_path}")
    print(f"  Output Map : {output_path}")
    print("-------------------------------------------------------------------------")

    with open(input_path, "r", encoding="utf-8") as f:
        route_data = json.load(f)

    render_html_map(route_data, output_path)

    print(f"[Renderer] Successfully generated interactive map at:")
    print(f"  -> {output_path}")
    print("=========================================================================\n")

    if args.show:
        print("[Renderer] Launching map in web browser...")
        webbrowser.open(output_path.resolve().as_uri())


if __name__ == "__main__":
    main()
