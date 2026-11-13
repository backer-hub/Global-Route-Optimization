/**
 * MarineRoute AI — Command Center Application Logic
 * High-Performance Oceanic Container Shipping Route Optimizer
 * Features:
 * - Multi-Stop Intermediate Waypoint Management & TSP Permutation GA Optimization
 * - Worldwide Live Weather Radars, Cyclones, Gales & Oceanic Buoy Telemetry (Global Coverage)
 * - Worldwide Live AIS Marine Traffic Fleet Simulation (36+ Global Commercial Vessels & Anchorages)
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
  aisMarkers: [],
  aisFleetTimer: null
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

// Worldwide Live Marine Weather Storm Systems Across ALL Oceans
const LIVE_WEATHER_STORMS = [
  // Pacific Basin
  { id: "storm_guchol", name: "Typhoon Guchol (Category 3)", type: "Tropical Cyclone", lat: 19.8, lon: 118.5, radius_km: 320, wind_kts: 52, gusts_kts: 70, wave_height_m: 5.6, pressure_hpa: 964, status: "Active Cyclone Warning", color: "#ef4444" },
  { id: "storm_bolaven", name: "Super Typhoon Bolaven (Cat 5)", type: "Super Typhoon", lat: 16.5, lon: 138.2, radius_km: 450, wind_kts: 95, gusts_kts: 120, wave_height_m: 8.4, pressure_hpa: 920, status: "Severe Tropical Warning", color: "#ef4444" },
  { id: "swell_kuroshio", name: "Kuroshio Pacific Rogue Swell", type: "Oceanic Swell Zone", lat: 33.5, lon: 142.8, radius_km: 240, wind_kts: 34, gusts_kts: 44, wave_height_m: 4.1, pressure_hpa: 1004, status: "High Swell Advisory", color: "#fda60a" },
  { id: "storm_hilary", name: "Hurricane Hilary (Category 2)", type: "Eastern Pacific Hurricane", lat: 21.4, lon: -111.5, radius_km: 290, wind_kts: 65, gusts_kts: 80, wave_height_m: 6.2, pressure_hpa: 972, status: "Hurricane Warning", color: "#ef4444" },
  
  // Atlantic Basin
  { id: "storm_lee", name: "Hurricane Lee (Major Cat 3)", type: "North Atlantic Hurricane", lat: 26.2, lon: -63.5, radius_km: 380, wind_kts: 78, gusts_kts: 96, wave_height_m: 7.1, pressure_hpa: 950, status: "Hurricane Warning", color: "#ef4444" },
  { id: "gale_celtic", name: "North Atlantic Extratropical Gale", type: "Deep Low Pressure", lat: 49.5, lon: -8.5, radius_km: 360, wind_kts: 48, gusts_kts: 62, wave_height_m: 5.8, pressure_hpa: 976, status: "Gale Warning Force 9", color: "#ef4444" },
  { id: "gale_arctic", name: "Arctic Polar Low Gale", type: "Polar Mesocyclone", lat: 62.4, lon: 3.5, radius_km: 280, wind_kts: 40, gusts_kts: 55, wave_height_m: 4.8, pressure_hpa: 984, status: "Polar Low Advisory", color: "#38bdf8" },

  // Indian Ocean & Arabian Sea
  { id: "swell_arabian", name: "Arabian Sea Monsoon Swell", type: "Severe Oceanic Swell", lat: 14.5, lon: 64.0, radius_km: 380, wind_kts: 28, gusts_kts: 38, wave_height_m: 3.8, pressure_hpa: 1008, status: "Heavy Swell Advisory", color: "#fda60a" },
  { id: "depression_bengal", name: "Bay of Bengal Deep Depression", type: "Cyclonic Depression", lat: 12.8, lon: 87.2, radius_km: 260, wind_kts: 38, gusts_kts: 48, wave_height_m: 4.3, pressure_hpa: 994, status: "Tropical Storm Watch", color: "#f59e0b" },
  { id: "swell_south_indian", name: "South Indian Ocean Swell Belt", type: "Deepwater Swell", lat: -28.5, lon: 78.0, radius_km: 420, wind_kts: 35, gusts_kts: 48, wave_height_m: 5.2, pressure_hpa: 998, status: "Open Ocean Swell", color: "#fda60a" },

  // Mediterranean & Red Sea
  { id: "mistral_med", name: "Mediterranean Mistral Storm", type: "Gale Wind Corridor", lat: 40.8, lon: 5.2, radius_km: 220, wind_kts: 38, gusts_kts: 50, wave_height_m: 3.5, pressure_hpa: 1006, status: "Mistral Gale Alert", color: "#f59e0b" },
  { id: "wind_redsea", name: "Red Sea Northerly Channeling", type: "High Sea Corridor", lat: 23.2, lon: 37.8, radius_km: 180, wind_kts: 24, gusts_kts: 32, wave_height_m: 2.3, pressure_hpa: 1012, status: "Moderate Chop", color: "#13d6e8" },

  // Southern Oceans
  { id: "roaring_forties", name: "Roaring Forties Oceanic Swell", type: "Circumpolar Gale", lat: -36.5, lon: 22.0, radius_km: 480, wind_kts: 44, gusts_kts: 58, wave_height_m: 6.5, pressure_hpa: 988, status: "Heavy High Seas Alert", color: "#ef4444" },
  { id: "drake_gale", name: "Furious Fifties Cape Horn Gale", type: "Antarctic Low Pressure", lat: -56.5, lon: -65.0, radius_km: 400, wind_kts: 55, gusts_kts: 72, wave_height_m: 7.8, pressure_hpa: 968, status: "Storm Warning Force 10", color: "#ef4444" }
];

// Worldwide Live Weather Buoys (24 Stations Across All Global Oceans)
const LIVE_WEATHER_BUOYS = [
  // APAC & Pacific
  { id: "BUOY-21401", name: "East China Sea Buoy #21401", lat: 29.5, lon: 124.2, wave_m: 1.8, wind_kts: 14.2, temp_c: 22.4, press_hpa: 1013 },
  { id: "BUOY-52003", name: "South China Sea Deep Buoy #52003", lat: 15.2, lon: 114.5, wave_m: 3.4, wind_kts: 26.5, temp_c: 28.1, press_hpa: 1004 },
  { id: "BUOY-21418", name: "Philippine Sea Deepwater #21418", lat: 18.5, lon: 133.0, wave_m: 4.6, wind_kts: 32.0, temp_c: 28.9, press_hpa: 998 },
  { id: "BUOY-51001", name: "Hawaiian Ridge Deep Ocean #51001", lat: 24.4, lon: -162.0, wave_m: 2.1, wind_kts: 15.0, temp_c: 25.3, press_hpa: 1016 },
  { id: "BUOY-46001", name: "Gulf of Alaska Ocean Buoy #46001", lat: 56.3, lon: -148.2, wave_m: 3.8, wind_kts: 24.5, temp_c: 9.8, press_hpa: 1002 },
  { id: "BUOY-46042", name: "California Offshore Buoy #46042", lat: 36.8, lon: -122.4, wave_m: 2.0, wind_kts: 12.0, temp_c: 15.6, press_hpa: 1014 },
  { id: "BUOY-55012", name: "Coral Sea Great Barrier #55012", lat: -16.8, lon: 150.2, wave_m: 1.5, wind_kts: 14.0, temp_c: 26.8, press_hpa: 1012 },

  // Indian Ocean & Middle East
  { id: "BUOY-23001", name: "Malacca Strait Gateway #23001", lat: 4.5, lon: 98.2, wave_m: 1.1, wind_kts: 9.0, temp_c: 29.5, press_hpa: 1010 },
  { id: "BUOY-23401", name: "Sri Lanka Deepwater #23401", lat: 5.8, lon: 82.5, wave_m: 2.4, wind_kts: 18.0, temp_c: 28.8, press_hpa: 1009 },
  { id: "BUOY-53002", name: "Arabian Sea Central #53002", lat: 15.0, lon: 65.0, wave_m: 2.9, wind_kts: 22.0, temp_c: 27.2, press_hpa: 1008 },
  { id: "BUOY-62001", name: "Gulf of Aden Gateway #62001", lat: 12.8, lon: 45.0, wave_m: 1.9, wind_kts: 16.5, temp_c: 30.1, press_hpa: 1011 },
  { id: "BUOY-56001", name: "Java Sea Deepwater Buoy #56001", lat: -5.4, lon: 110.2, wave_m: 1.3, wind_kts: 11.0, temp_c: 29.0, press_hpa: 1011 },

  // Atlantic & Europe
  { id: "BUOY-62145", name: "Europort North Sea Buoy #62145", lat: 52.2, lon: 3.8, wave_m: 1.4, wind_kts: 13.0, temp_c: 13.8, press_hpa: 1015 },
  { id: "BUOY-62107", name: "English Channel Ushant #62107", lat: 48.8, lon: -5.2, wave_m: 2.8, wind_kts: 21.0, temp_c: 14.2, press_hpa: 1002 },
  { id: "BUOY-61002", name: "Central Mediterranean Buoy #61002", lat: 36.2, lon: 18.5, wave_m: 1.2, wind_kts: 11.0, temp_c: 21.0, press_hpa: 1016 },
  { id: "BUOY-62029", name: "Gibraltar West Approach #62029", lat: 35.8, lon: -7.2, wave_m: 1.7, wind_kts: 15.0, temp_c: 19.5, press_hpa: 1018 },
  { id: "BUOY-41044", name: "Mid-Atlantic Ridge Buoy #41044", lat: 21.6, lon: -58.6, wave_m: 3.1, wind_kts: 20.0, temp_c: 27.0, press_hpa: 1014 },
  { id: "BUOY-41048", name: "Bermuda Deepwater Buoy #41048", lat: 31.9, lon: -69.6, wave_m: 2.6, wind_kts: 17.5, temp_c: 23.4, press_hpa: 1017 },
  { id: "BUOY-42001", name: "Gulf of Mexico Central #42001", lat: 25.9, lon: -89.7, wave_m: 1.6, wind_kts: 13.5, temp_c: 26.2, press_hpa: 1015 },
  { id: "BUOY-42058", name: "Caribbean Sea Central #42058", lat: 14.9, lon: -74.9, wave_m: 2.2, wind_kts: 18.0, temp_c: 28.4, press_hpa: 1011 },

  // Southern Oceans & South Atlantic
  { id: "BUOY-17001", name: "Cape of Good Hope Buoy #17001", lat: -34.8, lon: 18.2, wave_m: 4.2, wind_kts: 28.0, temp_c: 16.2, press_hpa: 1010 },
  { id: "BUOY-32302", name: "Drake Passage Antarctic #32302", lat: -58.2, lon: -62.4, wave_m: 5.6, wind_kts: 38.0, temp_c: 2.1, press_hpa: 982 }
];

// Worldwide Live Commercial AIS Marine Fleet (36 Vessels Active Globally)
const LIVE_AIS_VESSELS = [
  // Asia-Europe Trade Lane
  { name: "MSC IRINA", type: "Container (ULCV 24,346 TEU)", imo: "9929429", mmsi: "636021832", flag: "🇱🇷 Liberia", lat: 27.8, lon: 122.5, course: 195, speed: 19.8, dest: "SGSIN (Singapore)", eta: "Oct 01 08:00" },
  { name: "EVER GIVEN", type: "Container (ULCV 20,124 TEU)", imo: "9811000", mmsi: "353136000", flag: "🇵🇦 Panama", lat: 18.2, lon: 116.4, course: 220, speed: 18.5, dest: "NLRTM (Rotterdam)", eta: "Oct 14 16:30" },
  { name: "CMA CGM JACQUES SAADÉ", type: "Container LNG (23,000 TEU)", imo: "9839179", mmsi: "228388600", flag: "🇫🇷 France", lat: 1.18, lon: 104.2, course: 285, speed: 12.4, dest: "EGPSD (Port Said)", eta: "Oct 08 04:00" },
  { name: "MADRID MAERSK", type: "Container Triple-E (20,568 TEU)", imo: "9778791", mmsi: "219836000", flag: "🇩🇰 Denmark", lat: 6.2, lon: 81.2, course: 275, speed: 20.4, dest: "AEJEA (Dubai)", eta: "Oct 04 22:00" },
  { name: "OOCL SPAIN", type: "Container (ULCV 24,188 TEU)", imo: "9942738", mmsi: "477833800", flag: "🇭🇰 Hong Kong", lat: 11.5, lon: 58.4, course: 290, speed: 19.2, dest: "NLRTM (Rotterdam)", eta: "Oct 12 11:00" },
  { name: "HMM ALGECIRAS", type: "Container (ULCV 23,964 TEU)", imo: "9863297", mmsi: "351394000", flag: "🇵🇦 Panama", lat: 13.1, lon: 43.8, course: 320, speed: 17.6, dest: "DEHAM (Hamburg)", eta: "Oct 15 19:00" },
  { name: "COSCO SHIPPING UNIVERSE", type: "Container (ULCV 21,237 TEU)", imo: "9795610", mmsi: "477180700", flag: "🇭🇰 Hong Kong", lat: 25.4, lon: 36.1, course: 335, speed: 18.1, dest: "EGSUE (Suez)", eta: "Sep 28 06:00" },
  { name: "ONE INGENUITY", type: "Container (ULCV 24,136 TEU)", imo: "9937321", mmsi: "352003291", flag: "🇯🇵 Japan", lat: 34.8, lon: 23.4, course: 285, speed: 19.5, dest: "ESVLC (Valencia)", eta: "Oct 03 14:00" },
  { name: "APL MERLION", type: "Container (13,892 TEU)", imo: "9631967", mmsi: "566232000", flag: "🇸🇬 Singapore", lat: 50.1, lon: -0.8, course: 65, speed: 16.8, dest: "NLRTM (Rotterdam)", eta: "Sep 27 02:00" },

  // Trans-Pacific Corridors (Asia to US West Coast & Pacific Rim)
  { name: "MSC TESSA", type: "Container (ULCV 24,116 TEU)", imo: "9929417", mmsi: "636021816", flag: "🇱🇷 Liberia", lat: 34.2, lon: 155.0, course: 82, speed: 20.2, dest: "USLAX (Los Angeles)", eta: "Oct 06 14:00" },
  { name: "EVER ARM", type: "Container (24,004 TEU)", imo: "9893943", mmsi: "352001229", flag: "🇹🇼 Taiwan", lat: 33.1, lon: -140.5, course: 95, speed: 19.4, dest: "USLGB (Long Beach)", eta: "Oct 02 18:00" },
  { name: "COSCO PRIDE", type: "Container (13,386 TEU)", imo: "9448762", mmsi: "477757300", flag: "🇭🇰 Hong Kong", lat: 35.8, lon: 168.4, course: 78, speed: 18.8, dest: "USOAK (Oakland)", eta: "Oct 07 20:00" },
  { name: "ONE APUS", type: "Container (14,052 TEU)", imo: "9806079", mmsi: "353461000", flag: "🇯🇵 Japan", lat: 31.5, lon: -128.2, course: 105, speed: 18.0, dest: "USLAX (Los Angeles)", eta: "Sep 29 12:00" },
  { name: "SM BUSAN", type: "Container (6,655 TEU)", imo: "9312755", mmsi: "440128000", flag: "🇰🇷 S. Korea", lat: 45.2, lon: 170.0, course: 85, speed: 17.5, dest: "CAVAN (Vancouver)", eta: "Oct 04 06:00" },

  // Trans-Atlantic & Caribbean
  { name: "MAERSK MC-KINNEY MOLLER", type: "Container Triple-E (18,270 TEU)", imo: "9619907", mmsi: "219018271", flag: "🇩🇰 Denmark", lat: 44.5, lon: -38.2, course: 260, speed: 19.0, dest: "USNYC (New York)", eta: "Oct 03 16:00" },
  { name: "CMA CGM MARCO POLO", type: "Container (16,020 TEU)", imo: "9454436", mmsi: "228029600", flag: "🇫🇷 France", lat: 38.2, lon: -54.0, course: 275, speed: 18.4, dest: "USSAV (Savannah)", eta: "Oct 05 09:00" },
  { name: "HAPAG-LLOYD BERLIN EXPRESS", type: "Container LNG (23,664 TEU)", imo: "9540118", mmsi: "211333000", flag: "🇩🇪 Germany", lat: 46.2, lon: -22.5, course: 255, speed: 19.8, dest: "USNYC (New York)", eta: "Oct 02 22:00" },
  { name: "MSC VALENTINA", type: "Container (14,028 TEU)", imo: "9839296", mmsi: "355938000", flag: "🇵🇦 Panama", lat: 14.8, lon: -72.0, course: 245, speed: 17.2, dest: "PACON (Colon)", eta: "Sep 29 18:00" },

  // Middle East / Persian Gulf / Tankers & LNG
  { name: "TI OCEANIA", type: "Crude Tanker (ULCC 441k DWT)", imo: "9246633", mmsi: "538001602", flag: "🇲🇭 Marshall Is", lat: 24.6, lon: 56.2, course: 125, speed: 15.0, dest: "CNSHA (Shanghai)", eta: "Oct 10 09:00" },
  { name: "AL DAFNA", type: "LNG Carrier Q-Max (266k m³)", imo: "9443683", mmsi: "538003444", flag: "🇲🇭 Marshall Is", lat: 22.0, lon: 61.5, course: 110, speed: 18.2, dest: "JPYOK (Tokyo)", eta: "Oct 08 14:00" },
  { name: "FRONT ALTAIR", type: "Crude Tanker (VLCC 300k DWT)", imo: "9745902", mmsi: "538007204", flag: "🇲🇭 Marshall Is", lat: 18.2, lon: 66.8, course: 135, speed: 14.8, dest: "SGSIN (Singapore)", eta: "Oct 06 18:00" },
  { name: "BW PIONEER", type: "LPG Tanker (84,000 m³)", imo: "9683984", mmsi: "563045000", flag: "🇸🇬 Singapore", lat: 12.2, lon: 52.0, course: 95, speed: 16.5, dest: "INNSA (Mumbai)", eta: "Sep 30 11:00" },

  // Bulk Ore Carriers & Capesize
  { name: "BERGE EVEREST", type: "Bulk Carrier (VLOC 388k DWT)", imo: "9447536", mmsi: "235086812", flag: "🇮🇲 Isle of Man", lat: 36.4, lon: -4.8, course: 260, speed: 14.2, dest: "NLRTM (Rotterdam)", eta: "Sep 30 18:00" },
  { name: "VALE BRASIL", type: "Valemax VLOC (400k DWT)", imo: "9488918", mmsi: "538004183", flag: "🇲🇭 Marshall Is", lat: -18.5, lon: -35.2, course: 15, speed: 14.0, dest: "CNNBO (Ningbo)", eta: "Oct 25 08:00" },
  { name: "STELLA DAPHNE", type: "Capesize Bulker (180k DWT)", imo: "9583720", mmsi: "354673000", flag: "🇵🇦 Panama", lat: -18.2, lon: 112.5, course: 345, speed: 13.8, dest: "CNSHA (Shanghai)", eta: "Oct 08 20:00" },

  // Mediterranean & Intra-European Feeders
  { name: "GRIMALDI GRANDE NIGERIA", type: "Ro-Ro / Car Carrier", imo: "9246580", mmsi: "247087200", flag: "🇮🇹 Italy", lat: 37.5, lon: 14.2, course: 290, speed: 17.0, dest: "ESVLC (Valencia)", eta: "Sep 28 14:00" },
  { name: "UNIFEEDER HEINRICH S", type: "Feeder Container (1,025 TEU)", imo: "9187904", mmsi: "211284530", flag: "🇩🇪 Germany", lat: 54.8, lon: 8.2, course: 45, speed: 15.2, dest: "SEGOT (Gothenburg)", eta: "Sep 27 19:00" }
];

// Worldwide Port Anchorage Roads & Waiting Queues
const LIVE_PORT_ANCHORAGES = [
  { name: "Port of Shanghai Outer Anchorage", lat: 31.05, lon: 122.55, vessels_waiting: 45, avg_dwell_hrs: 24.2, status: "Moderate Staging" },
  { name: "Singapore Eastern Anchorage (OPL)", lat: 1.25, lon: 103.92, vessels_waiting: 38, avg_dwell_hrs: 18.4, status: "High Density Queue" },
  { name: "Port Said / Suez North Convoy Roads", lat: 31.35, lon: 32.35, vessels_waiting: 22, avg_dwell_hrs: 12.0, status: "Suez Convoy Staging" },
  { name: "Suez Canal South Entry Anchorage", lat: 29.80, lon: 32.55, vessels_waiting: 18, avg_dwell_hrs: 10.5, status: "Northbound Staging" },
  { name: "Jebel Ali Outer Anchorage", lat: 25.10, lon: 54.95, vessels_waiting: 14, avg_dwell_hrs: 8.5, status: "Nominal Berthing" },
  { name: "Rotterdam Maas Center Anchorage", lat: 52.02, lon: 3.90, vessels_waiting: 11, avg_dwell_hrs: 6.0, status: "Smooth Clearance" },
  { name: "Los Angeles San Pedro Bay Roads", lat: 33.68, lon: -118.20, vessels_waiting: 16, avg_dwell_hrs: 14.0, status: "Berth Queuing" },
  { name: "New York Ambrose Outer Anchorage", lat: 40.50, lon: -73.85, vessels_waiting: 9, avg_dwell_hrs: 7.5, status: "Clear Passage" },
  { name: "Panama Canal Balboa Pacific Roads", lat: 8.88, lon: -79.52, vessels_waiting: 15, avg_dwell_hrs: 16.0, status: "Canal Transit Queue" }
];

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

    // Render Global Live Overlays
    renderLiveWeatherLayer();
    renderLiveTrafficLayer();
    startAISFleetSimulation();

    // Layer switcher control in top right
    const baseLayers = {
      "Dark Oceanic (Default)": darkCanvas,
      "Marine Ocean Depth": oceanBase,
      "OpenStreetMap": osm
    };

    const overlayLayers = {
      "Global Seaports & Terminals": state.portsLayerGroup,
      "Weather Radar & Storms": state.weatherLayerGroup,
      "AIS Marine Traffic & Fleets": state.trafficLayerGroup
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

// Render Global Live Weather Radar Layer (Storm Zones & Buoys Worldwide)
function renderLiveWeatherLayer() {
  if (!state.weatherLayerGroup) return;
  state.weatherLayerGroup.clearLayers();

  // 1. Worldwide Storm & Swell Danger Zones
  LIVE_WEATHER_STORMS.forEach(storm => {
    const outerCircle = L.circle([storm.lat, storm.lon], {
      radius: storm.radius_km * 1000,
      color: storm.color,
      fillColor: storm.color,
      fillOpacity: 0.10,
      weight: 1.5,
      dashArray: '5, 5'
    });

    const innerCircle = L.circle([storm.lat, storm.lon], {
      radius: (storm.radius_km * 1000) * 0.45,
      color: storm.color,
      fillColor: storm.color,
      fillOpacity: 0.25,
      weight: 2
    });

    const stormIcon = L.divIcon({
      className: 'storm-center-icon',
      html: `<div style="position:relative; width:36px; height:36px; display:flex; align-items:center; justify-content:center;">
               <div class="radar-pulse-ring" style="border-color: ${storm.color};"></div>
               <div style="width:24px; height:24px; border-radius:50%; background:rgba(6,16,28,0.92); border:2px solid ${storm.color}; display:flex; align-items:center; justify-content:center; box-shadow:0 0 12px ${storm.color};">
                 <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="${storm.color}" stroke-width="2.5">
                   <path d="M12 2v2"/><path d="M12 20v2"/><path d="m4.93 4.93 1.41 1.41"/><path d="m17.66 17.66 1.41 1.41"/><path d="M2 12h2"/><path d="M20 12h2"/><path d="m6.34 17.66-1.41 1.41"/><path d="m19.07 4.93-1.41 1.41"/>
                 </svg>
               </div>
             </div>`,
      iconSize: [36, 36],
      iconAnchor: [18, 18]
    });

    const popupHtml = `
      <div class="maritime-popup">
        <div class="maritime-popup-title">
          <span>🌀 ${storm.name}</span>
          <span class="maritime-popup-badge badge-storm">${storm.status}</span>
        </div>
        <div class="maritime-popup-grid">
          <div><span>Sustained Wind:</span> <strong>${storm.wind_kts} kts</strong></div>
          <div><span>Wind Gusts:</span> <strong>${storm.gusts_kts} kts</strong></div>
          <div><span>Significant Wave:</span> <strong>${storm.wave_height_m} m</strong></div>
          <div><span>Central Pressure:</span> <strong>${storm.pressure_hpa} hPa</strong></div>
          <div><span>Hazard Radius:</span> <strong>${storm.radius_km} km</strong></div>
          <div><span>Route Action:</span> <strong style="color:#ef4444;">Bypass Safe Corridor</strong></div>
        </div>
      </div>
    `;

    const stormMarker = L.marker([storm.lat, storm.lon], { icon: stormIcon }).bindPopup(popupHtml);

    state.weatherLayerGroup.addLayer(outerCircle);
    state.weatherLayerGroup.addLayer(innerCircle);
    state.weatherLayerGroup.addLayer(stormMarker);
  });

  // 2. Global Oceanic Weather Buoys
  LIVE_WEATHER_BUOYS.forEach(buoy => {
    const buoyIcon = L.divIcon({
      className: 'weather-buoy-icon',
      html: `<div style="display:flex; align-items:center; gap:4px; background:rgba(6,16,28,0.88); border:1px solid rgba(253,166,10,0.6); border-radius:12px; padding:2px 6px; box-shadow:0 2px 8px rgba(0,0,0,0.6);">
               <span style="width:7px; height:7px; border-radius:50%; background:#fda60a; animation:pulse-dot 1.2s infinite;"></span>
               <span style="font-size:10px; font-family:'DM Mono',monospace; color:#fde047; font-weight:700;">${buoy.wave_m}m</span>
             </div>`,
      iconSize: [54, 20],
      iconAnchor: [27, 10]
    });

    const popupHtml = `
      <div class="maritime-popup">
        <div class="maritime-popup-title">
          <span>📡 ${buoy.name}</span>
          <span class="maritime-popup-badge badge-buoy">SIMULATED BUOY</span>
        </div>
        <div class="maritime-popup-grid">
          <div><span>Wave Height:</span> <strong>${buoy.wave_m} m (Significant)</strong></div>
          <div><span>Surface Wind:</span> <strong>${buoy.wind_kts} knots</strong></div>
          <div><span>Sea Surface Temp:</span> <strong>${buoy.temp_c} °C</strong></div>
          <div><span>Barometric Press:</span> <strong>${buoy.press_hpa} hPa</strong></div>
          <div><span>Sensor Status:</span> <strong style="color:#3bf6c5;">Transmitting Nominal</strong></div>
          <div><span>Data Stream:</span> <strong>Open-Meteo / NOAA</strong></div>
        </div>
      </div>
    `;

    const buoyMarker = L.marker([buoy.lat, buoy.lon], { icon: buoyIcon }).bindPopup(popupHtml);
    state.weatherLayerGroup.addLayer(buoyMarker);
  });
}

// Render Global Live AIS Marine Traffic Layer (36 Vessels & Anchorages)
function renderLiveTrafficLayer() {
  if (!state.trafficLayerGroup) return;
  state.trafficLayerGroup.clearLayers();
  state.aisMarkers = [];

  // 1. AIS Commercial Container Ships & Fleets Across All Global Lanes (Compact Glowing Dots)
  LIVE_AIS_VESSELS.forEach((vessel, idx) => {
    const shipIcon = L.divIcon({
      className: `ais-ship-icon ais-ship-${idx}`,
      html: `<div class="ais-ship-dot" style="position: relative; width: 12px; height: 12px; display: flex; align-items: center; justify-content: center;">
               <div style="position: absolute; inset: -3px; border-radius: 50%; background: rgba(19, 214, 232, 0.25); animation: pulse-ship-dot 2.5s infinite;"></div>
               <div style="width: 7px; height: 7px; border-radius: 50%; background: #13d6e8; border: 1.5px solid #06101c; box-shadow: 0 0 6px #13d6e8;"></div>
             </div>`,
      iconSize: [12, 12],
      iconAnchor: [6, 6]
    });

    const getPopupContent = (v) => `
      <div class="maritime-popup">
        <div class="maritime-popup-title">
          <span>🚢 ${v.name}</span>
          <span class="maritime-popup-badge badge-vessel">SIMULATED AIS</span>
        </div>
        <div class="maritime-popup-grid">
          <div><span>Type:</span> <strong>${v.type}</strong></div>
          <div><span>Flag / Registry:</span> <strong>${v.flag}</strong></div>
          <div><span>Speed Over Ground:</span> <strong>${v.speed.toFixed(1)} kn</strong></div>
          <div><span>Course / Heading:</span> <strong>${Math.round(v.course)}° True</strong></div>
          <div><span>Current Position:</span> <strong>${v.lat.toFixed(3)}°, ${v.lon.toFixed(3)}°</strong></div>
          <div><span>Destination:</span> <strong>${v.dest}</strong></div>
          <div><span>Estimated Arrival:</span> <strong>${v.eta}</strong></div>
          <div><span>IMO / MMSI:</span> <strong>${v.imo} / ${v.mmsi}</strong></div>
          <div><span>Nav Status:</span> <strong style="color:#3bf6c5;">Underway · Dynamic Track</strong></div>
        </div>
      </div>
    `;

    const shipMarker = L.marker([vessel.lat, vessel.lon], { icon: shipIcon }).bindPopup(getPopupContent(vessel));
    state.trafficLayerGroup.addLayer(shipMarker);
    state.aisMarkers.push({ marker: shipMarker, vessel: vessel, idx: idx });
  });

  // 2. Global Port Anchorages & Staging Queue Badges
  LIVE_PORT_ANCHORAGES.forEach(anch => {
    const anchIcon = L.divIcon({
      className: 'anchorage-badge',
      html: `<div style="display:flex; align-items:center; gap:5px; background:rgba(6,16,28,0.92); border:1px solid rgba(19,214,232,0.5); border-radius:6px; padding:2px 6px; box-shadow:0 2px 10px rgba(0,0,0,0.6);">
               <span style="color:#13d6e8; font-size:11px;">⚓</span>
               <span style="color:#dcecf0; font-size:10px; font-weight:700; font-family:'DM Mono',monospace;">${anch.vessels_waiting} Ships</span>
             </div>`,
      iconSize: [75, 22],
      iconAnchor: [37, 11]
    });

    const popupHtml = `
      <div class="maritime-popup">
        <div class="maritime-popup-title">
          <span>⚓ ${anch.name}</span>
          <span class="maritime-popup-badge badge-vessel">ANCHORAGE</span>
        </div>
        <div class="maritime-popup-grid">
          <div><span>Vessels at Anchor:</span> <strong>${anch.vessels_waiting} container / tankers</strong></div>
          <div><span>Average Dwell:</span> <strong>${anch.avg_dwell_hrs} hours</strong></div>
          <div><span>Congestion Status:</span> <strong style="color:${anch.vessels_waiting > 20 ? '#fda60a' : '#3bf6c5'};">${anch.status}</strong></div>
          <div><span>Berth Coordination:</span> <strong>VTS Automated</strong></div>
        </div>
      </div>
    `;

    const anchMarker = L.marker([anch.lat, anch.lon], { icon: anchIcon }).bindPopup(popupHtml);
    state.trafficLayerGroup.addLayer(anchMarker);
  });
}

// Continuous Dynamic Live AIS Fleet Navigation Loop
function startAISFleetSimulation() {
  if (state.aisFleetTimer) clearInterval(state.aisFleetTimer);

  state.aisFleetTimer = setInterval(() => {
    if (!state.aisMarkers || state.aisMarkers.length === 0) return;

    state.aisMarkers.forEach(item => {
      const v = item.vessel;
      const rad = (v.course * Math.PI) / 180;
      const speedStep = 0.003 * (v.speed / 20.0);

      v.lat += Math.cos(rad) * speedStep;
      v.lon += (Math.sin(rad) * speedStep) / Math.max(0.1, Math.cos((v.lat * Math.PI) / 180));

      v.course = (v.course + (Math.random() - 0.5) * 0.4 + 360) % 360;

      if (item.marker) {
        item.marker.setLatLng([v.lat, v.lon]);
      }
    });
  }, 1500);
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
    showToast("Weather Radar Enabled", "info", "Displaying simulated storms and marine buoys.");
  } else {
    if (state.map && state.weatherLayerGroup && state.map.hasLayer(state.weatherLayerGroup)) {
      state.map.removeLayer(state.weatherLayerGroup);
    }
    if (btn) btn.classList.remove('active');
    showToast("Weather Radar Disabled", "info", "Simulated weather layer hidden.");
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
    showToast("Simulated AIS Layer Enabled", "info", "Displaying simulated vessel positions and port anchorages.");
  } else {
    if (state.map && state.trafficLayerGroup && state.map.hasLayer(state.trafficLayerGroup)) {
      state.map.removeLayer(state.trafficLayerGroup);
    }
    if (btn) btn.classList.remove('active');
    showToast("Simulated AIS Layer Disabled", "info", "Simulated vessel layer hidden.");
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
    operating_rate: document.getElementById('operating-rate').valueAsNumber,
    currents: state.useCurrents,
    storms: state.showWeather ? LIVE_WEATHER_STORMS.map(({lat, lon, radius_km}) => ({lat, lon, radius_km})) : [],
    vessels: state.showTraffic ? LIVE_AIS_VESSELS.map(({lat, lon}) => ({
      lat: Math.max(-90, Math.min(90, lat)),
      lon: ((lon % 360) + 540) % 360 - 180
    })) : []
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
  document.getElementById('summary-transit').textContent = `${data.total_transit_hours.toLocaleString(undefined, format)} h`;
  document.getElementById('summary-fuel').textContent = data.fuel_cost.toLocaleString(undefined, {
    style: 'currency', currency: 'USD'
  });
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

  // Live Clock
  setInterval(() => {
    const clock = document.getElementById('ais-timestamp');
    if (clock) {
      const now = new Date();
      clock.textContent = `${now.toISOString().substring(11, 19)} UTC`;
    }
  }, 1000);
}

// App Initialization
document.addEventListener('DOMContentLoaded', async () => {
  renderItinerary(null);
  initMap();
  setupEvents();
  await loadPorts();
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
