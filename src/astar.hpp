#pragma once

#include "graph.hpp"
#include <vector>
#include <string>
#include <chrono>

namespace RouteOptimizer {

/**
 * @brief Result of deterministic A* optimal route search
 */
struct AStarResult {
    bool is_valid = false;
    double total_cost = 0.0;
    double total_distance_km = 0.0;
    double total_transit_hours = 0.0;
    double fuel_cost = 0.0;
    int mode_switches = 0;
    std::vector<int> path;
    double execution_time_ms = 0.0;
    size_t nodes_explored = 0;
    std::string algorithm = "A* (Deterministic)";
};

/**
 * @brief Deterministic A* Shortest/Least-Cost Pathfinding Engine
 * 
 * Uses spatial Great-Circle Haversine heuristics between geographical coordinates
 * (lat/lon) to guarantee mathematical optimality and sub-millisecond execution
 * for standard point-A to point-B routing requests.
 */
class AStarOptimizer {
public:
    explicit AStarOptimizer(
        const MultimodalGraph& graph,
        double fuel_rate_sea = 0.6,
        double fuel_rate_road = 1.4,
        double vessel_speed_kmh = 37.0
    );

    /**
     * @brief Find mathematically optimal least-cost path from origin to destination
     * @param origin_id Starting node ID
     * @param dest_id Target node ID
     * @return AStarResult containing optimal path and telemetry
     */
    AStarResult findOptimalRoute(int origin_id, int dest_id) const;

    /**
     * @brief Calculate Great Circle Haversine physical distance between two geographical points in km
     */
    static double haversineDistance(double lat1, double lon1, double lat2, double lon2);

private:
    const MultimodalGraph& graph_;
    double fuel_rate_sea_;
    double fuel_rate_road_;
    double cost_per_geodesic_km_;

    /**
     * @brief Admissible heuristic estimating lower bound of remaining cost to target
     */
    double heuristic(int current_id, int target_id) const;
};

} // namespace RouteOptimizer
