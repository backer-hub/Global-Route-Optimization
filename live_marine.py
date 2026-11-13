"""Cached marine forecasts and a server-side AIS subscription."""

import json
import math
import os
import random
import threading
import time
from datetime import datetime, timezone
from urllib.parse import urlencode
from urllib.request import urlopen


# Offshore sample points near major shipping corridors.
SAMPLES = [
    ("East China Sea", 30.8, 123.2), ("Taiwan Strait", 24.3, 119.6),
    ("South China Sea", 12.0, 112.0), ("Singapore Strait", 1.18, 104.1),
    ("Malacca Strait", 4.2, 99.5), ("Bay of Bengal", 8.5, 87.0),
    ("Off Sri Lanka", 5.4, 80.5), ("Arabian Sea", 15.0, 66.0),
    ("Gulf of Aden", 12.3, 47.0), ("Southern Red Sea", 16.0, 41.0),
    ("Central Red Sea", 21.4, 38.4), ("Northern Red Sea", 26.0, 35.6),
    ("Eastern Mediterranean", 33.0, 31.0), ("South of Crete", 34.7, 24.0),
    ("Strait of Sicily", 36.4, 12.0), ("Western Mediterranean", 37.0, 2.0),
    ("Off Gibraltar", 35.9, -6.2), ("Bay of Biscay", 46.0, -6.0),
    ("English Channel", 50.0, -2.0), ("Southern North Sea", 52.1, 3.3),
    ("Cape of Good Hope", -35.1, 18.3), ("Off Los Angeles", 33.3, -118.5),
    ("Off New York", 40.2, -73.6), ("Panama Pacific Approach", 8.4, -79.5),
]
# Also sample exposed ocean crossings beyond the coastal shipping corridors.
OPEN_OCEAN_SAMPLES = [
    ("North Atlantic", 52, -35), ("South of Iceland", 60, -25),
    ("Labrador Sea", 57, -52), ("North Pacific", 48, -160),
    ("Gulf of Alaska", 54, -145), ("East of Japan", 38, 150),
    ("South of Tasmania", -47, 147), ("South of New Zealand", -49, 169),
    ("Southern Indian Ocean", -46, 78), ("South Atlantic", -44, -20),
    ("Drake Passage", -58, -65), ("South Pacific", -49, -110),
]
WEATHER_REFRESH = 600
WEATHER_MAX_AGE = 1800
AIS_MAX_AGE = 900
AIS_LIMIT = 100
AIS_PORTS = [
    (31.24, 121.48), (29.93, 32.56), (51.99, 4.08), (51.50, 0.49),
    (25.01, 55.06), (37.94, 23.62), (44.40, 8.90),
]


def _current_weather(url, variables, **options):
    samples = SAMPLES + OPEN_OCEAN_SAMPLES
    query = urlencode({
        "latitude": ",".join(str(lat) for _, lat, _ in samples),
        "longitude": ",".join(str(lon) for _, _, lon in samples),
        "current": variables,
        **options,
    })
    with urlopen(f"{url}?{query}", timeout=8) as response:
        rows = json.load(response)
    if not isinstance(rows, list) or len(rows) != len(samples):
        raise ValueError("Unexpected Open-Meteo response")
    return [row["current"] for row in rows]


def fetch_weather():
    waves = _current_weather("https://marine-api.open-meteo.com/v1/marine", "wave_height")
    winds = _current_weather("https://api.open-meteo.com/v1/forecast", "wind_speed_10m",
                             wind_speed_unit="kn")
    samples = []
    for (name, lat, lon), wave, wind in zip(SAMPLES + OPEN_OCEAN_SAMPLES, waves, winds):
        height, speed = wave.get("wave_height"), wind.get("wind_speed_10m")
        if height is None and speed is None:
            continue
        samples.append({
            "name": name, "lat": lat, "lon": lon, "wave_height_m": height,
            "wind_kts": speed, "valid_at": wave.get("time") or wind.get("time"),
            # Local modeled routing penalty for rough conditions at a sample.
            "radius_km": 60 if (height or 0) >= 4 or (speed or 0) >= 34 else 0,
        })
    if not samples:
        raise ValueError("No Open-Meteo samples available")
    return samples


class MarineFeeds:
    def __init__(self):
        self.lock = threading.Lock()
        self.weather = []
        self.weather_time = 0
        self.weather_status = "loading"
        self.vessels = {}
        self.ais_status = "not_configured"
        self.started = False

    def snapshot(self):
        with self.lock:
            if not self.started:
                self.started = True
                threading.Thread(target=self._weather_loop, daemon=True).start()
                key = os.environ.get("AISSTREAM_API_KEY", "").strip()
                if key:
                    self.ais_status = "connecting"
                    threading.Thread(target=self._ais_loop, args=(key,), daemon=True).start()
            now = time.time()
            fresh = self.weather_time and now - self.weather_time < WEATHER_MAX_AGE
            vessels = self._recent_vessels(now)
            return {
                "weather": {
                    "status": self.weather_status if fresh or not self.weather_time else "unavailable",
                    "samples": self.weather if fresh else [],
                    "updated_at": datetime.fromtimestamp(self.weather_time, timezone.utc).isoformat()
                    if self.weather_time else None,
                },
                "traffic": {"status": self.ais_status, "vessels": vessels},
            }

    def _recent_vessels(self, now):
        self.vessels = {mmsi: vessel for mmsi, vessel in self.vessels.items()
                        if now - vessel["received_at"] < AIS_MAX_AGE}
        # Round-robin across geographic cells so one busy port cannot fill the map.
        by_cell = {}
        for vessel in sorted(self.vessels.values(), key=lambda v: v["received_at"], reverse=True):
            cell = (math.floor(vessel["lat"]), math.floor(vessel["lon"]))
            by_cell.setdefault(cell, []).append(vessel)
        selected = []
        for index in range(AIS_LIMIT):
            selected.extend(group[index] for group in by_cell.values() if index < len(group))
            if len(selected) >= AIS_LIMIT or not any(len(group) > index + 1 for group in by_cell.values()):
                break
        return selected[:AIS_LIMIT]

    def _weather_loop(self):
        while True:
            try:
                samples = fetch_weather()
            except (OSError, ValueError, KeyError, TypeError):
                with self.lock:
                    self.weather_status = "stale" if self.weather_time else "unavailable"
                time.sleep(60)
                continue
            with self.lock:
                self.weather = samples
                self.weather_time = time.time()
                self.weather_status = "live"
            time.sleep(WEATHER_REFRESH)

    def _ais_loop(self, key):
        try:
            from websockets.sync.client import connect
            from websockets.exceptions import WebSocketException
        except ImportError:
            with self.lock:
                self.ais_status = "dependency_missing"
            return
        points = [(lat, lon) for _, lat, lon in SAMPLES] + AIS_PORTS
        boxes = [[[lat - 1, lon - 1], [lat + 1, lon + 1]] for lat, lon in points]
        retry_delay = 5
        while True:
            try:
                with connect("wss://stream.aisstream.io/v0/stream", open_timeout=10) as socket:
                    socket.send(json.dumps({"APIKey": key, "BoundingBoxes": boxes,
                                            "FilterMessageTypes": ["PositionReport"]}))
                    while True:
                        message = json.loads(socket.recv(timeout=90))
                        if message.get("error"):
                            raise ValueError("AISStream rejected the subscription")
                        self._record_vessel(message)
                        retry_delay = 5
            except (OSError, ValueError, WebSocketException):
                with self.lock:
                    self.ais_status = "unavailable"
                time.sleep(retry_delay + random.uniform(0, 2))
                retry_delay = min(retry_delay * 2, 120)

    def _record_vessel(self, message):
        report = message.get("Message", {}).get("PositionReport")
        if not isinstance(report, dict) or report.get("Valid") is False:
            return
        lat, lon = report.get("Latitude"), report.get("Longitude")
        mmsi = report.get("UserID")
        if not isinstance(mmsi, int) or not isinstance(lat, (int, float)) or not isinstance(lon, (int, float)):
            return
        if not (-90 <= lat <= 90 and -180 <= lon <= 180):
            return
        now = time.time()
        speed = report.get("Sog")
        with self.lock:
            self.ais_status = "live"
            self.vessels[mmsi] = {
                "mmsi": mmsi, "lat": lat, "lon": lon,
                "speed_kts": speed if isinstance(speed, (int, float)) and 0 <= speed < 102.3 else None,
                "anchored": report.get("NavigationalStatus") == 1,
                "received_at": now,
            }
            if len(self.vessels) > 10000:
                self.vessels.pop(next(iter(self.vessels)))


feeds = MarineFeeds()
