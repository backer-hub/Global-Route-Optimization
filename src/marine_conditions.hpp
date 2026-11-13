#pragma once

#include <vector>

namespace RouteOptimizer {

struct MarineZone {
    double lat, lon, radius_km;
    double delay_hours_per_km;
    double east_kmh, north_kmh;
};

struct MarineLane {
    double lat, lon, east_km, north_km;
    double distance_km, transit_hours;
};

// The same lane model runs on the CPU and CUDA device.
std::vector<double> marineLaneTimes(const std::vector<MarineLane>& lanes,
                                    const std::vector<MarineZone>& zones, bool gpu);

}
