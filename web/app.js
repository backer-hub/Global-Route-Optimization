/**
 * MarineRoute AI — Command Center Application Logic
 * High-Performance Oceanic Container Shipping Route Optimizer
 * Features:
 * - Multi-Stop Intermediate Waypoint Management & TSP Permutation GA Optimization
 * - Live marine weather samples at shipping corridors
 * - AIS vessel reports, including vessels reporting at anchor
 * - Dynamic Congestion Management (Port Strikes & Typhoon Disruption Detours)
 */

// Application State
const state = {
  ports: [],
  originPort: null,
  destPort: null,
  intermediateStops: [],
  engine: 'astar',
  delayHours: 72,
  disruptedNodeId: null,
  disruptedEvent: null,
  activeDisruption: false,
  calculating: false,
  routeData: null,
  map: null,
  routeLayers: [],
  multiRouteLayers: [],
  showAllEngines: false,
  vesselMarker: null,
  vesselAnimTimer: null,
  showWeather: true,
  showTraffic: true,
  useCurrents: true,
  showPorts: true,
  portsLayerGroup: null,
  weatherLayerGroup: null,
  trafficLayerGroup: null,
  weatherSamples: [],
  vessels: []
};

// Global Maritime Strategic Seaports (All Oceanic Basins)
const FALLBACK_PORTS = [
  { id: 55196, name: "Port of Shanghai", code: "CNSHA", lat: 31.2304, lon: 121.4737, region: "APAC", region_detail: "East China Sea" },
  { id: 49102, name: "Port of Singapore", code: "SGSIN", lat: 1.29027, lon: 103.851959, region: "APAC", region_detail: "Malacca Strait" },
  { id: 45822, name: "Port of Mumbai", code: "INNSA", lat: 18.95, lon: 72.95, region: "APAC", region_detail: "Arabian Sea" },
  { id: 45250, name: "Port of Colombo", code: "LKCMB", lat: 6.94, lon: 79.84, region: "APAC", region_detail: "Laccadive Sea" },
  { id: 49452, name: "Port of Dubai (Jebel Ali)", code: "AEJEA", lat: 25.01, lon: 55.06, region: "MIDDLE_EAST", region_detail: "Persian Gulf" },
  { id: 21998, name: "Port of Rotterdam", code: "NLRTM", lat: 51.95, lon: 4.13, region: "EUROPE", region_detail: "North Sea" },
  { id: 55508, name: "Port of Los Angeles", code: "USLAX", lat: 33.7469, lon: -118.2483, region: "AMERICAS", region_detail: "Pacific Coast" },
  { id: 21473, name: "Suez Canal South Entry", code: "EGSUE", lat: 29.93, lon: 32.56, region: "EUROPE", region_detail: "Red Sea / Suez" },
  { id: 37100, name: "Port Said (Suez North)", code: "EGPSD", lat: 31.26, lon: 32.30, region: "EUROPE", region_detail: "Mediterranean" },
  { id: 46607, name: "Bab-el-Mandeb Strait Portal", code: "DJJIB", lat: 12.58, lon: 43.33, region: "MIDDLE_EAST", region_detail: "Bab-el-Mandeb" },
  { id: 22490, name: "Port of Hamburg", code: "DEHAM", lat: 53.53, lon: 9.96, region: "EUROPE", region_detail: "Elbe / North Sea" },
  { id: 6383,  name: "Port of New York & New Jersey", code: "USNYC", lat: 40.6465, lon: -74.0631, region: "AMERICAS", region_detail: "New York Harbor" },
  { id: 55355, name: "Port of Busan", code: "KRBUS", lat: 35.10, lon: 129.04, region: "APAC", region_detail: "Korea Strait" },
  { id: 55364, name: "Port of Yokohama (Tokyo)", code: "JPYOK", lat: 35.44, lon: 139.64, region: "APAC", region_detail: "Tokyo Bay" },
  { id: 55200, name: "Port of Hong Kong", code: "HKHKG", lat: 22.3193, lon: 114.1694, region: "APAC", region_detail: "South China Sea" },
  { id: 36140, name: "Strait of Gibraltar Gateway", code: "GIB", lat: 35.96, lon: -5.62, region: "EUROPE", region_detail: "Gibraltar" },
  { id: 37300, name: "Port of Piraeus (Athens)", code: "GRPIR", lat: 37.94, lon: 23.63, region: "EUROPE", region_detail: "Aegean Sea" },
  { id: 57001, name: "Panama Canal (Pacific / Balboa)", code: "PABLB", lat: 8.95, lon: -79.56, region: "AMERICAS", region_detail: "Panama Pacific" },
  { id: 57002, name: "Panama Canal (Atlantic / Colon)", code: "PACON", lat: 9.35, lon: -79.90, region: "AMERICAS", region_detail: "Caribbean Sea" },
  { id: 55900, name: "Port of Sydney (Botany)", code: "AUBOT", lat: -33.97, lon: 151.21, region: "OCEANIA", region_detail: "Tasman Sea" },
  { id: 47100, name: "Port of Durban", code: "ZADUR", lat: -29.87, lon: 31.02, region: "AFRICA", region_detail: "Indian Ocean South" },
  { id: 58001, name: "Port of Santos (Sao Paulo)", code: "BRSSZ", lat: -23.96, lon: -46.33, region: "AMERICAS", region_detail: "South Atlantic" }
];

const ENGINES = {
  astar: {
    label: "A* Deterministic",
    tag: "A* EXACT GEODESIC",
    meta: "Exact · sub-25ms",
    speed: "1.4",
    glowColor: "#13d6e8",
    coreColor: "#3bf6c5",
    dashArray: "8, 6",
    weight: 3.5,
    speedKnots: 20.0,
    fuelMultiplier: 1.0,
    badgeClass: "badge-fast",
    confidence: "100.0%",
    optimality: "100% Exact Global Minimum",
    desc: "Single-core C++17 admissible heuristic priority-queue search, strictly determining the global shortest nautical distance."
  },
  openmp: {
    label: "OpenMP Multi-core",
    tag: "OPENMP ECO-CURRENT TRACK",
    meta: "16 CPU threads",
    speed: "28.4",
    glowColor: "#059669",
    coreColor: "#10b981",
    dashArray: "12, 4",
    weight: 4.0,
    speedKnots: 17.5,
    fuelMultiplier: 0.876, // 12.4% fuel savings
    badgeClass: "badge-cpu",
    confidence: "99.4%",
    optimality: "99.4% Eco-Optimal",
    desc: "16 OpenMP CPU threads evaluating multi-objective fuel burn and carbon emissions by leveraging favorable oceanic drift currents."
  },
  cuda: {
    label: "CUDA GPU Kernel",
    tag: "CUDA STORM CLEARANCE EXPRESS",
    meta: "48,096 candidates",
    speed: "21.2",
    glowColor: "#0284c7",
    coreColor: "#00f0ff",
    dashArray: "6, 3",
    weight: 4.0,
    speedKnots: 22.5,
    fuelMultiplier: 1.05,
    badgeClass: "badge-gpu",
    confidence: "99.8%",
    optimality: "99.8% High-Throughput Convergence",
    desc: "Massively parallel CUDA GPU kernel evaluating 48,096 candidate tours in parallel, actively circumnavigating hazardous storm circles with maximum clearance."
  },
  mpi: {
    label: "MPI",
    tag: "MPI REGIONAL GATEWAY TOUR",
    meta: "3 region clusters",
    speed: "34.6",
    glowColor: "#d97706",
    coreColor: "#fbbf24",
    dashArray: "10, 6",
    weight: 4.0,
    speedKnots: 19.0,
    fuelMultiplier: 0.96,
    badgeClass: "badge-mpi",
    confidence: "98.5%",
    optimality: "98.5% Distributed Frontier",
    desc: "3-Domain decomposition partitioning the global shipping network across regional cluster ranks (APAC, EMEA, AMERICAS), synchronizing at major transit gateways."
  }
};

// UI Notification Toast
function escapeHTML(value) {
  return String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;');
}

function showToast(message, type = 'info', description = '') {
  const container = document.getElementById('toast-container');
  if (!container) return;

  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  
  let icon = 'ℹ️';
  if (type === 'success') icon = '✅';
  if (type === 'warning') icon = '⚠️';
  if (type === 'error') icon = '🚨';

  const iconElement = document.createElement('span');
  iconElement.textContent = icon;
  const content = document.createElement('div');
  const heading = document.createElement('strong');
  heading.textContent = message;
  content.appendChild(heading);
  if (description) {
    const detail = document.createElement('div');
    detail.textContent = description;
    content.appendChild(detail);
  }
  toast.append(iconElement, content);

  container.appendChild(toast);
  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateX(100%)';
    toast.style.transition = 'all 0.3s ease';
    setTimeout(() => toast.remove(), 300);
  }, 4000);
}

// Initialize Leaflet Map
function initMap() {
  const mapElem = document.getElementById('map');
  if (!mapElem) return;

  try {
    if (state.map) {
      state.map.remove();
      state.map = null;
    }

    state.map = L.map('map', {
      center: [20.0, 40.0],
      zoom: 3,
      minZoom: 2,
      maxZoom: 18,
      zoomControl: false,
      attributionControl: false
    });

    L.control.zoom({ position: 'topright' }).addTo(state.map);

    // Primary Dark Oceanic Tile Layer (Esri Dark Canvas - 100% Free, NO API Key Required)
    const darkCanvas = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}', {
      maxZoom: 16,
      attribution: '&copy; Esri Dark Canvas'
    });
    
    const darkLabels = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Reference/MapServer/tile/{z}/{y}/{x}', {
      maxZoom: 16
    });

    const oceanBase = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/Ocean/World_Ocean_Base/MapServer/tile/{z}/{y}/{x}', {
      maxZoom: 16,
      attribution: '&copy; Esri Ocean'
    });

    const osm = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; OpenStreetMap'
    });

    darkCanvas.addTo(state.map);
    darkLabels.addTo(state.map);

    // Initialize Layer Groups for Seaports, Live Weather, and AIS Marine Traffic
    state.portsLayerGroup = L.layerGroup().addTo(state.map);
    state.weatherLayerGroup = L.layerGroup().addTo(state.map);
    state.trafficLayerGroup = L.layerGroup().addTo(state.map);

    // Layer switcher control in top right
    const baseLayers = {
      "Dark Oceanic (Default)": darkCanvas,
      "Marine Ocean Depth": oceanBase,
      "OpenStreetMap": osm
    };

    const overlayLayers = {
      "Global Seaports & Terminals": state.portsLayerGroup
    };

    L.control.layers(baseLayers, overlayLayers, { position: 'topright' }).addTo(state.map);

    // Initial size invalidate after render
    setTimeout(() => {
      if (state.map) {
        state.map.invalidateSize();
      }
    }, 200);

    window.addEventListener('resize', () => {
      if (state.map) state.map.invalidateSize();
    });
  } catch (err) {
    console.error("Leaflet initialization error:", err);
  }
}

function renderMarineOverlays() {
  if (!state.map) return;
  state.weatherLayerGroup.clearLayers();
  state.trafficLayerGroup.clearLayers();
  for (const sample of state.weatherSamples) {
    const point = [sample.lat, sample.lon];
    const color = sample.radius_km ? '#f59e0b' : '#22d3ee';
    if (sample.radius_km) {
      L.circle(point, { radius: sample.radius_km * 1000, color, dashArray: '5 5', fillOpacity: 0.12 })
        .addTo(state.weatherLayerGroup);
    }
    const waves = sample.wave_height_m == null ? 'Unavailable' : `${Number(sample.wave_height_m)} m`;
    const wind = sample.wind_kts == null ? 'Unavailable' : `${Number(sample.wind_kts)} kt`;
    L.circleMarker(point, { radius: 7, color: '#e0faff', weight: 2, fillColor: color, fillOpacity: 0.95 })
      .bindPopup(`<strong>${escapeHTML(sample.name)}</strong><br>Significant waves: ${waves}<br>Wind: ${wind}<br>Open-Meteo forecast`)
      .addTo(state.weatherLayerGroup);
  }
  for (const vessel of state.vessels) {
    const speed = vessel.speed_kts == null ? 'Unavailable' : `${vessel.speed_kts} kt`;
    L.circleMarker([vessel.lat, vessel.lon], {
      radius: 6, color: '#e0faff', weight: 2,
      fillColor: vessel.anchored ? '#fbbf24' : '#34d399', fillOpacity: 0.95
    }).bindPopup(`<strong>AIS MMSI ${vessel.mmsi}</strong><br>${vessel.anchored ? 'Reported at anchor' : 'Position report'}<br>Speed: ${speed}`)
      .addTo(state.trafficLayerGroup);
  }
}

async function refreshMarineOverlays() {
  let weatherLabel = 'Weather unavailable';
  let trafficLabel = 'AIS unavailable';
  try {
    const response = await fetch('/api/live_overlay', { cache: 'no-store', signal: AbortSignal.timeout(5000) });
    if (!response.ok) throw new Error('Marine feeds unavailable');
    const { weather, traffic } = await response.json();
    state.weatherSamples = weather.samples;
    state.vessels = traffic.vessels;
    weatherLabel = {
      live: `Open-Meteo · ${weather.samples.length} samples · ${weather.samples.filter(sample => sample.radius_km > 0).length} rough-weather zones`,
      loading: 'Loading marine weather',
      stale: 'Weather refresh failed · recent samples retained'
    }[weather.status] || weatherLabel;
    trafficLabel = {
      live: `AISStream · ${traffic.vessels.length} vessels · ${traffic.vessels.filter(vessel => vessel.anchored).length} at anchor`,
      connecting: 'Waiting for AIS reports',
      not_configured: 'Live traffic unavailable · AISStream key required',
      dependency_missing: 'AIS WebSocket dependency missing'
    }[traffic.status] || (traffic.vessels.length ? 'AIS disconnected · recent reports retained' : trafficLabel);
  } catch {
    state.weatherSamples = [];
    state.vessels = [];
  }
  renderMarineOverlays();
  const status = document.getElementById('marine-feed-status');
  const label = `${weatherLabel} · ${trafficLabel}`;
  if (status.textContent !== label) status.textContent = label;
}

// Toggle Live Weather Layer
function toggleWeatherLayer(forceState) {
  const btn = document.getElementById('btn-toggle-weather');
  state.showWeather = (typeof forceState === 'boolean') ? forceState : !state.showWeather;

  if (state.showWeather) {
    if (state.map && state.weatherLayerGroup && !state.map.hasLayer(state.weatherLayerGroup)) {
      state.map.addLayer(state.weatherLayerGroup);
    }
    if (btn) btn.classList.add('active');
  } else {
    if (state.map && state.weatherLayerGroup && state.map.hasLayer(state.weatherLayerGroup)) {
      state.map.removeLayer(state.weatherLayerGroup);
    }
    if (btn) btn.classList.remove('active');
  }
  runOptimization();
}

// Toggle Live AIS Marine Traffic Layer
function toggleTrafficLayer(forceState) {
  const btn = document.getElementById('btn-toggle-traffic');
  state.showTraffic = (typeof forceState === 'boolean') ? forceState : !state.showTraffic;

  if (state.showTraffic) {
    if (state.map && state.trafficLayerGroup && !state.map.hasLayer(state.trafficLayerGroup)) {
      state.map.addLayer(state.trafficLayerGroup);
    }
    if (btn) btn.classList.add('active');
  } else {
    if (state.map && state.trafficLayerGroup && state.map.hasLayer(state.trafficLayerGroup)) {
      state.map.removeLayer(state.trafficLayerGroup);
    }
    if (btn) btn.classList.remove('active');
  }
  runOptimization();
}

// Render Global Seaports Layer (All 61 Network Seaports with Hover Tooltips & Fast Actions)
function renderGlobalPortsLayer() {
  if (!state.portsLayerGroup || !state.ports || state.ports.length === 0) return;
  state.portsLayerGroup.clearLayers();

  state.ports.filter(port => !port.isCity).forEach(port => {
    const portIcon = L.divIcon({
      className: 'port-network-node',
      html: `<div class="port-network-dot" title="${escapeHTML(port.name)}"></div>`,
      iconSize: [8, 8],
      iconAnchor: [4, 4]
    });

    const popupHtml = `
      <div class="maritime-popup" style="min-width: 220px;">
        <div class="maritime-popup-title">
          <span>⚓ ${escapeHTML(port.name)}</span>
          <span class="maritime-popup-badge badge-fast">${escapeHTML(port.code || 'PORT')}</span>
        </div>
        <div class="maritime-popup-grid">
          <div><span>Node ID:</span> <strong>#${port.id}</strong></div>
          <div><span>Region:</span> <strong>${escapeHTML(port.region || 'Global Lane')}</strong></div>
          <div><span>Coordinates:</span> <strong>${Number(port.lat).toFixed(3)}°, ${Number(port.lon).toFixed(3)}°</strong></div>
          ${port.congestion_delay > 0 ? `<div><span>Congestion:</span> <strong style="color:#ef4444;">+${port.congestion_delay}h</strong></div>` : ''}
        </div>
        <div class="port-popup-actions">
          <button type="button" class="port-action-btn" onclick="window.setPortAsOrigin(${port.id})">Set Origin</button>
          <button type="button" class="port-action-btn" onclick="window.addPortAsStop(${port.id})">+ Add Stop</button>
          <button type="button" class="port-action-btn" onclick="window.setPortAsDest(${port.id})">Set Dest</button>
        </div>
      </div>
    `;

    const marker = L.marker([port.lat, port.lon], { icon: portIcon })
      .bindPopup(popupHtml)
      .bindTooltip(`⚓ ${escapeHTML(port.name)}`, { direction: 'top', className: 'maritime-port-tooltip', offset: [0, -6] });

    state.portsLayerGroup.addLayer(marker);
  });
}

// Toggle Global Seaports Layer
function togglePortsLayer(forceState) {
  const btn = document.getElementById('btn-toggle-ports');
  state.showPorts = (typeof forceState === 'boolean') ? forceState : !state.showPorts;

  if (state.showPorts) {
    if (state.map && state.portsLayerGroup && !state.map.hasLayer(state.portsLayerGroup)) {
      state.map.addLayer(state.portsLayerGroup);
    }
    if (btn) btn.classList.add('active');
    showToast("Seaports Layer Enabled", "info", "Displaying all global shipping terminals & anchorages.");
  } else {
    if (state.map && state.portsLayerGroup && state.map.hasLayer(state.portsLayerGroup)) {
      state.map.removeLayer(state.portsLayerGroup);
    }
    if (btn) btn.classList.remove('active');
    showToast("Seaports Layer Hidden", "info", "Global seaports layer hidden.");
  }
}

// Window Port Quick Actions (Invoked from Leaflet Port Popups)
window.setPortAsOrigin = function(id) {
  const p = state.ports.find(x => x.id === id);
  if (p) {
    state.originPort = p;
    const sel = document.getElementById('origin-select');
    if (sel) sel.value = p.id;
    updatePortSubtitles();
    runOptimization();
    showToast("Origin Seaport Set", "success", `Start set to ${p.name}`);
  }
};

window.addPortAsStop = function(id) {
  addIntermediateStop(id);
};

window.setPortAsDest = function(id) {
  const p = state.ports.find(x => x.id === id);
  if (p) {
    state.destPort = p;
    const sel = document.getElementById('dest-select');
    if (sel) sel.value = p.id;
    updatePortSubtitles();
    runOptimization();
    showToast("Destination Seaport Set", "success", `Destination set to ${p.name}`);
  }
};

// Fetch Ports List
async function loadPorts() {
  try {
    const res = await fetch('/api/ports');
    if (res.ok) {
      const data = await res.json();
      state.ports = (data.key_ports || data.nodes || FALLBACK_PORTS).concat(
        (data.cities || []).map(city => ({...city, isCity: true}))
      );
    } else {
      state.ports = FALLBACK_PORTS;
    }
  } catch (e) {
    console.warn("Using fallback ports:", e);
    state.ports = FALLBACK_PORTS;
  }

  populatePortDropdowns();
  renderGlobalPortsLayer();
}

// Populate Dropdown Selects
function populatePortDropdowns() {
  const originSel = document.getElementById('origin-select');
  const destSel = document.getElementById('dest-select');
  if (!originSel || !destSel) return;

  originSel.innerHTML = '';
  destSel.innerHTML = '';

  state.ports.forEach(p => {
    const opt1 = document.createElement('option');
    opt1.value = p.id;
    opt1.textContent = p.isCity ? p.name + ' (city)' : p.name;
    originSel.appendChild(opt1);

    const opt2 = document.createElement('option');
    opt2.value = p.id;
    opt2.textContent = opt1.textContent;
    destSel.appendChild(opt2);
  });

  // Default Shanghai (55196) -> Rotterdam (21998)
  const defaultOrigin = state.ports.find(p => p.id === 55196) || state.ports[0];
  const defaultDest = state.ports.find(p => p.id === 21998) || state.ports[state.ports.length - 1];

  originSel.value = defaultOrigin.id;
  destSel.value = defaultDest.id;

  state.originPort = defaultOrigin;
  state.destPort = defaultDest;

  updatePortSubtitles();
  renderIntermediateStopsList();
}

// Update port subtitle labels
function updatePortSubtitles() {
  const originSub = document.getElementById('origin-sub');
  const destSub = document.getElementById('dest-sub');

  if (state.originPort && originSub) {
    originSub.textContent = `${state.originPort.code || (state.originPort.isCity ? 'City' : 'Port')} · #${state.originPort.id} · ${state.originPort.region_detail || state.originPort.region || 'Maritime'}`;
  }
  if (state.destPort && destSub) {
    destSub.textContent = `${state.destPort.code || (state.destPort.isCity ? 'City' : 'Port')} · #${state.destPort.id} · ${state.destPort.region_detail || state.destPort.region || 'Maritime'}`;
  }
}

// Intermediate Waypoint / Multi-Stop TSP Management
function addIntermediateStop(portId) {
  if (state.intermediateStops.length >= 6) {
    showToast("Stop limit reached", "warning", "Maximum 6 intermediate stops allowed per voyage.");
    return;
  }

  const available = state.ports.filter(p => 
    p.id !== (state.originPort ? state.originPort.id : null) &&
    p.id !== (state.destPort ? state.destPort.id : null) &&
    !state.intermediateStops.some(s => s.id === p.id)
  );

  const selectedPort = portId 
    ? state.ports.find(p => p.id === portId)
    : (available.length > 0 ? available[0] : state.ports[1]);

  if (!selectedPort) return;

  state.intermediateStops.push(selectedPort);
  renderIntermediateStopsList();
  showToast("Intermediate stop added", "info", `Added ${selectedPort.name} to voyage sequence.`);
  runOptimization();
}

function removeIntermediateStop(index) {
  if (index >= 0 && index < state.intermediateStops.length) {
    const removed = state.intermediateStops.splice(index, 1)[0];
    renderIntermediateStopsList();
    showToast("Stop removed", "info", `Removed ${removed.name} from sequence.`);
    runOptimization();
  }
}

function renderIntermediateStopsList() {
  const container = document.getElementById('intermediate-stops-list');
  const badge = document.getElementById('tsp-mode-badge');
  if (!container) return;

  container.innerHTML = '';

  if (state.intermediateStops.length > 0) {
    if (badge) badge.style.display = 'inline-block';
  } else {
    if (badge) badge.style.display = 'none';
  }

  state.intermediateStops.forEach((stop, idx) => {
    const row = document.createElement('div');
    row.className = 'stop-entry-row';
    row.dataset.index = idx;

    let optionsHtml = '';
    state.ports.forEach(p => {
      const isSelected = p.id === stop.id;
      optionsHtml += `<option value="${p.id}" ${isSelected ? 'selected' : ''}>${p.name}</option>`;
    });

    row.innerHTML = `
      <span class="stop-num-badge">VIA #${idx + 1}</span>
      <div class="select-wrap" style="flex: 1; min-height: 28px;">
        <select class="via-port-select" data-index="${idx}">
          ${optionsHtml}
        </select>
      </div>
      <button type="button" class="btn-remove-stop" data-index="${idx}" title="Remove Stop #${idx + 1}">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
      </button>
    `;

    const selectEl = row.querySelector('.via-port-select');
    selectEl.addEventListener('change', (e) => {
      const pid = parseInt(e.target.value);
      const newPort = state.ports.find(p => p.id === pid);
      if (newPort) {
        state.intermediateStops[idx] = newPort;
        runOptimization();
      }
    });

    const removeBtn = row.querySelector('.btn-remove-stop');
    removeBtn.addEventListener('click', () => removeIntermediateStop(idx));

    container.appendChild(row);
  });
}

// Clear Map Route Layers (Preserves Weather & Traffic Layers)
function clearMapLayers() {
  if (state.vesselAnimTimer) {
    clearInterval(state.vesselAnimTimer);
    state.vesselAnimTimer = null;
  }
  if (state.vesselMarker && state.map) {
    state.map.removeLayer(state.vesselMarker);
    state.vesselMarker = null;
  }
  if (state.map) {
    state.routeLayers.forEach(l => state.map.removeLayer(l));
    if (state.multiRouteLayers) {
      state.multiRouteLayers.forEach(l => state.map.removeLayer(l));
    }
  }
  state.routeLayers = [];
  state.multiRouteLayers = [];
}

// Calculate nautical forward bearing between two coordinates
function calculateBearing(lat1, lon1, lat2, lon2) {
  const toRad = Math.PI / 180;
  const toDeg = 180 / Math.PI;
  const phi1 = lat1 * toRad;
  const phi2 = lat2 * toRad;
  const deltaLambda = (lon2 - lon1) * toRad;

  const y = Math.sin(deltaLambda) * Math.cos(phi2);
  const x = Math.cos(phi1) * Math.sin(phi2) - Math.sin(phi1) * Math.cos(phi2) * Math.cos(deltaLambda);
  let bearing = Math.atan2(y, x) * toDeg;
  return (bearing + 360) % 360;
}

// Generate Vessel Marker Icon (Sleek Compact Navigating Dot)
function getVesselIcon(bearing) {
  return L.divIcon({
    className: 'vessel-ship-icon',
    html: `<div class="active-vessel-dot" style="position: relative; width: 14px; height: 14px; display: flex; align-items: center; justify-content: center;">
             <div style="position: absolute; inset: -3px; border-radius: 50%; background: rgba(59, 246, 197, 0.35); animation: pulse-vessel-dot 2s infinite;"></div>
             <div style="width: 8px; height: 8px; border-radius: 50%; background: #3bf6c5; border: 1.5px solid #06101c; box-shadow: 0 0 8px #3bf6c5;"></div>
           </div>`,
    iconSize: [14, 14],
    iconAnchor: [7, 7]
  });
}

// Strategic Deepwater Chokepoints & Oceanic Maritime Canals
// Strategic Deepwater Chokepoints & Oceanic Maritime Canals
const MARITIME_CHOKEPOINTS = {
  malacca: [1.29, 103.85],
  singapore_east: [1.25, 104.20],
  sri_lanka: [5.85, 80.50],
  arabian_sea: [15.00, 65.00],
  babelmandeb: [12.58, 43.33],
  red_sea_mid: [22.00, 38.00],
  suez_south: [29.93, 32.56],
  suez_north: [31.26, 32.30],
  med_east: [34.00, 26.50],
  med_mid: [36.20, 18.00],
  med_sicily: [36.80, 12.50],
  med_algerian_basin: [37.20, 3.50],
  med_alboran: [36.25, -2.50],
  gibraltar: [35.96, -5.62],
  gibraltar_west: [35.90, -6.50],
  cape_st_vincent: [36.95, -9.20],
  lisbon_offshore: [38.75, -9.65],
  cape_finisterre: [43.05, -9.50],
  biscay_oceanic: [45.80, -7.50],
  ushant_channel_entry: [48.60, -5.40],
  english_channel: [50.10, -0.50],
  dover_strait: [51.15, 1.60],
  north_sea: [52.10, 3.50],
  panama_pacific: [8.93, -79.56],
  panama_atlantic: [9.35, -79.92],
  caribbean_mid: [15.00, -75.00],
  florida_strait: [24.50, -80.50],
  baja_california_pacific: [22.50, -110.50],
  california_approach: [36.50, -123.50],
  cape_horn: [-56.20, -67.20],
  chile_pacific: [-45.00, -75.50],
  argentina_atlantic: [-46.00, -60.00],
  cape_good_hope: [-34.80, 19.50]
};

// Keep each road geometry separate from the adjacent sea lanes at port transfers.
function routeSegments(route) {
  const roadLegs = new Map((route.road_legs || []).map(leg => [leg.path_index, leg]));
  const segments = [];
  let previousLongitude;
  function unwrap(points) {
    return points.map(([lat, lon]) => {
      if (previousLongitude !== undefined) lon += 360 * Math.round((previousLongitude - lon) / 360);
      previousLongitude = lon;
      return [lat, lon];
    });
  }
  let sea = [];
  for (let i = 0; i < route.nodes.length; i++) {
    const node = route.nodes[i];
    sea.push([node.lat, node.lon]);
    const road = roadLegs.get(i);
    if (!road) continue;
    if (sea.length > 1) segments.push({coords: unwrap(sea)});
    segments.push({coords: unwrap(road.geometry), road});
    sea = [];
  }
  if (sea.length > 1) segments.push({coords: unwrap(sea)});
  return segments;
}

// Render Route on Leaflet Map
function renderRouteOnMap(route) {
  if (!state.map) return;
  clearMapLayers();

  const segments = routeSegments(route);
  const coords = segments.flatMap(segment => segment.coords);
  if (coords.length < 2) return;

  const engineCfg = ENGINES[state.engine] || ENGINES.astar;
  const isDisrupted = state.activeDisruption;
  const seaSegments = segments.filter(segment => !segment.road);
  const displayCoords = seaSegments.map(segment => segment.coords);
  const longestSea = seaSegments.reduce((longest, segment) =>
    segment.coords.length > longest.length ? segment.coords : longest, []);
  for (const {coords, road} of segments.filter(segment => segment.road)) {
    const line = L.polyline(coords, {color: '#ffc15a', weight: 4, opacity: 0.95}).addTo(state.map);
    const tooltip = document.createElement('span');
    tooltip.textContent = `${road.distance_km.toFixed(1)} km by road${road.roads.length ? ' · ' + road.roads.join(', ') : ''}`;
    line.bindTooltip(tooltip, {sticky: true});
    state.routeLayers.push(line);
  }

  // Background glow polyline
  const glowLine = L.polyline(displayCoords, {
    color: isDisrupted ? '#ef4444' : engineCfg.glowColor,
    weight: 9,
    opacity: 0.38,
    lineCap: 'round',
    lineJoin: 'round'
  }).addTo(state.map);
  state.routeLayers.push(glowLine);

  // Core bright route
  const coreLine = L.polyline(displayCoords, {
    color: isDisrupted ? '#f97316' : engineCfg.coreColor,
    weight: isDisrupted ? 4.0 : (engineCfg.weight || 3.5),
    opacity: 0.95,
    dashArray: isDisrupted ? '5, 5' : engineCfg.dashArray,
    lineCap: 'round'
  }).addTo(state.map);
  state.routeLayers.push(coreLine);

  // Directional voyage beads along the corridor
  const beadColor = isDisrupted ? '#f97316' : engineCfg.coreColor;
  const numBeads = Math.min(8, Math.max(3, Math.floor(longestSea.length / 40)));
  const beadInterval = Math.max(1, Math.floor((longestSea.length - 1) / (numBeads + 1)));
  for (let i = 1; i <= numBeads; i++) {
    const idx = i * beadInterval;
    if (idx < longestSea.length - 1) {
      const p = longestSea[idx];
      const beadIcon = L.divIcon({
        className: 'route-waypoint-bead',
        html: `<div style="width: 6px; height: 6px; border-radius: 50%; background: ${beadColor}; opacity: 0.9; box-shadow: 0 0 8px ${beadColor};"></div>`,
        iconSize: [6, 6],
        iconAnchor: [3, 3]
      });
      const beadMarker = L.marker(p, { icon: beadIcon, interactive: false }).addTo(state.map);
      state.routeLayers.push(beadMarker);
    }
  }

  // Origin Marker (Mint Green Glow)
  const originCoord = coords[0];
  const destCoord = coords[coords.length - 1];

  const originIcon = L.divIcon({
    className: 'custom-port-marker',
    html: `<div style="position:relative; width:26px; height:26px;">
             <div style="position:absolute; inset:-6px; border-radius:50%; background:rgba(59,246,197,0.45); animation: pulse-dot 1.5s infinite;"></div>
             <div style="width:16px; height:16px; border-radius:50%; background:#3bf6c5; border:2.5px solid #06101c; margin:5px;"></div>
           </div>`,
    iconSize: [26, 26],
    iconAnchor: [13, 13]
  });

  const origMarker = L.marker(originCoord, { icon: originIcon })
    .bindPopup(`<b>ORIGIN: ${escapeHTML(route.origin_name || 'Origin')}</b><br>Lat: ${originCoord[0].toFixed(3)}, Lon: ${originCoord[1].toFixed(3)}`)
    .addTo(state.map);
  state.routeLayers.push(origMarker);

  // Intermediate Waypoint Stop Markers
  const stopsToRender = (route.tsp_waypoints && route.tsp_waypoints.length > 2)
    ? route.tsp_waypoints.slice(1, route.tsp_waypoints.length - 1)
    : state.intermediateStops;

  stopsToRender.forEach((stop, idx) => {
    const viaIcon = L.divIcon({
      className: 'custom-port-marker via-port-marker',
      html: `<div style="position:relative; width:24px; height:24px; display:flex; align-items:center; justify-content:center;">
               <div style="position:absolute; inset:-4px; border-radius:50%; background:rgba(253,166,10,0.35);"></div>
               <div style="width:18px; height:18px; border-radius:50%; background:#fda60a; border:2px solid #06101c; display:flex; align-items:center; justify-content:center; color:#06101c; font-size:10px; font-weight:800; font-family:'DM Mono',monospace;">${idx + 1}</div>
             </div>`,
      iconSize: [24, 24],
      iconAnchor: [12, 12]
    });

    const viaMarker = L.marker([stop.lat, stop.lon], { icon: viaIcon })
      .bindPopup(`<b>VIA STOP #${idx + 1}: ${escapeHTML(stop.name)}</b><br>Code: ${escapeHTML(stop.code || 'PORT')} · Berth Transit Leg`)
      .addTo(state.map);
    state.routeLayers.push(viaMarker);
  });

  // Destination Marker (Cyan Glow)
  const destIcon = L.divIcon({
    className: 'custom-port-marker',
    html: `<div style="position:relative; width:26px; height:26px;">
             <div style="position:absolute; inset:-6px; border-radius:50%; background:rgba(19,214,232,0.45); animation: pulse-dot 1.5s infinite;"></div>
             <div style="width:16px; height:16px; border-radius:50%; background:#13d6e8; border:2.5px solid #06101c; margin:5px;"></div>
           </div>`,
    iconSize: [26, 26],
    iconAnchor: [13, 13]
  });

  const dstMarker = L.marker(destCoord, { icon: destIcon })
    .bindPopup(`<b>FINAL DESTINATION: ${escapeHTML(route.dest_name || 'Destination')}</b><br>Lat: ${destCoord[0].toFixed(3)}, Lon: ${destCoord[1].toFixed(3)}`)
    .addTo(state.map);
  state.routeLayers.push(dstMarker);

  // If disruption active, render pulsing hazard ring
  if (state.activeDisruption) {
    let hazardCoord = [1.29, 103.85];
    if (state.disruptedNodeId === '21473' || state.disruptedNodeId === '37100') {
      hazardCoord = [29.93, 32.56];
    }
    
    const hazardIcon = L.divIcon({
      className: 'hazard-marker',
      html: `<div style="position:relative; width:44px; height:44px;">
               <div style="position:absolute; inset:0; border-radius:50%; background:rgba(253,166,10,0.4); animation: pulse-dot 1s infinite;"></div>
               <div style="position:absolute; inset:14px; border-radius:50%; background:#fda60a; border:2px solid #fff;"></div>
             </div>`,
      iconSize: [44, 44],
      iconAnchor: [22, 22]
    });

    const hazardMarker = L.marker(hazardCoord, { icon: hazardIcon })
      .bindPopup(`<b>⚠️ MARITIME DISRUPTION</b><br>${state.disruptedEvent === 'strike' ? 'Port Strike' : 'Typhoon Weather'}: +${state.delayHours}h Delay`)
      .addTo(state.map);
    state.routeLayers.push(hazardMarker);
  }

  // Animate Container Vessel along route with forward heading
  startVesselAnimation(longestSea);

  try {
    state.map.fitBounds(L.latLngBounds(coords), { padding: [50, 50], maxZoom: 6 });
  } catch (e) {
    console.log("fitBounds note:", e);
  }
}

async function toggleAllEnginesComparison(forceState) {
  const hud = document.getElementById('multi-route-hud');
  if (!hud || !state.map) return;
  if (forceState === false || state.showAllEngines) {
    state.showAllEngines = false;
    hud.style.display = 'none';
    clearMapLayers();
    if (state.routeData) renderRouteOnMap(state.routeData);
    return;
  }
  if (state.calculating || !state.routeData) {
    showToast("Compute a route first", "warning");
    return;
  }

  const route = state.routeData;
  const waypoints = route.requested_waypoints;
  state.showAllEngines = true;
  hud.style.display = 'block';
  const list = document.getElementById('hud-engine-list');
  list.textContent = 'Computing routes…';
  const engines = route.is_tsp ? ['openmp', 'cuda'] : ['astar', 'openmp', 'cuda'];
  if (!document.querySelector('[data-engine="mpi"]').disabled) engines.push('mpi');
  const results = [];
  for (const engine of engines) {
    if (!state.showAllEngines || state.routeData !== route) return;
    try {
      results.push({engine, route: await requestRoute({
        ...state.routeOverlays, waypoints, engine, publish: false, pop_size: 1000, generations: 40
      })});
    } catch (error) {
      results.push({engine, error: error.message});
    }
  }
  if (!state.showAllEngines || state.routeData !== route) return;

  clearMapLayers();
  list.replaceChildren();
  const bounds = L.latLngBounds([]);
  for (const result of results) {
    const row = document.createElement('div');
    row.className = 'hud-engine-row';
    const label = ENGINES[result.engine].label;
    if (result.route) {
      const computed = result.route;
      for (const {coords, road} of routeSegments(computed)) {
        const line = L.polyline(coords, {
          color: road ? '#ffc15a' : ENGINES[result.engine].coreColor,
          weight: 4,
          dashArray: road ? undefined : ENGINES[result.engine].dashArray
        }).addTo(state.map);
        state.multiRouteLayers.push(line);
        bounds.extend(line.getBounds());
      }
      row.textContent = `${label} · ${computed.engine} · ${computed.total_distance_km.toLocaleString()} km · ${computed.total_transit_hours} h`;
    } else {
      row.textContent = `${label} · ${result.error}`;
    }
    list.appendChild(row);
  }
  if (bounds.isValid()) state.map.fitBounds(bounds, {padding: [50, 50], maxZoom: 6});
}

function startVesselAnimation(coords) {
  if (coords.length < 2 || !state.map) return;

  const distances = [0];
  let totalDistance = 0;
  for (let i = 0; i < coords.length - 1; i++) {
    const lat1 = coords[i][0], lon1 = coords[i][1];
    const lat2 = coords[i + 1][0], lon2 = coords[i + 1][1];
    const dLat = (lat2 - lat1);
    const dLon = (lon2 - lon1) * Math.cos(((lat1 + lat2) / 2) * Math.PI / 180);
    const segDist = Math.sqrt(dLat * dLat + dLon * dLon);
    totalDistance += segDist;
    distances.push(totalDistance);
  }

  if (totalDistance <= 0) return;

  const initialBearing = calculateBearing(coords[0][0], coords[0][1], coords[1][0], coords[1][1]);
  state.vesselMarker = L.marker(coords[0], { 
    icon: getVesselIcon(initialBearing), 
    zIndexOffset: 1000 
  }).addTo(state.map);

  const VOYAGE_DURATION_MS = 50000;
  const FRAME_INTERVAL_MS = 40;
  const totalFrames = Math.floor(VOYAGE_DURATION_MS / FRAME_INTERVAL_MS);
  let currentFrame = 0;
  let lastBearing = initialBearing;

  state.vesselAnimTimer = setInterval(() => {
    currentFrame = (currentFrame + 1) % totalFrames;
    const progress = currentFrame / totalFrames;
    const targetDist = progress * totalDistance;

    let segIdx = 0;
    while (segIdx < distances.length - 2 && distances[segIdx + 1] < targetDist) {
      segIdx++;
    }

    const segStartDist = distances[segIdx];
    const segEndDist = distances[segIdx + 1];
    const segLen = segEndDist - segStartDist;
    const segFraction = segLen > 0 ? (targetDist - segStartDist) / segLen : 0;

    const p1 = coords[segIdx];
    const p2 = coords[segIdx + 1];

    const currentLat = p1[0] + (p2[0] - p1[0]) * segFraction;
    const currentLon = p1[1] + (p2[1] - p1[1]) * segFraction;
    const rawBearing = calculateBearing(p1[0], p1[1], p2[0], p2[1]);
    
    let diff = rawBearing - lastBearing;
    while (diff < -180) diff += 360;
    while (diff > 180) diff -= 360;
    lastBearing = (lastBearing + diff * 0.2 + 360) % 360;

    if (state.vesselMarker) {
      state.vesselMarker.setLatLng([currentLat, currentLon]);
      state.vesselMarker.setIcon(getVesselIcon(lastBearing));
    }
  }, FRAME_INTERVAL_MS);
}

async function requestRoute(payload) {
  const response = await fetch('/api/route', {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify(payload)
  });
  const data = await response.json();
  if (!response.ok || data.status !== 'success') {
    throw new Error(data.message || `Routing failed (HTTP ${response.status})`);
  }
  return data;
}

// Execute Route Optimization (Single Path A* or Multi-Stop TSP Permutation GA)
async function runOptimization() {
  if (state.calculating) {
    state.routeQueued = true;
    return;
  }
  state.calculating = true;
  if (state.showAllEngines) toggleAllEnginesComparison(false);

  const runBtn = document.getElementById('btn-run-route');
  const statusChip = document.getElementById('route-status-chip');
  const statusText = document.getElementById('route-status-text');

  const isMultiStop = state.intermediateStops && state.intermediateStops.length > 0;

  if (runBtn) {
    runBtn.innerHTML = `<span class="button-spinner"></span> ${isMultiStop ? 'OPTIMIZING MULTI-STOP TSP' : 'COMPUTING ROUTE'}`;
    runBtn.disabled = true;
  }
  if (statusChip) {
    statusChip.className = 'status-chip standby';
    statusText.textContent = isMultiStop ? 'SOLVING TSP TOUR...' : 'OPTIMIZING PATH...';
  }

  const originId = state.originPort ? state.originPort.id : 55196;
  const destId = state.destPort ? state.destPort.id : 21998;
  const viaIds = state.intermediateStops.map(s => s.id);
  const allWaypoints = [originId, ...viaIds, destId];

  const overlays = {
    road_rate: document.getElementById('road-rate').valueAsNumber,
    sea_rate: document.getElementById('sea-rate').valueAsNumber,
    transfer_cost: document.getElementById('transfer-cost').valueAsNumber,
    operating_rate: document.getElementById('operating-rate').valueAsNumber,
    currents: state.useCurrents,
    storms: state.showWeather ? state.weatherSamples.filter(sample => sample.radius_km)
      .map(({lat, lon, radius_km}) => ({lat, lon, radius_km})) : [],
    vessels: state.showTraffic ? state.vessels.map(({lat, lon}) => ({lat, lon})) : []
  };
  const payload = {
    ...overlays,
    origin_id: originId,
    dest_id: destId,
    waypoints: allWaypoints,
    action: isMultiStop ? 'tsp' : 'optimize',
    algorithm: state.engine,
    engine: state.engine,
    pop_size: 1000,
    generations: 40
  };

  const startTime = performance.now();

  try {
    const data = await requestRoute(payload);
    const execDuration = (performance.now() - startTime).toFixed(1);
    if (state.routeQueued) return;
    state.routeData = data;
    state.routeOverlays = overlays;
    if (statusChip) statusChip.className = 'status-chip';
    if (statusText) statusText.textContent = 'ROUTE READY';
    renderRouteOnMap(data);
    updateTelemetry(data, execDuration);
    renderItinerary(data);
    updateIntelligence(data);
    showToast("Optimized route ready", "success", `${data.engine} returned a route in ${execDuration} ms.`);
  } catch (err) {
    state.routeData = null;
    clearMapLayers();
    updateTelemetry(null);
    renderItinerary(null);
    updateIntelligence(null);
    if (statusChip) statusChip.className = 'status-chip standby';
    if (statusText) statusText.textContent = 'ROUTE UNAVAILABLE';
    showToast("Route optimization failed", "error", err.message);
  } finally {
    state.calculating = false;
    if (runBtn) {
      runBtn.innerHTML = `<svg width="17" height="17" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"/></svg> RUN OPTIMIZATION <span>⌘ ENTER</span>`;
      runBtn.disabled = false;
    }
    if (state.routeQueued) {
      state.routeQueued = false;
      runOptimization();
    }
  }
}

// Update KPI Telemetry Cards
function updateTelemetry(data, execMs) {
  const values = {
    'metric-dist': data ? Math.round(data.total_distance_km).toLocaleString() : '—',
    'metric-dist-sub': data ? `km · ${Math.round(data.total_distance_km / 1.852).toLocaleString()} nautical miles` : '',
    'metric-dist-trend': '',
    'metric-time': data ? data.total_transit_hours.toFixed(1) : '—',
    'metric-time-sub': data ? `${(data.total_transit_hours / 24).toFixed(1)} days` : '',
    'metric-time-trend': '',
    'metric-cost': data ? data.total_cost.toLocaleString() : '—',
    'metric-cost-trend': '',
    'metric-exec': data ? (execMs ?? data.api_execution_time_ms) : '—',
    'metric-exec-sub': data ? `${data.engine} · ms` : '',
    'exec-time-label': data ? `${execMs ?? data.api_execution_time_ms} ms` : '—',
    'exec-algorithm-label': data ? data.engine : 'Route unavailable'
  };
  for (const [id, value] of Object.entries(values)) {
    const element = document.getElementById(id);
    if (element) element.textContent = value;
  }
}

function renderItinerary(data) {
  const container = document.getElementById('itinerary-list-container');
  const title = document.getElementById('itinerary-title');
  if (title) title.textContent = data ? `${data.origin_name} → ${data.dest_name}` : 'Route unavailable';
  if (!container) return;
  container.replaceChildren();
  if (!data) return;

  const scheduledStops = (data.tsp_tour || []).slice(1, -1);
  const roadLegs = new Map((data.road_legs || []).map(leg => [leg.path_index, leg]));
  let nextStop = 0;
  const lastIndex = data.nodes.length - 1;
  data.nodes.forEach((node, index) => {
    const departure = index === 0;
    const arrival = index === lastIndex;
    const stop = node.id === scheduledStops[nextStop];
    if (stop) nextStop += 1;
    const previous = data.nodes[index - 1];
    const road = roadLegs.get(index);
    const roadArrival = roadLegs.has(index - 1);
    if (!departure && !arrival && !stop && !road && !roadArrival &&
        (/^Sea_Waypoint_\d+$/.test(node.name) || node.id === previous?.id)) return;

    const row = document.createElement('div');
    row.className = 'stop-row';
    const dot = document.createElement('span');
    dot.className = `stop-dot ${departure ? 'origin-dot' : arrival ? 'dest-dot' : ''}`;
    const details = document.createElement('div');
    const name = document.createElement('b');
    name.textContent = node.name;
    const label = document.createElement('small');
    label.textContent = departure && arrival ? 'Departure and arrival' :
      departure ? 'Departure' : arrival ? 'Arrival' : stop ? 'Scheduled stop' : 'Route checkpoint';
    details.append(name, label);
    if (road) {
      const roadDetail = document.createElement('small');
      roadDetail.textContent = `Road to ${data.nodes[index + 1].name} · ${road.distance_km.toFixed(1)} km${road.roads.length ? ' via ' + road.roads.join(', ') : ''}`;
      details.appendChild(roadDetail);
    }
    row.append(dot, details);
    if (container.lastElementChild) {
      const arrow = document.createElement('span');
      arrow.className = 'itinerary-arrow';
      arrow.setAttribute('aria-hidden', 'true');
      arrow.textContent = '↓';
      container.appendChild(arrow);
    }
    container.appendChild(row);
  });
}

function updateIntelligence(data) {
  const title = document.getElementById('insight-title');
  const summary = document.getElementById('route-summary');
  title.textContent = data ? data.engine : 'Route unavailable';
  summary.hidden = !data;
  if (!data) return;
  const format = {maximumFractionDigits: 2};
  document.getElementById('summary-distance').textContent = `${data.total_distance_km.toLocaleString(undefined, format)} km`;
  const roadDistance = (data.road_legs || []).reduce((total, leg) => total + leg.distance_km, 0);
  document.getElementById('summary-road-row').hidden = roadDistance === 0;
  document.getElementById('summary-road').textContent = `${roadDistance.toLocaleString(undefined, format)} km`;
  const usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });
  document.getElementById('summary-transfer').textContent = data.total_transfer_cost == null ? '—' :
    `${usd.format(data.total_transfer_cost)} · ${data.mode_switches} transfers`;
  document.getElementById('summary-transit').textContent = `${data.total_transit_hours.toLocaleString(undefined, format)} h`;
  document.getElementById('summary-total-cost').textContent = usd.format(data.total_cost);
  document.getElementById('summary-fuel').textContent = usd.format(data.fuel_cost);
  document.getElementById('summary-waypoints').textContent = data.nodes.length.toLocaleString();
  document.getElementById('summary-marine-model').textContent = data.marine_model || 'Off';
  document.getElementById('summary-objective').textContent = data.requested_engine === 'astar'
    ? 'Standard route score'
    : `Lowest modeled cost · ${data.time_cost_per_hour} per transit hour`;
}

async function triggerDisruption(type) {
  const delay = state.delayHours || 72;
  try {
    const response = await fetch('/api/congestion', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({node_id: 49102, delay_hours: delay, event_type: type})
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    state.activeDisruption = true;
    state.disruptedEvent = type;
    state.delayHours = delay;
    state.disruptedNodeId = '49102';
    document.getElementById('disruption-panel')?.classList.add('incident');
    showToast("Singapore delay applied", "warning", `Added ${delay} hours to Singapore arrivals.`);
    runOptimization();
  } catch (error) {
    showToast("Disruption update failed", "error", error.message);
  }
}

async function resetDisruption() {
  try {
    const response = await fetch('/api/congestion/reset', {method: 'POST'});
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    state.activeDisruption = false;
    state.disruptedEvent = null;
    state.disruptedNodeId = null;
    document.getElementById('disruption-panel')?.classList.remove('incident');
    showToast("Congestion delays cleared", "success");
    runOptimization();
  } catch (error) {
    showToast("Congestion reset failed", "error", error.message);
  }
}

// Export Manifest
function exportManifest() {
  const route = state.routeData;
  if (!route) {
    showToast("Compute a route first", "warning");
    return;
  }
  const originName = route.origin_name;
  const destName = route.dest_name;
  const manifest = {
    voyage_id: `MR-${Date.now().toString(36).toUpperCase()}`,
    departure_port: originName,
    arrival_port: destName,
    intermediate_stops: (route.tsp_waypoints || []).slice(1, -1).map(port => port.name),
    compute_engine: route.engine,
    total_distance_km: route.total_distance_km,
    transit_duration_hours: route.total_transit_hours,
    routing_score: route.total_cost,
    estimated_fuel_cost_usd: route.fuel_cost,
    generated_utc: new Date().toISOString()
  };

  const blob = new Blob([JSON.stringify(manifest, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `manifest_${originName.replace(/\s+/g, '_')}_to_${destName.replace(/\s+/g, '_')}.json`;
  a.click();
  URL.revokeObjectURL(url);

  showToast("Route manifest exported", "success", "Container vessel voyage manifest downloaded.");
}

// Setup Event Listeners
function openItineraryDetailModal() {
  const route = state.routeData;
  if (!route) {
    showToast("Compute a route first", "warning");
    return;
  }
  const table = document.getElementById('itinerary-modal-tbody');
  document.getElementById('itinerary-modal-subtitle').textContent =
    `${route.origin_name} → ${route.dest_name} · ${route.nodes.length.toLocaleString()} waypoints`;
  const fragment = document.createDocumentFragment();
  route.nodes.forEach((node, index) => {
    const row = document.createElement('tr');
    for (const value of [index + 1, node.name, `${node.lat.toFixed(5)}, ${node.lon.toFixed(5)}`]) {
      const cell = document.createElement('td');
      cell.textContent = value;
      row.appendChild(cell);
    }
    fragment.appendChild(row);
  });
  table.replaceChildren(fragment);
  document.getElementById('itinerary-modal').classList.add('active');
}

function exportWaypointsCSV() {
  if (!state.routeData) return;
  const lines = ['node_id,name,latitude,longitude'];
  for (const node of state.routeData.nodes) {
    const name = /^[=+@\-\t\r\n]/.test(node.name) ? "'" + node.name : node.name;
    lines.push(`${node.id},"${name.replaceAll('"', '""')}",${node.lat},${node.lon}`);
  }
  const url = URL.createObjectURL(new Blob([lines.join('\r\n')], {type: 'text/csv'}));
  const link = document.createElement('a');
  link.href = url;
  link.download = 'route-waypoints.csv';
  link.click();
  URL.revokeObjectURL(url);
}

function setupEvents() {
  // Origin / Destination Selects
  const originSel = document.getElementById('origin-select');
  const destSel = document.getElementById('dest-select');
  const swapBtn = document.getElementById('btn-swap-ports');
  const addStopBtn = document.getElementById('btn-add-stop');

  if (originSel) {
    originSel.addEventListener('change', (e) => {
      const pid = parseInt(e.target.value);
      state.originPort = state.ports.find(p => p.id === pid);
      updatePortSubtitles();
      runOptimization();
    });
  }

  if (destSel) {
    destSel.addEventListener('change', (e) => {
      const pid = parseInt(e.target.value);
      state.destPort = state.ports.find(p => p.id === pid);
      updatePortSubtitles();
      runOptimization();
    });
  }

  if (swapBtn) {
    swapBtn.addEventListener('click', () => {
      const temp = state.originPort;
      state.originPort = state.destPort;
      state.destPort = temp;

      if (originSel && state.originPort) originSel.value = state.originPort.id;
      if (destSel && state.destPort) destSel.value = state.destPort.id;

      updatePortSubtitles();
      showToast("Origin and destination swapped", "info");
      runOptimization();
    });
  }

  if (addStopBtn) {
    addStopBtn.addEventListener('click', () => addIntermediateStop());
  }

  // Engine Choice Buttons
  document.querySelectorAll('.engine-choice').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.engine-choice').forEach(b => {
        b.classList.remove('selected');
        const dot = b.querySelector('i');
        if (dot) dot.remove();
      });

      btn.classList.add('selected');
      const dot = document.createElement('i');
      btn.appendChild(dot);

      state.engine = btn.dataset.engine;
      runOptimization();
    });
  });

  // Delay Slider & Presets
  const slider = document.getElementById('delay-slider');
  const display = document.getElementById('delay-display');

  if (slider) {
    slider.addEventListener('input', (e) => {
      state.delayHours = parseInt(e.target.value);
      if (display) display.textContent = `+${state.delayHours}h`;
      
      document.querySelectorAll('.preset-btn').forEach(b => {
        b.classList.toggle('active', parseInt(b.dataset.hours) === state.delayHours);
      });
    });
  }

  document.querySelectorAll('.preset-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const hrs = parseInt(btn.dataset.hours);
      state.delayHours = hrs;
      if (slider) slider.value = hrs;
      if (display) display.textContent = `+${hrs}h`;

      document.querySelectorAll('.preset-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
    });
  });

  // Disruption Actions
  const strikeBtn = document.getElementById('btn-strike');
  const typhoonBtn = document.getElementById('btn-typhoon');
  const resetBtn = document.getElementById('btn-reset');

  if (strikeBtn) strikeBtn.addEventListener('click', () => triggerDisruption('strike'));
  if (typhoonBtn) typhoonBtn.addEventListener('click', () => triggerDisruption('typhoon'));
  if (resetBtn) resetBtn.addEventListener('click', () => resetDisruption());

  // Run Route Button & Shortcut (Cmd/Ctrl + Enter)
  const runBtn = document.getElementById('btn-run-route');
  if (runBtn) runBtn.addEventListener('click', runOptimization);

  window.addEventListener('keydown', (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault();
      runOptimization();
    }
  });

  // Compare All 4 Engines Simultaneous Route Toggle
  const toggleAllRoutesBtn = document.getElementById('btn-toggle-all-routes');
  const compareAllPanelBtn = document.getElementById('btn-compare-all-panel');
  const closeHudBtn = document.getElementById('btn-close-hud');
  const singleRouteViewBtn = document.getElementById('btn-single-route-view');

  if (toggleAllRoutesBtn) {
    toggleAllRoutesBtn.addEventListener('click', () => toggleAllEnginesComparison());
  }
  if (compareAllPanelBtn) {
    compareAllPanelBtn.addEventListener('click', () => toggleAllEnginesComparison());
  }
  if (closeHudBtn) {
    closeHudBtn.addEventListener('click', () => toggleAllEnginesComparison(false));
  }
  if (singleRouteViewBtn) {
    singleRouteViewBtn.addEventListener('click', () => toggleAllEnginesComparison(false));
  }

  // Layer Toggle Toolbar Buttons (Seaports, Weather Radar & AIS Traffic)
  const togglePortsBtn = document.getElementById('btn-toggle-ports');
  const toggleWeatherBtn = document.getElementById('btn-toggle-weather');
  const toggleTrafficBtn = document.getElementById('btn-toggle-traffic');
  const toggleCurrentsBtn = document.getElementById('btn-toggle-currents');
  const mapTools = toggleCurrentsBtn.closest('.map-tools');
  let toolbarDrag;
  mapTools.addEventListener('pointerdown', event => {
    if (event.pointerType !== 'mouse' || event.button !== 0 ||
        mapTools.scrollWidth <= mapTools.clientWidth) return;
    toolbarDrag = {id: event.pointerId, start: event.clientX, scroll: mapTools.scrollLeft};
  });
  mapTools.addEventListener('pointermove', event => {
    if (toolbarDrag?.id !== event.pointerId) return;
    if (!(event.buttons & 1)) {
      toolbarDrag = null;
      return;
    }
    const offset = event.clientX - toolbarDrag.start;
    if (!toolbarDrag.moved && Math.abs(offset) < 5) return;
    if (!toolbarDrag.moved) {
      toolbarDrag.moved = true;
      mapTools.setPointerCapture(event.pointerId);
      mapTools.classList.add('is-dragging');
    }
    mapTools.scrollLeft = toolbarDrag.scroll - offset;
  });
  const finishToolbarDrag = () => {
    toolbarDrag = null;
    mapTools.classList.remove('is-dragging');
  };
  mapTools.addEventListener('pointerup', finishToolbarDrag);
  mapTools.addEventListener('pointercancel', finishToolbarDrag);
  mapTools.addEventListener('lostpointercapture', finishToolbarDrag);
  toggleCurrentsBtn.addEventListener('click', () => {
    state.useCurrents = !state.useCurrents;
    toggleCurrentsBtn.classList.toggle('active', state.useCurrents);
    toggleCurrentsBtn.setAttribute('aria-pressed', String(state.useCurrents));
    runOptimization();
  });

  if (togglePortsBtn) {
    togglePortsBtn.addEventListener('click', () => togglePortsLayer());
  }
  if (toggleWeatherBtn) {
    toggleWeatherBtn.addEventListener('click', () => toggleWeatherLayer());
  }
  if (toggleTrafficBtn) {
    toggleTrafficBtn.addEventListener('click', () => toggleTrafficLayer());
  }

  // Export Manifest Button
  const exportBtn = document.getElementById('btn-export-manifest');
  if (exportBtn) exportBtn.addEventListener('click', exportManifest);

  // Compare Engines Modal
  const compareModal = document.getElementById('compare-modal');
  const openCompareBtn = document.getElementById('btn-open-compare');
  const closeCompareBtn = document.getElementById('btn-close-compare');
  const closeCompareBtn2 = document.getElementById('btn-close-compare-btn');

  if (openCompareBtn && compareModal) {
    openCompareBtn.addEventListener('click', () => compareModal.classList.add('active'));
  }
  if (closeCompareBtn && compareModal) {
    closeCompareBtn.addEventListener('click', () => compareModal.classList.remove('active'));
  }
  if (closeCompareBtn2 && compareModal) {
    closeCompareBtn2.addEventListener('click', () => compareModal.classList.remove('active'));
  }

  // Turn-by-Turn Itinerary Detail Modal
  const itinModal = document.getElementById('itinerary-modal');
  const viewItinBtn = document.getElementById('btn-view-itinerary-detail');
  const closeItinBtn = document.getElementById('btn-close-itin');
  const closeItinBtn2 = document.getElementById('btn-close-itin-btn');
  const exportWpBtn = document.getElementById('btn-export-waypoints');

  if (viewItinBtn) {
    viewItinBtn.addEventListener('click', openItineraryDetailModal);
  }
  if (closeItinBtn && itinModal) {
    closeItinBtn.addEventListener('click', () => itinModal.classList.remove('active'));
  }
  if (closeItinBtn2 && itinModal) {
    closeItinBtn2.addEventListener('click', () => itinModal.classList.remove('active'));
  }
  if (exportWpBtn) {
    exportWpBtn.addEventListener('click', exportWaypointsCSV);
  }

  // Recenter & Fullscreen Map
  const recenterBtn = document.getElementById('btn-recenter-map');
  const fullscreenBtn = document.getElementById('btn-fullscreen-map');

  if (recenterBtn) {
    recenterBtn.addEventListener('click', () => {
      if (state.routeData) renderRouteOnMap(state.routeData);
    });
  }

  if (fullscreenBtn) {
    fullscreenBtn.addEventListener('click', () => {
      const shell = document.querySelector('.map-shell');
      if (!document.fullscreenElement) {
        shell.requestFullscreen().catch(err => console.log(err));
      } else {
        document.exitFullscreen();
      }
    });
  }

}

// App Initialization
document.addEventListener('DOMContentLoaded', async () => {
  renderItinerary(null);
  initMap();
  setupEvents();
  await Promise.all([loadPorts(), refreshMarineOverlays()]);
  setInterval(refreshMarineOverlays, 15000);
  try {
    const health = await fetch('/api/health');
    if (health.ok && (await health.json()).mpi_ready) {
      const mpi = document.querySelector('[data-engine="mpi"]');
      mpi.disabled = false;
      mpi.querySelector('small').textContent = '2 local processes';
    }
  } catch (error) {
    console.warn('Unable to check MPI availability:', error);
  }
  runOptimization();
});
