# Deployment

Build the native optimizer and run Flask from the project directory so the
server and executable can find the bundled graph.

```sh
python -m venv .venv
. .venv/bin/activate
python -m pip install -r requirements.txt
cmake -S . -B build -DCMAKE_BUILD_TYPE=Release
cmake --build build --config Release
python scripts/test_integration.py
python server.py
```

On Windows, activate the environment with `.venv\Scripts\Activate.ps1`.
Use a C++17 compiler with OpenMP. If CMake detects CUDA, it also builds the
GPU fitness evaluator. A multi-configuration Windows build places the binary
in `build/Release`, which the Flask server detects automatically.

The development dashboard listens on `http://127.0.0.1:5000/`.
For a hosted instance, serve `app:app` with a WSGI server behind your existing
TLS reverse proxy. Use one application process for congestion updates because
the Flask update lock is process-local. The service account needs read access
to the graph and executable and write access to `config/` and `output/`.
Restrict access to the application at the proxy since the API has no built-in
authentication.

The dashboard calls Flask endpoints such as `/api/route` and
`/api/congestion`. The legacy PHP gateway and optional MySQL import remain
available as separate project components. Flask reads the graph from CSV
and saves congestion and the latest successful route as JSON.

Generate an optional weather matrix with
`python scripts/stream_congestion.py --generate-matrix`. Dashboard routing
uses navigable graph costs and configured congestion. The C++ CLI can use a
matrix explicitly with `--tsp --matrix <file>`. The dashboard's weather and
AIS overlays are simulations.
