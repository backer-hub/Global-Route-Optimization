#pragma once

#include "graph.hpp"
#include <vector>
#include <random>
#include <string>
#include <fstream>
#include <sstream>
#include <iostream>
#include <unordered_map>

#ifdef _OPENMP
#include <omp.h>
#endif

namespace RouteOptimizer {

/**
 * @brief Dynamic Cost Matrix loaded from Python ingestion (weather + AIS congestion penalties)
 */
struct DynamicCostMatrix {
    int node_count = 0;
    std::vector<int> node_ids;
    std::unordered_map<int, int> node_id_to_idx;
    std::vector<double> cost_matrix;    ///< Flattened N x N travel costs
    std::vector<double> dist_matrix;    ///< Flattened N x N physical distances (km)
    std::vector<double> transit_matrix; ///< Flattened N x N transit durations (hours)

    // Nonzero mode codes encode the first and last modes of graph-generated legs.
    std::vector<int> leg_modes;
    double mode_switch_penalty = 0.0;

    int getIndex(int node_id) const {
        auto it = node_id_to_idx.find(node_id);
        return (it != node_id_to_idx.end()) ? it->second : -1;
    }

    double getCost(int i, int j) const {
        if (i < 0 || i >= node_count || j < 0 || j >= node_count) return 1e18;
        return cost_matrix[i * node_count + j];
    }

    double getCostByNodeIds(int u_id, int v_id) const {
        int i = getIndex(u_id);
        int j = getIndex(v_id);
        return getCost(i, j);
    }

    double getDistance(int i, int j) const {
        if (i < 0 || i >= node_count || j < 0 || j >= node_count) return 0.0;
        return dist_matrix[i * node_count + j];
    }

    double getTransitHours(int i, int j) const {
        if (i < 0 || i >= node_count || j < 0 || j >= node_count) return 0.0;
        return transit_matrix[i * node_count + j];
    }

    static DynamicCostMatrix loadFromBinary(const std::string& bin_path);
    static DynamicCostMatrix createFromGraph(const MultimodalGraph& graph, const std::vector<int>& waypoint_ids,
                                            double fuel_rate_sea, double fuel_rate_road = 1.4,
                                            double time_cost_per_hour = 1.0, double mode_switch_penalty = 0.0);
};

/**
 * @brief Evaluation metrics cached alongside every candidate route
 */
struct RouteScore {
    double total_cost = 0.0;             ///< Mode-aware objective cost (fuel + transit + delay + penalties)
    double total_distance_km = 0.0;      ///< Total physical distance traversed in km
    double total_transit_hours = 0.0;    ///< Total transport transit hours
    double total_fuel_cost = 0.0;        ///< Total fuel consumption expense ($)
    double total_switch_penalties = 0.0; ///< Intermodal transfer penalties ($)
    int sea_legs = 0;                    ///< Number of maritime shipping lane edges
    int road_legs = 0;                   ///< Number of highway / drayage road edges
    int mode_switches = 0;               ///< Total number of intermodal mode switches (Sea <-> Road)
    bool is_valid = false;               ///< Validity flag (continuous path, no cycles, valid endpoints)
};

/**
 * @brief Candidate route individual (Chromosome)
 */
struct Individual {
    std::vector<int> path; ///< Sequence of node IDs from source to destination (or waypoint permutation)
    RouteScore score;      ///< Cached evaluation score
};

/**
 * @brief Genetic Algorithm Configuration and Hyperparameters
 */
struct GAConfig {
    double time_cost_per_hour = 1.0;
    double fuel_rate_sea = 0.6;          ///< $/km for maritime container shipping (FUEL_RATE_SEA)
    double fuel_rate_road = 1.4;         ///< $/km for highway freight trucking (FUEL_RATE_ROAD)
    double mode_switch_penalty = 50.0;   ///< Transfer penalty ($) for intermodal sea <-> road shift
    size_t population_size = 1000;       ///< Candidate population size
    double mutation_rate = 0.12;         ///< Mutation probability
    size_t max_generations = 100;        ///< Total GA iterations
    size_t tournament_size = 4;          ///< Tournament selection pool size
    double elitism_ratio = 0.05;         ///< Fraction of elite routes copied directly to next generation
    int max_dfs_depth = 2000;            ///< Maximum search depth for randomized DFS path generator
    int max_dfs_retries = 300;           ///< Capped retry attempts per randomized DFS path
    unsigned int random_seed = 42;       ///< RNG seed for deterministic reproducibility
    int num_threads = 0;                 ///< Number of OpenMP threads (0 = auto / max available)
    bool use_cuda = false;               ///< Whether to evaluate fitness using CUDA GPU acceleration
    bool verbose_logging = true;         ///< Whether to print generation telemetry tables
};

/**
 * @brief Telemetry snapshot recorded during GA iterations
 */
struct GenerationTelemetry {
    int generation = 0;
    double best_cost = 0.0;
    int best_sea_legs = 0;
    int best_road_legs = 0;
    int best_mode_switches = 0;
    double best_distance_km = 0.0;
    double best_transit_hours = 0.0;
    double avg_population_cost = 0.0;
    double crossover_fallback_rate = 0.0;
};

/**
 * @brief OpenMP-Parallelized Sequential Genetic Algorithm Multimodal Route Optimizer
 */
class GeneticAlgorithmOptimizer {
public:
    explicit GeneticAlgorithmOptimizer(const MultimodalGraph& graph, GAConfig config = {});

    /**
     * @brief Run Graph-based GA optimization from origin_id to dest_id
     */
    Individual optimizeRoute(int origin_id, int dest_id);

    /**
     * @brief Run TSP Permutation GA optimization across a fixed set of waypoints with locked start (index 0) and end (index N-1)
     */
    Individual optimizeTSPPermutation(const std::vector<int>& waypoints, const DynamicCostMatrix& cost_matrix);

    /**
     * @brief Compute the mode-aware cost and metrics for any candidate graph path
     */
    RouteScore evaluateRoute(const std::vector<int>& path) const;

    /**
     * @brief Compute evaluation metrics for a TSP permutation against the dynamic cost matrix
     */
    RouteScore evaluateTSPPermutation(const std::vector<int>& path, const DynamicCostMatrix& matrix) const;

    /**
     * @brief Evaluate fitness for an entire population (delegates to CUDA GPU or OpenMP CPU)
     */
    void evaluatePopulation(std::vector<Individual>& population);

    /**
     * @brief Evaluate fitness for a TSP permutation population
     */
    void evaluatePermutationPopulation(std::vector<Individual>& population, const DynamicCostMatrix& matrix);

    /**
     * @brief Print a detailed human-readable breakdown of an optimized route
     */
    void printRouteDetails(const Individual& individual) const;

    /**
     * @brief Access the configuration
     */
    const GAConfig& getConfig() const { return config_; }

    /**
     * @brief Access recorded telemetry history
     */
    const std::vector<GenerationTelemetry>& getTelemetryHistory() const { return telemetry_history_; }

    // Thread-safe core operators with explicit RNG references
    const Individual& tournamentSelectWithRNG(const std::vector<Individual>& population, std::mt19937& rng) const;
    std::vector<int> crossoverWithRNG(const std::vector<int>& parent1, const std::vector<int>& parent2, std::mt19937& rng, size_t& fallback_counter) const;
    
    /**
     * @brief Order Crossover (OX1) for Permutation TSP chromosomes.
     * Locks index 0 and index N-1 in place, seamlessly recombining intermediate waypoints without duplicates or omissions.
     */
    std::vector<int> orderCrossoverOX1(const std::vector<int>& parent1, const std::vector<int>& parent2, std::mt19937& rng) const;

    /**
     * @brief Swap Mutation for Permutation TSP chromosomes.
     * Swaps two random intermediate indices in range [1, N-2], locking index 0 and N-1.
     */
    void swapMutation(std::vector<int>& path, std::mt19937& rng) const;

    void mutateWithRNG(std::vector<int>& path, int dest, std::mt19937& rng);
    std::vector<int> generateRandomDFSPathWithRNG(int source, int dest, std::mt19937& rng, const std::vector<bool>& forbidden_nodes = {});
    bool dfsSearchWithRNG(int current, int dest, std::vector<bool>& visited, std::vector<int>& path, int max_depth, int& step_budget, std::mt19937& rng);
    bool isValidSimplePath(const std::vector<int>& path, int expected_source, int expected_dest) const;

private:
    const MultimodalGraph& graph_;
    GAConfig config_;
    mutable std::mt19937 rng_;
    std::vector<GenerationTelemetry> telemetry_history_;

    std::vector<Individual> initializePermutationPopulation(const std::vector<int>& waypoints);
};

} // namespace RouteOptimizer
