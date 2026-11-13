#include "astar.hpp"
#include <queue>
#include <vector>
#include <cmath>
#include <algorithm>
#include <limits>
#include <chrono>

namespace RouteOptimizer {

static constexpr double PI = 3.14159265358979323846;
static constexpr double EARTH_RADIUS_KM = 6371.0;

AStarOptimizer::AStarOptimizer(
    const MultimodalGraph& graph,
    double fuel_rate_sea,
    double fuel_rate_road,
    double vessel_speed_kmh,
    double time_cost_per_hour,
    double mode_switch_penalty
) : graph_(graph),
    fuel_rate_sea_(fuel_rate_sea),
    fuel_rate_road_(fuel_rate_road),
    time_cost_per_hour_(time_cost_per_hour),
    mode_switch_penalty_(mode_switch_penalty),
    cost_per_geodesic_km_(std::min(fuel_rate_sea, fuel_rate_road) +
                         time_cost_per_hour / (vessel_speed_kmh > 0.0 ? vessel_speed_kmh : 37.0)) {
    // Bound the heuristic using actual edge weights, including rounded distances.
    for (const auto& edge : graph_.getAllEdges()) {
        const auto* from = graph_.getNode(edge.source_id);
        const auto* to = graph_.getNode(edge.dest_id);
        double distance = haversineDistance(from->lat, from->lon, to->lat, to->lon);
        if (distance > 0) {
            double rate = edge.mode == TransportMode::SEA ? fuel_rate_sea_ : fuel_rate_road_;
            double cost = edge.distance_km * rate + time_cost_per_hour_ * edge.base_transit_hours;
            cost_per_geodesic_km_ = std::min(cost_per_geodesic_km_, cost / distance);
        }
    }
}

double AStarOptimizer::haversineDistance(double lat1, double lon1, double lat2, double lon2) {
    double phi1 = lat1 * PI / 180.0;
    double phi2 = lat2 * PI / 180.0;
    double dphi = (lat2 - lat1) * PI / 180.0;
    double dlambda = (lon2 - lon1) * PI / 180.0;

    double a = std::sin(dphi / 2.0) * std::sin(dphi / 2.0) +
               std::cos(phi1) * std::cos(phi2) *
               std::sin(dlambda / 2.0) * std::sin(dlambda / 2.0);
    a = std::clamp(a, 0.0, 1.0);
    double c = 2.0 * std::atan2(std::sqrt(a), std::sqrt(1.0 - a));
    return EARTH_RADIUS_KM * c;
}

double AStarOptimizer::heuristic(int current_id, int target_id) const {
    const Node* u = graph_.getNode(current_id);
    const Node* v = graph_.getNode(target_id);
    if (!u || !v) return 0.0;

    return haversineDistance(u->lat, u->lon, v->lat, v->lon) * cost_per_geodesic_km_;
}

AStarResult AStarOptimizer::findOptimalRoute(int origin_id, int dest_id) const {
    auto start_time = std::chrono::high_resolution_clock::now();
    AStarResult result;

    if (!graph_.hasNode(origin_id) || !graph_.hasNode(dest_id)) {
        result.is_valid = false;
        result.total_cost = std::numeric_limits<double>::infinity();
        return result;
    }

    if (origin_id == dest_id) {
        result.is_valid = true;
        result.path = {origin_id};
        result.total_cost = 0.0;
        return result;
    }

    size_t n = graph_.nodeCount();
    // Each arrival mode has its own cost because it affects the next edge.
    constexpr int mode_count = 3;
    const int start = origin_id * mode_count + static_cast<int>(TransportMode::UNKNOWN);
    std::vector<double> g_score(n * mode_count, std::numeric_limits<double>::infinity());
    std::vector<int> came_from(n * mode_count, -1);
    std::vector<const Edge*> incoming_edge(n * mode_count, nullptr);
    std::vector<bool> closed(n * mode_count, false);

    // Min-heap priority queue storing pairs of (f_score, node_id)
    typedef std::pair<double, int> PQElement;
    std::priority_queue<PQElement, std::vector<PQElement>, std::greater<PQElement>> open_set;

    g_score[start] = 0.0;
    double initial_f = heuristic(origin_id, dest_id);
    open_set.push({initial_f, start});

    size_t explored = 0;
    int goal = -1;

    while (!open_set.empty()) {
        auto [current_f, current_state] = open_set.top();
        open_set.pop();

        const int current_u = current_state / mode_count;
        if (current_u == dest_id) {
            goal = current_state;
            break;
        }

        if (closed[current_state]) continue;
        closed[current_state] = true;
        explored++;

        const auto& edges = graph_.getOutgoingEdges(current_u);
        const auto previous_mode = static_cast<TransportMode>(current_state % mode_count);
        for (const auto& edge : edges) {
            int v = edge.dest_id;
            if (v < 0 || static_cast<size_t>(v) >= n) continue;
            const int next = v * mode_count + static_cast<int>(edge.mode);
            if (closed[next]) continue;

            const Node* dest_node = graph_.getNode(v);
            double delay = dest_node ? dest_node->congestion_delay : 0.0;
            double fuel_rate = (edge.mode == TransportMode::SEA) ? fuel_rate_sea_ : fuel_rate_road_;
            double edge_fuel_cost = edge.distance_km * fuel_rate;
            double edge_cost = edge_fuel_cost + time_cost_per_hour_ * (edge.base_transit_hours + delay);

            if (previous_mode != TransportMode::UNKNOWN && previous_mode != edge.mode) {
                edge_cost += mode_switch_penalty_;
            }
            double tentative_g = g_score[current_state] + edge_cost;

            if (tentative_g < g_score[next]) {
                came_from[next] = current_state;
                incoming_edge[next] = &edge;
                g_score[next] = tentative_g;
                double f = tentative_g + heuristic(v, dest_id);
                open_set.push({f, next});
            }
        }
    }

    auto end_time = std::chrono::high_resolution_clock::now();
    result.execution_time_ms = std::chrono::duration<double, std::milli>(end_time - start_time).count();
    result.nodes_explored = explored;

    if (goal < 0) {
        result.is_valid = false;
        result.total_cost = std::numeric_limits<double>::infinity();
        return result;
    }

    result.total_cost = g_score[goal];
    result.path.push_back(dest_id);
    for (int state = goal; state != start; state = came_from[state]) {
        const Edge& edge = *incoming_edge[state];
        const auto* destination = graph_.getNode(edge.dest_id);
        const double rate = edge.mode == TransportMode::SEA ? fuel_rate_sea_ : fuel_rate_road_;
        result.path.push_back(edge.source_id);
        result.total_distance_km += edge.distance_km;
        result.total_transit_hours += edge.base_transit_hours + destination->congestion_delay;
        result.fuel_cost += edge.distance_km * rate;
        if (result.first_mode != TransportMode::UNKNOWN && result.first_mode != edge.mode) {
            ++result.mode_switches;
        }
        result.first_mode = edge.mode;
    }
    result.last_mode = incoming_edge[goal]->mode;
    std::reverse(result.path.begin(), result.path.end());

    result.is_valid = true;
    return result;
}

} // namespace RouteOptimizer
