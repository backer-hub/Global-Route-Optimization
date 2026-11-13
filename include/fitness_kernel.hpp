#pragma once

#include "graph.hpp"
#include <vector>
#include <string>
#include <memory>

namespace RouteOptimizer {

// Forward declarations
struct Individual;
struct GAConfig;
struct RouteScore;
struct DynamicCostMatrix;

/**
 * @brief Flattened CSR Graph structure for GPU / cache-friendly memory layout
 */
struct FlattenedGraphHost {
    int node_count = 0;
    int edge_count = 0;
    std::vector<int> edge_offsets;         ///< Size: node_count + 1
    std::vector<int> edge_dest_ids;        ///< Size: edge_count
    std::vector<double> edge_distances_km; ///< Size: edge_count
    std::vector<double> edge_transit_hours;///< Size: edge_count
    std::vector<int> edge_modes;           ///< Size: edge_count (0 = SEA, 1 = ROAD)
    std::vector<double> congestion_delays; ///< Size: node_count
};

/**
 * @brief Device pointers for static graph resident in GPU VRAM
 */
struct FlattenedGraphDevice {
    int* d_edge_offsets = nullptr;
    int* d_edge_dest_ids = nullptr;
    double* d_edge_distances_km = nullptr;
    double* d_edge_transit_hours = nullptr;
    int* d_edge_modes = nullptr;
    double* d_congestion_delays = nullptr;
    bool is_allocated = false;
};

/**
 * @brief Ragged Array Population representation flattened for GPU memory
 */
struct FlattenedPopulationHost {
    std::vector<int> flat_nodes;           ///< All route node sequences concatenated
    std::vector<int> offsets;              ///< Starting index of each route in flat_nodes
    std::vector<int> lengths;              ///< Hop count of each route
    int population_size = 0;
    int total_nodes_count = 0;
};

/**
 * @brief CUDA Massively Parallel Fitness Evaluator
 */
class CUDAFitnessEvaluator {
public:
    static bool hasDevice();
    CUDAFitnessEvaluator();
    ~CUDAFitnessEvaluator();

    /**
     * @brief Upload static graph CSR tables to GPU VRAM once at startup
     */
    bool initGraph(const MultimodalGraph& graph);

    /**
     * @brief Update dynamic congestion delays if modified between generations
     */
    void updateCongestionDelays(const std::vector<double>& delays);

    /**
     * @brief Evaluate an entire graph path population on the GPU
     */
    void evaluatePopulation(
        std::vector<Individual>& population,
        const GAConfig& config
    );

    /**
     * @brief Evaluate TSP permutation population on the GPU using the precomputed dynamic cost matrix
     * Requirement 3: Eliminate inline Haversine calculations and look up pre-calculated travel costs directly from cached matrix.
     */
    void evaluatePermutationPopulation(
        std::vector<Individual>& population,
        const DynamicCostMatrix& matrix
    );

    /**
     * @brief Helper to convert std::vector<Individual> into FlattenedPopulationHost
     */
    static FlattenedPopulationHost flattenPopulation(const std::vector<Individual>& population);

    /**
     * @brief Check if GPU acceleration is active and initialized
     */
    bool isGPUActive() const { return is_gpu_ready_; }

    /**
     * @brief Release device graph memory
     */
    void freeGraphMemory();

private:
    FlattenedGraphHost host_graph_;
    FlattenedGraphDevice device_graph_;
    bool is_gpu_ready_ = false;

    // Internal kernel launcher
    void launchKernel(
        const FlattenedPopulationHost& flat_pop,
        const GAConfig& config,
        std::vector<RouteScore>& out_scores
    );
};

void runCUDAFitnessBenchmark(
    const MultimodalGraph& graph,
    const std::vector<Individual>& base_population,
    const GAConfig& config,
    size_t generations_to_test = 5
);

} // namespace RouteOptimizer
