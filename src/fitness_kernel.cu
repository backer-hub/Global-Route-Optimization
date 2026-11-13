#include "fitness_kernel.hpp"
#include "ga.hpp"
#include "marine_conditions.hpp"

#include <iostream>
#include <iomanip>
#include <vector>
#include <chrono>
#include <cstring>
#include <cstdlib>
#include <cmath>
#include <algorithm>

#ifdef _OPENMP
#include <omp.h>
#endif

#ifdef USE_CUDA
#include <cuda_runtime.h>
#include <device_launch_parameters.h>

#define CUDA_CHECK(call) \
    do { \
        cudaError_t err = call; \
        if (err != cudaSuccess) { \
            std::cerr << "\n[CUDA Error] " << cudaGetErrorString(err) \
                      << " (code: " << err << ") at " << __FILE__ << ":" << __LINE__ << std::endl; \
            std::exit(EXIT_FAILURE); \
        } \
    } while (0)

namespace RouteOptimizer {

// =============================================================================
// CUDA Massively Parallel Fitness Evaluation Kernel for Graph Paths
// =============================================================================
__global__ void computeRouteCostsKernel(
    const int* __restrict__ d_flat_nodes,
    const int* __restrict__ d_offsets,
    const int* __restrict__ d_lengths,
    int population_size,
    const int* __restrict__ d_edge_offsets,
    const int* __restrict__ d_edge_dest_ids,
    const double* __restrict__ d_edge_distances_km,
    const double* __restrict__ d_edge_transit_hours,
    const int* __restrict__ d_edge_modes,
    const double* __restrict__ d_congestion_delays,
    int node_count,
    double fuel_rate_sea,
    double fuel_rate_road,
    double mode_switch_penalty,
    double* __restrict__ d_out_costs,
    double* __restrict__ d_out_distances,
    double* __restrict__ d_out_transit_hours,
    double* __restrict__ d_out_fuel_costs,
    double* __restrict__ d_out_switch_penalties,
    int* __restrict__ d_out_sea_legs,
    int* __restrict__ d_out_road_legs,
    int* __restrict__ d_out_mode_switches,
    int* __restrict__ d_out_is_valid
) {
    int route_idx = blockDim.x * blockIdx.x + threadIdx.x;
    if (route_idx >= population_size) return;

    int offset = d_offsets[route_idx];
    int length = d_lengths[route_idx];

    if (length < 2) {
        d_out_costs[route_idx] = 1e18;
        d_out_distances[route_idx] = 0.0;
        d_out_transit_hours[route_idx] = 0.0;
        d_out_fuel_costs[route_idx] = 0.0;
        d_out_switch_penalties[route_idx] = 0.0;
        d_out_sea_legs[route_idx] = 0;
        d_out_road_legs[route_idx] = 0;
        d_out_mode_switches[route_idx] = 0;
        d_out_is_valid[route_idx] = 0;
        return;
    }

    double total_cost = 0.0;
    double total_dist = 0.0;
    double total_transit = 0.0;
    double total_fuel = 0.0;
    double total_penalties = 0.0;
    int sea_legs = 0;
    int road_legs = 0;
    int mode_switches = 0;
    int is_valid = 1;

    int prev_mode = -1;

    for (int hop = 0; hop < length - 1; ++hop) {
        int u = d_flat_nodes[offset + hop];
        int v = d_flat_nodes[offset + hop + 1];

        if (u < 0 || u >= node_count || v < 0 || v >= node_count) {
            is_valid = 0;
            total_cost = 1e18;
            break;
        }

        int edge_start = d_edge_offsets[u];
        int edge_end = d_edge_offsets[u + 1];
        int found_edge_idx = -1;

        for (int e = edge_start; e < edge_end; ++e) {
            if (d_edge_dest_ids[e] == v) {
                found_edge_idx = e;
                break;
            }
        }

        if (found_edge_idx < 0) {
            is_valid = 0;
            total_cost = 1e18;
            break;
        }

        double dist_km = d_edge_distances_km[found_edge_idx];
        double transit_hrs = d_edge_transit_hours[found_edge_idx];
        int mode = d_edge_modes[found_edge_idx];
        double congestion = d_congestion_delays[v];

        double fuel_rate = (mode == 0) ? fuel_rate_sea : fuel_rate_road;
        double edge_fuel = dist_km * fuel_rate;
        double edge_cost = edge_fuel + transit_hrs + congestion;

        total_dist += dist_km;
        total_transit += (transit_hrs + congestion);
        total_fuel += edge_fuel;
        total_cost += edge_cost;

        if (mode == 0) {
            sea_legs++;
        } else {
            road_legs++;
        }

        if (hop > 0 && prev_mode != -1 && mode != prev_mode) {
            total_cost += mode_switch_penalty;
            total_penalties += mode_switch_penalty;
            mode_switches++;
        }

        prev_mode = mode;
    }

    d_out_costs[route_idx] = total_cost;
    d_out_distances[route_idx] = total_dist;
    d_out_transit_hours[route_idx] = total_transit;
    d_out_fuel_costs[route_idx] = total_fuel;
    d_out_switch_penalties[route_idx] = total_penalties;
    d_out_sea_legs[route_idx] = sea_legs;
    d_out_road_legs[route_idx] = road_legs;
    d_out_mode_switches[route_idx] = mode_switches;
    d_out_is_valid[route_idx] = is_valid;
}

// =============================================================================
// CUDA Massively Parallel Permutation TSP Fitness Evaluation Kernel
// Requirement 3: Look up pre-calculated travel costs directly from cached matrix
// with zero inline Haversine calculations on the GPU.
// =============================================================================
__global__ void computePermutationFitnessKernel(
    const int* __restrict__ d_flat_permutations,
    int population_size,
    int permutation_len,
    int matrix_width,
    const double* __restrict__ d_cost_matrix,
    const double* __restrict__ d_dist_matrix,
    const double* __restrict__ d_transit_matrix,
    double* __restrict__ d_out_costs,
    double* __restrict__ d_out_distances,
    double* __restrict__ d_out_transit_hours
) {
    int idx = blockDim.x * blockIdx.x + threadIdx.x;
    if (idx >= population_size) return;

    int offset = idx * permutation_len;
    double total_cost = 0.0;
    double total_dist = 0.0;
    double total_transit = 0.0;

    for (int k = 0; k < permutation_len - 1; ++k) {
        int u_idx = d_flat_permutations[offset + k];
        int v_idx = d_flat_permutations[offset + k + 1];

        if (u_idx >= 0 && v_idx >= 0) {
            size_t mat_pos = static_cast<size_t>(u_idx) * matrix_width + v_idx;
            total_cost += d_cost_matrix[mat_pos];
            if (d_dist_matrix) {
                total_dist += d_dist_matrix[mat_pos];
            }
            if (d_transit_matrix) {
                total_transit += d_transit_matrix[mat_pos];
            }
        } else {
            total_cost += 1e18;
        }
    }

    d_out_costs[idx] = total_cost;
    if (d_out_distances) {
        d_out_distances[idx] = total_dist;
    }
    if (d_out_transit_hours) {
        d_out_transit_hours[idx] = total_transit;
    }
}

} // namespace RouteOptimizer
#endif

namespace RouteOptimizer {
namespace {

#ifdef USE_CUDA
__host__ __device__
#endif
double adjustedLaneTime(const MarineLane& lane, const MarineZone* zones, int count) {
    if (lane.distance_km <= 0 || lane.transit_hours <= 0) return lane.transit_hours;
    const double direction_length = hypot(lane.east_km, lane.north_km);
    if (direction_length == 0) return lane.transit_hours;
    const double base_speed = lane.distance_km / lane.transit_hours;
    const double longitude_scale = 111.195 * cos(lane.lat * 0.017453292519943295);
    double drift = 0;
    double delay = 0;
    for (int i = 0; i < count; ++i) {
        const MarineZone& zone = zones[i];
        const double east = remainder(zone.lon - lane.lon, 360.0) * longitude_scale;
        const double north = (zone.lat - lane.lat) * 111.195;
        // Intersect the lane segment with the zone, including crossings between waypoints.
        const double along = (east * lane.east_km + north * lane.north_km) / direction_length;
        const double across = (east * lane.north_km - north * lane.east_km) / direction_length;
        if (fabs(across) >= zone.radius_km) continue;
        const double half = direction_length / 2;
        const double chord = sqrt(zone.radius_km * zone.radius_km - across * across);
        const double overlap = fmin(half, along + chord) - fmax(-half, along - chord);
        if (overlap <= 0) continue;
        const double fraction = overlap / direction_length;
        drift += fraction * (zone.east_kmh * lane.east_km + zone.north_kmh * lane.north_km) / direction_length;
        delay += fraction * lane.distance_km * zone.delay_hours_per_km;
    }
    const double speed = base_speed + fmin(0.2 * base_speed, fmax(-0.2 * base_speed, drift));
    return lane.distance_km / speed + delay;
}

#ifdef USE_CUDA
__global__ void marineLaneKernel(const MarineLane* lanes, int count, const MarineZone* zones,
                                 int zone_count, double* times) {
    int i = blockIdx.x * blockDim.x + threadIdx.x;
    if (i < count) times[i] = adjustedLaneTime(lanes[i], zones, zone_count);
}
#endif

}

std::vector<double> marineLaneTimes(const std::vector<MarineLane>& lanes,
                                    const std::vector<MarineZone>& zones, bool gpu) {
    std::vector<double> times(lanes.size());
    if (lanes.empty() || zones.empty()) return times;
    const int count = static_cast<int>(lanes.size());
    const int zone_count = static_cast<int>(zones.size());
#ifdef USE_CUDA
    if (gpu) {
        MarineLane* device_lanes = nullptr;
        MarineZone* device_zones = nullptr;
        double* device_times = nullptr;
        const size_t lane_bytes = lanes.size() * sizeof(MarineLane);
        const size_t zone_bytes = zones.size() * sizeof(MarineZone);
        const size_t time_bytes = times.size() * sizeof(double);
        CUDA_CHECK(cudaMalloc(&device_lanes, lane_bytes));
        CUDA_CHECK(cudaMalloc(&device_zones, zone_bytes));
        CUDA_CHECK(cudaMalloc(&device_times, time_bytes));
        CUDA_CHECK(cudaMemcpy(device_lanes, lanes.data(), lane_bytes, cudaMemcpyHostToDevice));
        CUDA_CHECK(cudaMemcpy(device_zones, zones.data(), zone_bytes, cudaMemcpyHostToDevice));
        marineLaneKernel<<<(count + 255) / 256, 256>>>(device_lanes, count, device_zones, zone_count, device_times);
        CUDA_CHECK(cudaGetLastError());
        CUDA_CHECK(cudaMemcpy(times.data(), device_times, time_bytes, cudaMemcpyDeviceToHost));
        CUDA_CHECK(cudaFree(device_times));
        CUDA_CHECK(cudaFree(device_zones));
        CUDA_CHECK(cudaFree(device_lanes));
        return times;
    }
#else
    (void)gpu;
#endif
    #pragma omp parallel for
    for (int i = 0; i < count; ++i) times[i] = adjustedLaneTime(lanes[i], zones.data(), zone_count);
    return times;
}

}

namespace RouteOptimizer {

CUDAFitnessEvaluator::CUDAFitnessEvaluator() = default;

bool CUDAFitnessEvaluator::hasDevice() {
#ifdef USE_CUDA
    int device_count = 0;
    return cudaGetDeviceCount(&device_count) == cudaSuccess && device_count > 0;
#else
    return false;
#endif
}

CUDAFitnessEvaluator::~CUDAFitnessEvaluator() {
    freeGraphMemory();
}

void CUDAFitnessEvaluator::freeGraphMemory() {
#ifdef USE_CUDA
    if (device_graph_.is_allocated) {
        cudaFree(device_graph_.d_edge_offsets);
        cudaFree(device_graph_.d_edge_dest_ids);
        cudaFree(device_graph_.d_edge_distances_km);
        cudaFree(device_graph_.d_edge_transit_hours);
        cudaFree(device_graph_.d_edge_modes);
        cudaFree(device_graph_.d_congestion_delays);
        device_graph_.is_allocated = false;
        is_gpu_ready_ = false;
    }
#endif
}

bool CUDAFitnessEvaluator::initGraph(const MultimodalGraph& graph) {
    host_graph_.node_count = static_cast<int>(graph.nodeCount());
    host_graph_.edge_count = static_cast<int>(graph.edgeCount());

    host_graph_.edge_offsets.resize(host_graph_.node_count + 1, 0);
    host_graph_.edge_dest_ids.reserve(host_graph_.edge_count);
    host_graph_.edge_distances_km.reserve(host_graph_.edge_count);
    host_graph_.edge_transit_hours.reserve(host_graph_.edge_count);
    host_graph_.edge_modes.reserve(host_graph_.edge_count);
    host_graph_.congestion_delays.resize(host_graph_.node_count, 0.0);

    int current_offset = 0;
    for (int u = 0; u < host_graph_.node_count; ++u) {
        host_graph_.edge_offsets[u] = current_offset;
        const Node* node = graph.getNode(u);
        host_graph_.congestion_delays[u] = node ? node->congestion_delay : 0.0;

        const auto& outgoing = graph.getOutgoingEdges(u);
        for (const auto& edge : outgoing) {
            host_graph_.edge_dest_ids.push_back(edge.dest_id);
            host_graph_.edge_distances_km.push_back(edge.distance_km);
            host_graph_.edge_transit_hours.push_back(edge.base_transit_hours);
            host_graph_.edge_modes.push_back(edge.mode == TransportMode::SEA ? 0 : 1);
            current_offset++;
        }
    }
    host_graph_.edge_offsets[host_graph_.node_count] = current_offset;

#ifdef USE_CUDA
    int device_count = 0;
    cudaGetDeviceCount(&device_count);
    if (device_count == 0) {
        is_gpu_ready_ = false;
        return false;
    }

    CUDA_CHECK(cudaMalloc(&device_graph_.d_edge_offsets, (host_graph_.node_count + 1) * sizeof(int)));
    CUDA_CHECK(cudaMalloc(&device_graph_.d_edge_dest_ids, host_graph_.edge_count * sizeof(int)));
    CUDA_CHECK(cudaMalloc(&device_graph_.d_edge_distances_km, host_graph_.edge_count * sizeof(double)));
    CUDA_CHECK(cudaMalloc(&device_graph_.d_edge_transit_hours, host_graph_.edge_count * sizeof(double)));
    CUDA_CHECK(cudaMalloc(&device_graph_.d_edge_modes, host_graph_.edge_count * sizeof(int)));
    CUDA_CHECK(cudaMalloc(&device_graph_.d_congestion_delays, host_graph_.node_count * sizeof(double)));

    CUDA_CHECK(cudaMemcpy(device_graph_.d_edge_offsets, host_graph_.edge_offsets.data(), (host_graph_.node_count + 1) * sizeof(int), cudaMemcpyHostToDevice));
    CUDA_CHECK(cudaMemcpy(device_graph_.d_edge_dest_ids, host_graph_.edge_dest_ids.data(), host_graph_.edge_count * sizeof(int), cudaMemcpyHostToDevice));
    CUDA_CHECK(cudaMemcpy(device_graph_.d_edge_distances_km, host_graph_.edge_distances_km.data(), host_graph_.edge_count * sizeof(double), cudaMemcpyHostToDevice));
    CUDA_CHECK(cudaMemcpy(device_graph_.d_edge_transit_hours, host_graph_.edge_transit_hours.data(), host_graph_.edge_count * sizeof(double), cudaMemcpyHostToDevice));
    CUDA_CHECK(cudaMemcpy(device_graph_.d_edge_modes, host_graph_.edge_modes.data(), host_graph_.edge_count * sizeof(int), cudaMemcpyHostToDevice));
    CUDA_CHECK(cudaMemcpy(device_graph_.d_congestion_delays, host_graph_.congestion_delays.data(), host_graph_.node_count * sizeof(double), cudaMemcpyHostToDevice));

    device_graph_.is_allocated = true;
    is_gpu_ready_ = true;
#else
    is_gpu_ready_ = false;
#endif
    return true;
}

void CUDAFitnessEvaluator::updateCongestionDelays(const std::vector<double>& delays) {
    host_graph_.congestion_delays = delays;
#ifdef USE_CUDA
    if (device_graph_.is_allocated && !delays.empty()) {
        CUDA_CHECK(cudaMemcpy(device_graph_.d_congestion_delays, delays.data(), delays.size() * sizeof(double), cudaMemcpyHostToDevice));
    }
#endif
}

FlattenedPopulationHost CUDAFitnessEvaluator::flattenPopulation(const std::vector<Individual>& population) {
    FlattenedPopulationHost flat;
    flat.population_size = static_cast<int>(population.size());
    flat.offsets.resize(flat.population_size);
    flat.lengths.resize(flat.population_size);

    int current_offset = 0;
    for (int i = 0; i < flat.population_size; ++i) {
        flat.offsets[i] = current_offset;
        flat.lengths[i] = static_cast<int>(population[i].path.size());
        flat.flat_nodes.insert(flat.flat_nodes.end(), population[i].path.begin(), population[i].path.end());
        current_offset += flat.lengths[i];
    }
    flat.total_nodes_count = current_offset;
    return flat;
}

void CUDAFitnessEvaluator::evaluatePopulation(
    std::vector<Individual>& population,
    const GAConfig& config
) {
    if (population.empty()) return;

#ifdef USE_CUDA
    if (is_gpu_ready_) {
        FlattenedPopulationHost flat_pop = flattenPopulation(population);
        std::vector<RouteScore> scores(flat_pop.population_size);
        launchKernel(flat_pop, config, scores);
        for (size_t i = 0; i < population.size(); ++i) {
            population[i].score = scores[i];
        }
        return;
    }
#endif

    // OpenMP CPU Fallback
    #pragma omp parallel for schedule(static)
    for (int i = 0; i < static_cast<int>(population.size()); ++i) {
        const auto& path = population[i].path;
        if (path.size() < 2) {
            population[i].score.is_valid = false;
            population[i].score.total_cost = 1e18;
            continue;
        }

        double total_cost = 0.0;
        double total_dist = 0.0;
        double total_transit = 0.0;
        double total_fuel = 0.0;
        double total_switch = 0.0;
        int sea_legs = 0;
        int road_legs = 0;
        int mode_switches = 0;
        int prev_mode = -1;
        bool valid = true;

        for (size_t hop = 0; hop < path.size() - 1; ++hop) {
            int u = path[hop];
            int v = path[hop + 1];

            if (u < 0 || u >= host_graph_.node_count || v < 0 || v >= host_graph_.node_count) {
                valid = false;
                break;
            }

            int edge_start = host_graph_.edge_offsets[u];
            int edge_end = host_graph_.edge_offsets[u + 1];
            int found_idx = -1;
            for (int e = edge_start; e < edge_end; ++e) {
                if (host_graph_.edge_dest_ids[e] == v) {
                    found_idx = e;
                    break;
                }
            }

            if (found_idx < 0) {
                valid = false;
                break;
            }

            double dist_km = host_graph_.edge_distances_km[found_idx];
            double transit_hrs = host_graph_.edge_transit_hours[found_idx];
            int mode = host_graph_.edge_modes[found_idx];
            double congestion = host_graph_.congestion_delays[v];
            double fuel_rate = (mode == 0) ? config.fuel_rate_sea : config.fuel_rate_road;
            double edge_fuel = dist_km * fuel_rate;

            total_dist += dist_km;
            total_transit += (transit_hrs + congestion);
            total_fuel += edge_fuel;
            total_cost += (edge_fuel + transit_hrs + congestion);

            if (mode == 0) sea_legs++;
            else road_legs++;

            if (hop > 0 && prev_mode != -1 && mode != prev_mode) {
                total_cost += config.mode_switch_penalty;
                total_switch += config.mode_switch_penalty;
                mode_switches++;
            }
            prev_mode = mode;
        }

        population[i].score.is_valid = valid;
        population[i].score.total_cost = valid ? total_cost : 1e18;
        population[i].score.total_distance_km = total_dist;
        population[i].score.total_transit_hours = total_transit;
        population[i].score.total_fuel_cost = total_fuel;
        population[i].score.total_switch_penalties = total_switch;
        population[i].score.sea_legs = sea_legs;
        population[i].score.road_legs = road_legs;
        population[i].score.mode_switches = mode_switches;
    }
}

void CUDAFitnessEvaluator::evaluatePermutationPopulation(
    std::vector<Individual>& population,
    const DynamicCostMatrix& matrix
) {
    if (population.empty() || matrix.node_count == 0) return;

    int pop_size = static_cast<int>(population.size());
    int perm_len = static_cast<int>(population.front().path.size());

#ifdef USE_CUDA
    // Flatten permutations
    std::vector<int> flat_perms(pop_size * perm_len);
    for (int i = 0; i < pop_size; ++i) {
        for (int k = 0; k < perm_len; ++k) {
            flat_perms[i * perm_len + k] = matrix.getIndex(population[i].path[k]);
        }
    }

    int* d_flat_perms = nullptr;
    double* d_cost_mat = nullptr;
    double* d_dist_mat = nullptr;
    double* d_transit_mat = nullptr;
    double* d_out_costs = nullptr;
    double* d_out_dist = nullptr;
    double* d_out_transit = nullptr;

    size_t mat_size = matrix.cost_matrix.size() * sizeof(double);

    CUDA_CHECK(cudaMalloc(&d_flat_perms, flat_perms.size() * sizeof(int)));
    CUDA_CHECK(cudaMalloc(&d_cost_mat, mat_size));
    CUDA_CHECK(cudaMalloc(&d_dist_mat, mat_size));
    CUDA_CHECK(cudaMalloc(&d_transit_mat, mat_size));
    CUDA_CHECK(cudaMalloc(&d_out_costs, pop_size * sizeof(double)));
    CUDA_CHECK(cudaMalloc(&d_out_dist, pop_size * sizeof(double)));
    CUDA_CHECK(cudaMalloc(&d_out_transit, pop_size * sizeof(double)));

    CUDA_CHECK(cudaMemcpy(d_flat_perms, flat_perms.data(), flat_perms.size() * sizeof(int), cudaMemcpyHostToDevice));
    CUDA_CHECK(cudaMemcpy(d_cost_mat, matrix.cost_matrix.data(), mat_size, cudaMemcpyHostToDevice));
    CUDA_CHECK(cudaMemcpy(d_dist_mat, matrix.dist_matrix.data(), mat_size, cudaMemcpyHostToDevice));
    CUDA_CHECK(cudaMemcpy(d_transit_mat, matrix.transit_matrix.data(), mat_size, cudaMemcpyHostToDevice));

    int block_size = 256;
    int grid_size = (pop_size + block_size - 1) / block_size;

    computePermutationFitnessKernel<<<grid_size, block_size>>>(
        d_flat_perms, pop_size, perm_len, matrix.node_count,
        d_cost_mat, d_dist_mat, d_transit_mat,
        d_out_costs, d_out_dist, d_out_transit
    );
    CUDA_CHECK(cudaDeviceSynchronize());

    std::vector<double> h_costs(pop_size);
    std::vector<double> h_dist(pop_size);
    std::vector<double> h_transit(pop_size);

    CUDA_CHECK(cudaMemcpy(h_costs.data(), d_out_costs, pop_size * sizeof(double), cudaMemcpyDeviceToHost));
    CUDA_CHECK(cudaMemcpy(h_dist.data(), d_out_dist, pop_size * sizeof(double), cudaMemcpyDeviceToHost));
    CUDA_CHECK(cudaMemcpy(h_transit.data(), d_out_transit, pop_size * sizeof(double), cudaMemcpyDeviceToHost));

    cudaFree(d_flat_perms);
    cudaFree(d_cost_mat);
    cudaFree(d_dist_mat);
    cudaFree(d_transit_mat);
    cudaFree(d_out_costs);
    cudaFree(d_out_dist);
    cudaFree(d_out_transit);

    for (int i = 0; i < pop_size; ++i) {
        population[i].score.total_cost = h_costs[i];
        population[i].score.total_distance_km = h_dist[i];
        population[i].score.total_transit_hours = h_transit[i];
        population[i].score.total_fuel_cost = h_dist[i] * 0.6;
        population[i].score.sea_legs = perm_len - 1;
        population[i].score.road_legs = 0;
        population[i].score.mode_switches = 0;
        population[i].score.is_valid = (h_costs[i] < 1e17);
    }
#else
    // Parallel CPU implementation
    #pragma omp parallel for schedule(static)
    for (int i = 0; i < pop_size; ++i) {
        const auto& p = population[i].path;
        double total_cost = 0.0;
        double total_dist = 0.0;
        double total_transit = 0.0;

        for (int k = 0; k < perm_len - 1; ++k) {
            int u_id = p[k];
            int v_id = p[k + 1];
            int u_idx = matrix.getIndex(u_id);
            int v_idx = matrix.getIndex(v_id);
            if (u_idx >= 0 && v_idx >= 0) {
                total_cost += matrix.getCost(u_idx, v_idx);
                total_dist += matrix.getDistance(u_idx, v_idx);
                total_transit += matrix.getTransitHours(u_idx, v_idx);
            } else {
                total_cost += 1e18;
            }
        }

        population[i].score.total_cost = total_cost;
        population[i].score.total_distance_km = total_dist;
        population[i].score.total_transit_hours = total_transit;
        population[i].score.total_fuel_cost = total_dist * 0.6;
        population[i].score.sea_legs = perm_len - 1;
        population[i].score.road_legs = 0;
        population[i].score.mode_switches = 0;
        population[i].score.is_valid = (total_cost < 1e17);
    }
#endif
}

void CUDAFitnessEvaluator::launchKernel(
    const FlattenedPopulationHost& flat_pop,
    const GAConfig& config,
    std::vector<RouteScore>& out_scores
) {
#ifdef USE_CUDA
    int pop_size = flat_pop.population_size;
    int total_nodes = flat_pop.total_nodes_count;

    int* d_flat_nodes = nullptr;
    int* d_offsets = nullptr;
    int* d_lengths = nullptr;

    double* d_out_costs = nullptr;
    double* d_out_distances = nullptr;
    double* d_out_transit_hours = nullptr;
    double* d_out_fuel_costs = nullptr;
    double* d_out_switch_penalties = nullptr;
    int* d_out_sea_legs = nullptr;
    int* d_out_road_legs = nullptr;
    int* d_out_mode_switches = nullptr;
    int* d_out_is_valid = nullptr;

    CUDA_CHECK(cudaMalloc(&d_flat_nodes, total_nodes * sizeof(int)));
    CUDA_CHECK(cudaMalloc(&d_offsets, pop_size * sizeof(int)));
    CUDA_CHECK(cudaMalloc(&d_lengths, pop_size * sizeof(int)));

    CUDA_CHECK(cudaMalloc(&d_out_costs, pop_size * sizeof(double)));
    CUDA_CHECK(cudaMalloc(&d_out_distances, pop_size * sizeof(double)));
    CUDA_CHECK(cudaMalloc(&d_out_transit_hours, pop_size * sizeof(double)));
    CUDA_CHECK(cudaMalloc(&d_out_fuel_costs, pop_size * sizeof(double)));
    CUDA_CHECK(cudaMalloc(&d_out_switch_penalties, pop_size * sizeof(double)));
    CUDA_CHECK(cudaMalloc(&d_out_sea_legs, pop_size * sizeof(int)));
    CUDA_CHECK(cudaMalloc(&d_out_road_legs, pop_size * sizeof(int)));
    CUDA_CHECK(cudaMalloc(&d_out_mode_switches, pop_size * sizeof(int)));
    CUDA_CHECK(cudaMalloc(&d_out_is_valid, pop_size * sizeof(int)));

    CUDA_CHECK(cudaMemcpy(d_flat_nodes, flat_pop.flat_nodes.data(), total_nodes * sizeof(int), cudaMemcpyHostToDevice));
    CUDA_CHECK(cudaMemcpy(d_offsets, flat_pop.offsets.data(), pop_size * sizeof(int), cudaMemcpyHostToDevice));
    CUDA_CHECK(cudaMemcpy(d_lengths, flat_pop.lengths.data(), pop_size * sizeof(int), cudaMemcpyHostToDevice));

    int block_size = 256;
    int grid_size = (pop_size + block_size - 1) / block_size;

    computeRouteCostsKernel<<<grid_size, block_size>>>(
        d_flat_nodes, d_offsets, d_lengths, pop_size,
        device_graph_.d_edge_offsets, device_graph_.d_edge_dest_ids,
        device_graph_.d_edge_distances_km, device_graph_.d_edge_transit_hours,
        device_graph_.d_edge_modes, device_graph_.d_congestion_delays,
        host_graph_.node_count,
        config.fuel_rate_sea, config.fuel_rate_road, config.mode_switch_penalty,
        d_out_costs, d_out_distances, d_out_transit_hours, d_out_fuel_costs, d_out_switch_penalties,
        d_out_sea_legs, d_out_road_legs, d_out_mode_switches, d_out_is_valid
    );
    CUDA_CHECK(cudaDeviceSynchronize());

    std::vector<double> h_costs(pop_size);
    std::vector<double> h_distances(pop_size);
    std::vector<double> h_transit_hours(pop_size);
    std::vector<double> h_fuel_costs(pop_size);
    std::vector<double> h_switch_penalties(pop_size);
    std::vector<int> h_sea_legs(pop_size);
    std::vector<int> h_road_legs(pop_size);
    std::vector<int> h_mode_switches(pop_size);
    std::vector<int> h_is_valid(pop_size);

    CUDA_CHECK(cudaMemcpy(h_costs.data(), d_out_costs, pop_size * sizeof(double), cudaMemcpyDeviceToHost));
    CUDA_CHECK(cudaMemcpy(h_distances.data(), d_out_distances, pop_size * sizeof(double), cudaMemcpyDeviceToHost));
    CUDA_CHECK(cudaMemcpy(h_transit_hours.data(), d_out_transit_hours, pop_size * sizeof(double), cudaMemcpyDeviceToHost));
    CUDA_CHECK(cudaMemcpy(h_fuel_costs.data(), d_out_fuel_costs, pop_size * sizeof(double), cudaMemcpyDeviceToHost));
    CUDA_CHECK(cudaMemcpy(h_switch_penalties.data(), d_out_switch_penalties, pop_size * sizeof(double), cudaMemcpyDeviceToHost));
    CUDA_CHECK(cudaMemcpy(h_sea_legs.data(), d_out_sea_legs, pop_size * sizeof(int), cudaMemcpyDeviceToHost));
    CUDA_CHECK(cudaMemcpy(h_road_legs.data(), d_out_road_legs, pop_size * sizeof(int), cudaMemcpyDeviceToHost));
    CUDA_CHECK(cudaMemcpy(h_mode_switches.data(), d_out_mode_switches, pop_size * sizeof(int), cudaMemcpyDeviceToHost));
    CUDA_CHECK(cudaMemcpy(h_is_valid.data(), d_out_is_valid, pop_size * sizeof(int), cudaMemcpyDeviceToHost));

    cudaFree(d_flat_nodes);
    cudaFree(d_offsets);
    cudaFree(d_lengths);
    cudaFree(d_out_costs);
    cudaFree(d_out_distances);
    cudaFree(d_out_transit_hours);
    cudaFree(d_out_fuel_costs);
    cudaFree(d_out_switch_penalties);
    cudaFree(d_out_sea_legs);
    cudaFree(d_out_road_legs);
    cudaFree(d_out_mode_switches);
    cudaFree(d_out_is_valid);

    for (int i = 0; i < pop_size; ++i) {
        out_scores[i].total_cost = h_costs[i];
        out_scores[i].total_distance_km = h_distances[i];
        out_scores[i].total_transit_hours = h_transit_hours[i];
        out_scores[i].total_fuel_cost = h_fuel_costs[i];
        out_scores[i].total_switch_penalties = h_switch_penalties[i];
        out_scores[i].sea_legs = h_sea_legs[i];
        out_scores[i].road_legs = h_road_legs[i];
        out_scores[i].mode_switches = h_mode_switches[i];
        out_scores[i].is_valid = (h_is_valid[i] == 1);
    }
#else
    (void)flat_pop;
    (void)config;
    (void)out_scores;
#endif
}

void runCUDAFitnessBenchmark(
    const MultimodalGraph& graph,
    const std::vector<Individual>& base_population,
    const GAConfig& config,
    size_t generations_to_test
) {
    std::cout << "\n========================================================================\n";
    std::cout << "        CUDA GPU vs CPU FITNESS EVALUATION BENCHMARK                    \n";
    std::cout << "========================================================================\n";
    std::cout << "  Population Size   : " << base_population.size() << " routes\n";
    std::cout << "  Benchmark Rounds  : " << generations_to_test << " evaluations\n";

    CUDAFitnessEvaluator eval;
    eval.initGraph(graph);

    std::vector<Individual> pop_copy = base_population;
    auto start = std::chrono::high_resolution_clock::now();
    for (size_t g = 0; g < generations_to_test; ++g) {
        eval.evaluatePopulation(pop_copy, config);
    }
    auto end = std::chrono::high_resolution_clock::now();
    double ms = std::chrono::duration<double, std::milli>(end - start).count();

    std::cout << "  Total Evaluation Time: " << ms << " ms (" << (ms / generations_to_test) << " ms/gen)\n";
    std::cout << "========================================================================\n\n";
}

} // namespace RouteOptimizer
