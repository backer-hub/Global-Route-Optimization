#!/usr/bin/env python3
"""
generate_map_artifact.py - Generates standalone and artifact HTML map visualizers
for the Global Marine Shipping Route Optimizer.
"""
import json
import os

def main():
    root_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    routes_json_path = os.path.join(root_dir, "output", "latest_routes.json")

    with open(routes_json_path, "r", encoding="utf-8") as f:
        route_data = json.load(f)

    origin_name = route_data.get("origin_name", "Port of Shanghai")
    dest_name = route_data.get("dest_name", "Port of Rotterdam")
    origin_id = route_data.get("origin_id", 55196)
    dest_id = route_data.get("dest_id", 21998)
    if route_data.get("nodes") and len(route_data["nodes"]) > 0:
        origin_name = route_data["nodes"][0]["name"]
        dest_name = route_data["nodes"][-1]["name"]

    artifact_html_path = r"C:/Users/Mayank/.gemini/antigravity/brain/ef99a83a-cf39-4602-897a-e39c295f2426/world_map_viewer.html"
    web_map_path = os.path.join(root_dir, "web", "map_viewer.html")

    html_content = f"""<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <title>Global Marine Shipping Route Optimizer — World Map Dashboard</title>
    <script src="https://www.gstatic.com/antigravity/web/dev/tailwindcss.min.js"></script>
    <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" />
    <script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
    <style>
        #map {{ height: 480px; width: 100%; border-radius: 10px; background: #070c18; }}
        .pulse-dot {{ width: 8px; height: 8px; border-radius: 50%; background: #ef4444; display: inline-block; animation: pulse 1.5s infinite; }}
        @keyframes pulse {{
            0% {{ transform: scale(0.9); opacity: 0.8; }}
            50% {{ transform: scale(1.4); opacity: 1; }}
            100% {{ transform: scale(0.9); opacity: 0.8; }}
        }}
        .pill-badge {{
            padding: 3px 8px;
            border-radius: 6px;
            font-size: 0.68rem;
            font-weight: 700;
            letter-spacing: 0.04em;
            display: inline-flex;
            align-items: center;
            justify-content: center;
            flex-shrink: 0;
            min-width: 52px;
            text-align: center;
            line-height: 1.2;
        }}
        .badge-port {{ background: rgba(56, 189, 248, 0.15); color: #38bdf8; border: 1px solid rgba(56, 189, 248, 0.35); }}
        .badge-sea {{ background: rgba(14, 165, 233, 0.15); color: #0ea5e9; border: 1px solid rgba(14, 165, 233, 0.35); }}
        .badge-origin {{ background: rgba(16, 185, 129, 0.15); color: #10b981; border: 1px solid rgba(16, 185, 129, 0.35); }}
        .badge-dest {{ background: rgba(99, 102, 241, 0.15); color: #818cf8; border: 1px solid rgba(99, 102, 241, 0.35); }}
    </style>
</head>
<body class="bg-transparent text-[var(--foreground)] antialiased p-3">
    <div class="space-y-3">
        <!-- Header & Metrics -->
        <div class="bg-[var(--card)] border border-[var(--border)] rounded-xl p-4 shadow-sm flex flex-wrap justify-between items-center gap-3">
            <div>
                <div class="flex items-center gap-2">
                    <span class="text-2xl">🚢</span>
                    <h1 class="text-base font-bold text-[var(--foreground)]">Global Marine Container Shipping Route</h1>
                    <span class="bg-emerald-500/15 text-emerald-400 text-xs px-2 py-0.5 rounded-full border border-emerald-500/30 font-semibold">OPTIMAL GA SEA LANE</span>
                </div>
                <p class="text-xs text-[var(--muted-foreground)] mt-0.5">Origin: <strong class="text-emerald-400">{origin_name} (#{origin_id})</strong> &rarr; Destination: <strong class="text-indigo-400">{dest_name} (#{dest_id})</strong></p>
            </div>
            
            <div class="flex items-center gap-2">
                <div class="bg-[var(--background)] border border-[var(--border)] px-3 py-1.5 rounded-lg text-center">
                    <div class="text-[10px] text-[var(--muted-foreground)] uppercase font-semibold">Total Voyage Cost</div>
                    <div class="text-sm font-bold text-emerald-400 font-mono">${route_data['total_cost']:,.2f}</div>
                </div>
                <div class="bg-[var(--background)] border border-[var(--border)] px-3 py-1.5 rounded-lg text-center">
                    <div class="text-[10px] text-[var(--muted-foreground)] uppercase font-semibold">Transit Duration</div>
                    <div class="text-sm font-bold text-cyan-400 font-mono">{route_data['total_transit_hours']:.1f} hrs</div>
                </div>
                <div class="bg-[var(--background)] border border-[var(--border)] px-3 py-1.5 rounded-lg text-center">
                    <div class="text-[10px] text-[var(--muted-foreground)] uppercase font-semibold">Voyage Distance</div>
                    <div class="text-sm font-bold text-amber-400 font-mono">{route_data['total_distance_km']:,.0f} km</div>
                </div>
                <div class="bg-[var(--background)] border border-[var(--border)] px-3 py-1.5 rounded-lg text-center">
                    <div class="text-[10px] text-[var(--muted-foreground)] uppercase font-semibold">Sea Legs</div>
                    <div class="text-sm font-bold text-[var(--foreground)] font-mono">{route_data['path_length']} waypoints</div>
                </div>
            </div>
        </div>

        <!-- Main World Map Container -->
        <div class="bg-[var(--card)] border border-[var(--border)] rounded-xl p-3 shadow-sm relative">
            <div class="flex justify-between items-center mb-2">
                <div class="flex items-center gap-2">
                    <span class="text-xs font-semibold text-[var(--foreground)]">World Maritime Shipping Lanes & Seaports Map</span>
                </div>
                <div class="flex items-center gap-2">
                    <button id="btn-strike" class="bg-rose-600 hover:bg-rose-500 text-white text-[11px] font-semibold px-2.5 py-1 rounded-md shadow transition">🚨 Trigger Port Strike (+72h)</button>
                    <button id="btn-weather" class="bg-amber-600 hover:bg-amber-500 text-white text-[11px] font-semibold px-2.5 py-1 rounded-md shadow transition">⛈️ Typhoon Weather (+48h)</button>
                    <button id="btn-reset" class="bg-slate-700 hover:bg-slate-600 text-white text-[11px] font-semibold px-2.5 py-1 rounded-md shadow transition">🔄 Reset Delays</button>
                </div>
            </div>
            
            <div id="map"></div>
            
            <!-- Map Legend Overlay -->
            <div class="absolute bottom-6 right-6 bg-[var(--card)]/90 backdrop-blur border border-[var(--border)] rounded-lg p-2.5 text-[11px] space-y-1 z-[1000] shadow-lg">
                <div class="font-bold text-[var(--foreground)]">MARITIME LEGEND</div>
                <div class="flex items-center gap-2"><span class="w-2.5 h-2.5 rounded-full bg-emerald-500"></span> Origin Seaport ({origin_name})</div>
                <div class="flex items-center gap-2"><span class="w-2.5 h-2.5 rounded-full bg-indigo-500"></span> Destination Seaport ({dest_name})</div>
                <div class="flex items-center gap-2"><span class="w-2.5 h-2.5 rounded-full bg-sky-400"></span> Global Seaport / Chokepoint</div>
                <div class="flex items-center gap-2"><span class="w-4 h-0.5 bg-cyan-400"></span> Container Vessel Shipping Route</div>
            </div>
        </div>

        <!-- Polished Itinerary Table -->
        <div class="bg-[var(--card)] border border-[var(--border)] rounded-xl p-3 shadow-sm">
            <h2 class="text-xs font-bold text-sky-400 uppercase tracking-wider mb-2">Optimal Maritime Itinerary</h2>
            <div id="itinerary-container" class="space-y-2 max-h-48 overflow-y-auto pr-1"></div>
        </div>
    </div>

    <script>
        const routeData = {json.dumps(route_data)};
        
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

        const routeLayer = L.layerGroup().addTo(map);
        const markersLayer = L.layerGroup().addTo(map);
        const disruptionLayer = L.layerGroup().addTo(map);

        function drawRoute(data, isDisrupted = false) {{
            routeLayer.clearLayers();
            markersLayer.clearLayers();

            const latlngs = [];
            const steps = [];

            data.nodes.forEach((n, idx) => {{
                const pt = [n.lat, n.lon];
                latlngs.push(pt);

                const isOrigin = idx === 0;
                const isDest = idx === data.nodes.length - 1;
                const isNamedPort = n.name.startsWith("Port") || n.name.includes("Strait") || n.name.includes("Canal");

                if (isOrigin || isDest || isNamedPort || idx % 25 === 0) {{
                    let color = '#38bdf8';
                    let r = 5;
                    let stroke = '#ffffff';

                    if (isOrigin) {{ color = '#10b981'; r = 8.5; }}
                    else if (isDest) {{ color = '#818cf8'; r = 8.5; }}

                    const m = L.circleMarker(pt, {{
                        radius: r,
                        color: stroke,
                        weight: 1.5,
                        fillColor: color,
                        fillOpacity: 0.95
                    }}).bindPopup(`
                        <div style="font-size: 12px;">
                            <strong style="color: ${{color}};">${{n.name}}</strong><br>
                            <strong>Node ID:</strong> #${{n.id}}<br>
                            <strong>Coordinates:</strong> ${{n.lat.toFixed(4)}}&deg;N, ${{n.lon.toFixed(4)}}&deg;E<br>
                            <strong>Region:</strong> ${{n.region}}<br>
                            <strong>Delay:</strong> ${{n.congestion_delay || 0}} hrs
                        </div>
                    `);
                    markersLayer.addLayer(m);
                }}

                if (isOrigin || isDest || isNamedPort || idx % 30 === 0) {{
                    steps.push({{
                        name: n.name,
                        id: n.id,
                        type: isNamedPort ? 'port' : 'waypoint',
                        delay: n.congestion_delay || 0,
                        region: n.region,
                        isOrigin: isOrigin,
                        isDest: isDest
                    }});
                }}
            }});

            const glow = L.polyline(latlngs, {{
                color: isDisrupted ? '#f97316' : '#00f0ff',
                weight: 7,
                opacity: 0.35
            }});
            const main = L.polyline(latlngs, {{
                color: isDisrupted ? '#fb923c' : '#0284c7',
                weight: 3,
                opacity: 0.95,
                dashArray: isDisrupted ? '6, 4' : null
            }});

            routeLayer.addLayer(glow);
            routeLayer.addLayer(main);

            if (latlngs.length > 0) {{
                map.fitBounds(L.latLngBounds(latlngs), {{ padding: [30, 30] }});
            }}

            renderItineraryList(steps);
        }}

        function renderItineraryList(steps) {{
            const container = document.getElementById('itinerary-container');
            container.innerHTML = '';
            steps.forEach(s => {{
                let badgeClass = s.type === 'port' ? 'badge-port' : 'badge-sea';
                let badgeText = s.type === 'port' ? 'PORT' : 'SEA';
                if (s.isOrigin) {{ badgeClass = 'badge-origin'; badgeText = 'ORIGIN'; }}
                else if (s.isDest) {{ badgeClass = 'badge-dest'; badgeText = 'DEST'; }}

                const div = document.createElement('div');
                div.className = 'flex items-center gap-3 bg-[var(--background)] border border-[var(--border)] p-2.5 rounded-lg text-xs';
                div.innerHTML = `
                    <span class="pill-badge ${{badgeClass}}">${{badgeText}}</span>
                    <div class="flex flex-col min-w-0 flex-1">
                        <span class="font-semibold text-[var(--foreground)] truncate">${{s.name}} (#${{s.id}})</span>
                        <span class="text-[11px] text-[var(--muted-foreground)] truncate">${{s.isOrigin ? 'Origin Seaport Terminal' : (s.isDest ? 'Final Destination Seaport' : 'Region: ' + s.region + ' • Marine Shipping Lane')}}</span>
                    </div>
                `;
                container.appendChild(div);
            }});
        }}

        drawRoute(routeData, false);

        document.getElementById('btn-strike').addEventListener('click', () => {{
            disruptionLayer.clearLayers();
            const strikeNode = routeData.nodes[4] || routeData.nodes[1];
            L.circleMarker([strikeNode.lat, strikeNode.lon], {{
                radius: 12,
                color: '#ef4444',
                weight: 3,
                fillColor: '#dc2626',
                fillOpacity: 0.85
            }}).bindPopup('<strong style="color: #ef4444;">⚠️ ACTIVE PORT STRIKE (+72h)</strong><br>Location: ' + strikeNode.name).addTo(disruptionLayer).openPopup();

            drawRoute(routeData, true);
        }});

        document.getElementById('btn-weather').addEventListener('click', () => {{
            disruptionLayer.clearLayers();
            const weatherNode = routeData.nodes[Math.floor(routeData.nodes.length / 2)];
            L.circleMarker([weatherNode.lat, weatherNode.lon], {{
                radius: 12,
                color: '#f59e0b',
                weight: 3,
                fillColor: '#d97706',
                fillOpacity: 0.85
            }}).bindPopup('<strong style="color: #f59e0b;">⛈️ TYPHOON WEATHER DELAY (+48h)</strong><br>Location: ' + weatherNode.name).addTo(disruptionLayer).openPopup();

            drawRoute(routeData, true);
        }});

        document.getElementById('btn-reset').addEventListener('click', () => {{
            disruptionLayer.clearLayers();
            drawRoute(routeData, false);
        }});
    </script>
</body>
</html>
"""

    with open(artifact_html_path, "w", encoding="utf-8") as f:
        f.write(html_content)
    with open(web_map_path, "w", encoding="utf-8") as f:
        f.write(html_content)

    print(f"Generated {artifact_html_path} and {web_map_path}")

if __name__ == "__main__":
    main()
