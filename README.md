# Global Marine Shipping Route Optimizer

A C++17 maritime routing engine with a Flask API and Leaflet dashboard.

- A* minimizes the graph routing score, which combines modeled fuel expense, transit hours, and arrival delays. The score is separate from estimated fuel expense.
- Multi-stop routing fixes the endpoints and uses a genetic algorithm to order intermediate ports. The default fitness matrix uses A* costs on the navigable graph.
- OpenMP evaluates candidates on CPU. CUDA is optional and falls back to OpenMP when a compatible device is unavailable.
- The dashboard weather and AIS layers are simulations. The optional weather matrix script can fetch wind observations and estimates wave heights from wind. The API routes using the graph and configured delays.
- MPI runs independent genetic searches across ranks and selects the lowest-cost valid result. The dashboard launches two local ranks when it finds `mpiexec` and an MPI-enabled optimizer in `build-mpi`. Configure that build with `cmake -S . -B build-mpi -DENABLE_MPI=ON` in a shell with the compiler and MPI SDK configured.

---

## 📁 Directory Structure

```
route-optimizer/
├── src/
│   ├── astar.hpp            # Deterministic A* optimizer interface with Haversine heuristic
│   ├── astar.cpp            # A* priority queue implementation for sub-millisecond point-to-point routing
│   ├── graph.hpp            # Multimodal/marine graph data structures, spatial coordinates, CSV loader
│   ├── graph.cpp            # CSV parser, topology metrics, dynamic congestion loader
│   ├── ga.hpp               # GA optimizer interface, RouteScore cache, Chromosome structure
│   ├── ga.cpp               # OpenMP-parallelized GA core: tournament, crossover, mutation
│   ├── mpi_partition.hpp    # VehicleState, BoundaryEdge, RegionalPartitionManager & MPIController
│   ├── mpi_partition.cpp    # MPI distributed regional partitioning & cross-region vehicle handoff
│   ├── fitness_kernel.cu    # CUDA GPU parallel fitness evaluation kernel
│   └── main.cpp             # CLI entrypoint: A* / GA dispatch, dynamic JSON writer
├── data/
│   ├── nodes.csv            # Unified nodes table (56,325 marine nodes with lat/lon coordinates)
│   ├── edges.csv            # Directed shipping lanes table (211,812 sea edges)
│   ├── nodes.json           # Raw global maritime waypoints [[id, lon, lat]]
│   ├── edges.json           # Raw global maritime shipping lanes [[from, to, length_nm]]
│   └── meta.json            # Dataset schema & nautical distance units metadata
├── scripts/
│   ├── merge_datasets.py    # Builds clean marine graph CSVs and maps 62+ major world seaports
│   ├── stream_congestion.py # Simulates & streams real-time dynamic port disruptions to API & DB
│   ├── render_route_map.py  # Standalone CLI renderer: translates route JSON into interactive HTML map
│   ├── generate_map_artifact.py # Generates standalone viewer HTML files
│   ├── import_to_mysql.py   # Bulk ingestion and SQL dump generator (sql/seed_data.sql)
│   └── test_web_api.py      # Comprehensive 4-stage end-to-end integration test suite
├── web/
│   ├── index.html           # Interactive Leaflet container shipping map dashboard
│   ├── app.js               # Dashboard controller: live disruptions, route plotting, telemetry
│   ├── style.css            # Dark-themed modern UI styling
│   ├── network_data.json    # Curated key seaports with exact physical harbor coordinates
│   └── api.php              # Legacy PHP gateway
├── server.py                # Python Flask REST API server & web application
├── app.py                   # Entrypoint alias for server.py
├── sql/
│   ├── schema.sql           # MySQL database schema for nodes, edges, route_history, and congestion_events
│   └── seed_data.sql        # Batch insert SQL dump for all 56,325 vertices and 211,812 edges
└── CMakeLists.txt           # C++17 build system linking A*, OpenMP, CUDA, and MPI
```

---

## 🚀 Quick Start & Execution

### 1. Build the C++ Engine

```bash
cd route-optimizer
cmake -B build -S .
cmake --build build --config Release
```

### 2. Run Deterministic A* Optimal Routing (Least-Cost Search)

Calculate the mathematically optimal voyage from **Port of Shanghai (`#55196`)** to **Port of Rotterdam (`#21998`)**:

```bash
./build/route_optimizer --origin 55196 --dest 21998 --algorithm astar
```

### 3. Launch the Python REST API Server & Web Dashboard

Start the Flask API server:

```bash
python -m pip install -r requirements.txt
python server.py --port 5000
```
Open **`http://localhost:5000/`** in your browser to interactively view the world map, trigger disruptions, and run live optimizations.

### 4. Run the Standalone Map Visualization Renderer

Translate any route JSON into an interactive visual map and view in your browser:

```bash
python scripts/render_route_map.py --input output/latest_routes.json --show
```

### 5. Stream Real-Time Dynamic Congestion

Simulate live dynamic traffic updates on the running server:

```bash
# Inject delay on Port of Singapore
python scripts/stream_congestion.py --inject 49102 --delay 72.0 --event-type "Port Strike"

# Run continuous traffic event streamer
python scripts/stream_congestion.py --continuous --interval 10
```

### 6. Run Full System Integration Test Suite

```bash
python scripts/test_integration.py
python scripts/test_web_api.py
```

---

## 🌐 API Server Endpoints (`server.py`)

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/health` | Server health check and C++ engine binary status |
| `GET` | `/api/network` | Returns list of 61 named ports and chokepoints with coordinates |
| `POST` | `/api/route` | Optimizes route via A* or GA with dynamic delays |
| `GET` | `/api/congestion` | Retrieves active dynamic congestion hotspots |
| `POST` | `/api/congestion` | Injects live congestion delay on a specific node |
| `POST` | `/api/congestion/reset` | Resets all active congestion delays to 0.0h |
| `GET` | `/api/latest_route` | Returns current `output/latest_routes.json` |
| `GET` | `/` or `/map` | Serves the interactive Leaflet container shipping dashboard |

---

## ⚓ Physical Seaport Grounding

All vertices are grounded in physical coordinates (`lat`/`lon`). Major world seaports are matched to their exact coastal harbor nodes:
* **Port of Shanghai** (`#55196`): `31.2398°N, 121.4838°E`
* **Port of Singapore** (`#49102`): `1.2621°N, 103.8531°E`
* **Port of Mumbai (JNPT)** (`#45822`): `18.9584°N, 72.8434°E`
* **Port of Colombo** (`#45250`): `6.9423°N, 79.8465°E`
* **Port of Rotterdam** (`#21998`): `51.9851°N, 4.0771°E`
* **Port of Los Angeles** (`#55508`): `33.7469°N, -118.2483°E`
* **Port Said / Suez Canal** (`#37100` / `#21473`): `31.3115°N, 32.3716°E`
* **Bab-el-Mandeb Strait** (`#46607`): `12.6990°N, 43.3024°E`
- The dashboard supports port and city endpoints. For a city delivery, the router chooses among connected ports and road links using the existing routing score. The model charges 0.6 per sea kilometer and 1.4 per road kilometer, plus transit hours and modeled delays. These are illustrative weights. Direct A* requests find the minimum score across the bundled links.
- Amber lines show the actual road geometry returned by OSRM. The road dataset covers ten cities and uses a driving profile. Road links begin or end at road access points near the corresponding maritime graph nodes. The gap between those points represents a port transfer.
- Road data © [OpenStreetMap contributors](https://www.openstreetmap.org/copyright), routed via [OSRM](https://project-osrm.org/). The bundled road corridors were retrieved from `routing.openstreetmap.de` and include available highway references.
