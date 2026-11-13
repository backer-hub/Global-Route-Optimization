#include "ga.hpp"
#include "astar.hpp"
#include "fitness_kernel.hpp"

#include <iostream>
#include <iomanip>
#include <algorithm>
#include <numeric>
#include <chrono>
#include <unordered_set>
#include <queue>
#include <cmath>
#include <cstring>
#include <fstream>
#include <cstdint>

namespace RouteOptimizer {

// =============================================================================
// CONFIGURABLE GA CONSTANTS (Top of ga.cpp)
// =============================================================================
constexpr double FUEL_RATE_SEA = 0.6;          // $/km fuel rate for maritime shipping
constexpr double FUEL_RATE_ROAD = 1.4;         // $/km fuel rate for road trucking
constexpr double MODE_SWITCH_PENALTY = 50.0;   // Transfer penalty when consecutive edges switch mode
constexpr size_t POPULATION_SIZE = 1000;       // Number of candidate routes
constexpr double MUTATION_RATE = 0.12;         // Mutation probability
constexpr size_t GENERATION_COUNT = 100;       // Total generations
constexpr size_t TOURNAMENT_SIZE = 4;          // Tournament selection pool size (~4)
constexpr double TOP_SELECTION_RATIO = 0.20;   // Top 20% selection

// =============================================================================
// DynamicCostMatrix Implementation
// =============================================================================
DynamicCostMatrix DynamicCostMatrix::loadFromBinary(const std::string& bin_path) {
    DynamicCostMatrix mat;
    std::ifstream in(bin_path, std::ios::binary);
    if (!in.is_open()) {
        std::cerr << "[DynamicCostMatrix Warning] Unable to open binary file: " << bin_path << "\n";
        return mat;
    }

    char magic[4] = {0};
    in.read(magic, 4);
    if (std::strncmp(magic, "DCM1", 4) != 0) {
        std::cerr << "[DynamicCostMatrix Error] Invalid magic header in " << bin_path << "\n";
        return mat;
    }

    int32_t n = 0;
    in.read(reinterpret_cast<char*>(&n), sizeof(int32_t));
    constexpr int32_t max_matrix_nodes = 2048;
    if (!in || n <= 0 || n > max_matrix_nodes) {
        std::cerr << "[DynamicCostMatrix Error] Invalid node count: " << n << "\n";
        return mat;
    }

    size_t total_elements = static_cast<size_t>(n) * n;
    size_t expected_size = 8 + n * sizeof(int32_t) + 3 * total_elements * sizeof(double);
    in.seekg(0, std::ios::end);
    if (!in || in.tellg() != static_cast<std::streamoff>(expected_size)) {
        std::cerr << "[DynamicCostMatrix Error] Unexpected file size in " << bin_path << "\n";
        return {};
    }
    in.seekg(8);
    mat.node_count = n;
    mat.node_ids.resize(n);

    for (int i = 0; i < n; ++i) {
        int32_t nid = 0;
        in.read(reinterpret_cast<char*>(&nid), sizeof(int32_t));
        mat.node_ids[i] = nid;
        if (nid < 0 || !mat.node_id_to_idx.emplace(nid, i).second) {
            std::cerr << "[DynamicCostMatrix Error] Invalid or duplicate node ID.\n";
            return {};
        }
    }

    mat.cost_matrix.resize(total_elements);
    mat.dist_matrix.resize(total_elements);
    mat.transit_matrix.resize(total_elements);

    in.read(reinterpret_cast<char*>(mat.cost_matrix.data()), total_elements * sizeof(double));
    in.read(reinterpret_cast<char*>(mat.dist_matrix.data()), total_elements * sizeof(double));
    in.read(reinterpret_cast<char*>(mat.transit_matrix.data()), total_elements * sizeof(double));
    auto valid_weight = [](double value) { return std::isfinite(value) && value >= 0; };
    if (!in || !std::all_of(mat.cost_matrix.begin(), mat.cost_matrix.end(), valid_weight) ||
        !std::all_of(mat.dist_matrix.begin(), mat.dist_matrix.end(), valid_weight) ||
        !std::all_of(mat.transit_matrix.begin(), mat.transit_matrix.end(), valid_weight)) {
        std::cerr << "[DynamicCostMatrix Error] Invalid matrix weights.\n";
        return {};
    }

    std::cout << "[DynamicCostMatrix] Loaded " << n << "x" << n << " cost matrix from " << bin_path << "\n";
    return mat;
}

DynamicCostMatrix DynamicCostMatrix::createFromGraph(
    const MultimodalGraph& graph,
    const std::vector<int>& waypoint_ids,
    double fuel_rate_sea,
    double fuel_rate_road
) {
    DynamicCostMatrix mat;
    mat.node_count = static_cast<int>(waypoint_ids.size());
    mat.node_ids = waypoint_ids;
    for (int i = 0; i < mat.node_count; ++i) {
        mat.node_id_to_idx[waypoint_ids[i]] = i;
    }

    size_t total_elements = static_cast<size_t>(mat.node_count) * mat.node_count;
    mat.cost_matrix.assign(total_elements, 0.0);
    mat.dist_matrix.assign(total_elements, 0.0);
    mat.transit_matrix.assign(total_elements, 0.0);

    AStarOptimizer optimizer(graph, fuel_rate_sea, fuel_rate_road);
    #pragma omp parallel for schedule(dynamic)
    for (int i = 0; i < mat.node_count; ++i) {
        for (int j = 0; j < mat.node_count; ++j) {
            if (i == j) continue;
            auto leg = optimizer.findOptimalRoute(waypoint_ids[i], waypoint_ids[j]);
            size_t index = static_cast<size_t>(i) * mat.node_count + j;
            mat.cost_matrix[index] = leg.is_valid ? leg.total_cost : 1e18;
            mat.dist_matrix[index] = leg.total_distance_km;
            mat.transit_matrix[index] = leg.total_transit_hours;
        }
    }
    return mat;
}

// =============================================================================
// GeneticAlgorithmOptimizer Core Methods
// =============================================================================
GeneticAlgorithmOptimizer::GeneticAlgorithmOptimizer(const MultimodalGraph& graph, GAConfig config)
    : graph_(graph), config_(config), rng_(config.random_seed) {
    if (config_.fuel_rate_sea <= 0.0) config_.fuel_rate_sea = FUEL_RATE_SEA;
    if (config_.fuel_rate_road <= 0.0) config_.fuel_rate_road = FUEL_RATE_ROAD;
    if (config_.mode_switch_penalty < 0.0) config_.mode_switch_penalty = MODE_SWITCH_PENALTY;
    if (config_.population_size == 0) config_.population_size = POPULATION_SIZE;
    if (config_.mutation_rate <= 0.0) config_.mutation_rate = MUTATION_RATE;
    if (config_.max_generations == 0) config_.max_generations = GENERATION_COUNT;
    if (config_.tournament_size == 0) config_.tournament_size = TOURNAMENT_SIZE;
}

RouteScore GeneticAlgorithmOptimizer::evaluateRoute(const std::vector<int>& path) const {
    RouteScore score;
    if (path.size() < 2) {
        score.is_valid = false;
        score.total_cost = 1e18;
        return score;
    }

    std::unordered_set<int> visited_nodes;
    for (int node_id : path) {
        if (visited_nodes.find(node_id) != visited_nodes.end()) {
            score.is_valid = false;
            score.total_cost = 1e18;
            return score;
        }
        visited_nodes.insert(node_id);
    }

    TransportMode prev_mode = TransportMode::UNKNOWN;

    for (size_t i = 0; i < path.size() - 1; ++i) {
        int u = path[i];
        int v = path[i + 1];

        const Edge* edge = graph_.getEdge(u, v);
        if (!edge) {
            score.is_valid = false;
            score.total_cost = 1e18;
            return score;
        }

        const Node* dest_node = graph_.getNode(v);
        double congestion_delay = dest_node ? dest_node->congestion_delay : 0.0;

        double fuel_rate = (edge->mode == TransportMode::SEA) ? config_.fuel_rate_sea : config_.fuel_rate_road;
        double edge_fuel_cost = edge->distance_km * fuel_rate;
        double edge_cost = edge_fuel_cost + edge->base_transit_hours + congestion_delay;

        score.total_distance_km += edge->distance_km;
        score.total_transit_hours += edge->base_transit_hours + congestion_delay;
        score.total_fuel_cost += edge_fuel_cost;
        score.total_cost += edge_cost;

        if (edge->mode == TransportMode::SEA) {
            score.sea_legs++;
        } else if (edge->mode == TransportMode::ROAD) {
            score.road_legs++;
        }

        if (i > 0 && prev_mode != TransportMode::UNKNOWN && edge->mode != prev_mode) {
            score.total_cost += config_.mode_switch_penalty;
            score.total_switch_penalties += config_.mode_switch_penalty;
            score.mode_switches++;
        }

        prev_mode = edge->mode;
    }

    score.is_valid = true;
    return score;
}

RouteScore GeneticAlgorithmOptimizer::evaluateTSPPermutation(
    const std::vector<int>& path,
    const DynamicCostMatrix& matrix
) const {
    RouteScore score;
    if (path.size() < 2) {
        score.is_valid = false;
        score.total_cost = 1e18;
        return score;
    }

    score.is_valid = true;
    score.sea_legs = static_cast<int>(path.size() - 1);
    score.road_legs = 0;
    score.mode_switches = 0;

    for (size_t i = 0; i < path.size() - 1; ++i) {
        int u_id = path[i];
        int v_id = path[i + 1];

        int u_idx = matrix.getIndex(u_id);
        int v_idx = matrix.getIndex(v_id);

        if (u_idx < 0 || v_idx < 0) {
            score.is_valid = false;
            score.total_cost = 1e18;
            return score;
        }

        double edge_cost = matrix.getCost(u_idx, v_idx);
        double dist_km = matrix.getDistance(u_idx, v_idx);
        double transit_hrs = matrix.getTransitHours(u_idx, v_idx);

        score.total_cost += edge_cost;
        score.total_distance_km += dist_km;
        score.total_transit_hours += transit_hrs;
        score.total_fuel_cost += dist_km * config_.fuel_rate_sea;
    }

    score.is_valid = score.total_cost < 1e17;
    return score;
}

// =============================================================================
// TSP Permutation Operators (OX1 & Swap Mutation)
// =============================================================================

std::vector<int> GeneticAlgorithmOptimizer::orderCrossoverOX1(
    const std::vector<int>& parent1,
    const std::vector<int>& parent2,
    std::mt19937& rng
) const {
    size_t n = parent1.size();
    if (n <= 3) {
        return parent1;
    }

    std::vector<int> child(n, -1);
    // Lock index 0 (origin) and index N-1 (destination)
    child[0] = parent1[0];
    child[n - 1] = parent1[n - 1];

    // Select random window in the interior range [1, n - 2]
    std::uniform_int_distribution<size_t> dist(1, n - 2);
    size_t c1 = dist(rng);
    size_t c2 = dist(rng);
    if (c1 > c2) std::swap(c1, c2);

    std::unordered_set<int> copied_nodes;
    for (size_t i = c1; i <= c2; ++i) {
        child[i] = parent1[i];
        copied_nodes.insert(parent1[i]);
    }

    // Fill remaining positions using parent2's circular order starting at c2 + 1
    size_t child_pos = (c2 + 1 <= n - 2) ? (c2 + 1) : 1;
    size_t p2_pos = (c2 + 1 <= n - 2) ? (c2 + 1) : 1;

    for (size_t count = 0; count < (n - 2); ++count) {
        int candidate = parent2[p2_pos];
        if (copied_nodes.find(candidate) == copied_nodes.end()) {
            while (child[child_pos] != -1) {
                child_pos = (child_pos + 1 <= n - 2) ? (child_pos + 1) : 1;
            }
            child[child_pos] = candidate;
            copied_nodes.insert(candidate);
        }
        p2_pos = (p2_pos + 1 <= n - 2) ? (p2_pos + 1) : 1;
    }

    return child;
}

void GeneticAlgorithmOptimizer::swapMutation(std::vector<int>& path, std::mt19937& rng) const {
    size_t n = path.size();
    if (n <= 3) return; // Need at least 2 intermediate waypoints to swap

    std::uniform_int_distribution<size_t> dist(1, n - 2);
    size_t i = dist(rng);
    size_t j = dist(rng);
    if (i != j) {
        std::swap(path[i], path[j]);
    }
}

// =============================================================================
// TSP Permutation Population Initialization & Optimization
// =============================================================================

std::vector<Individual> GeneticAlgorithmOptimizer::initializePermutationPopulation(
    const std::vector<int>& waypoints
) {
    std::vector<Individual> population(config_.population_size);
    size_t n = waypoints.size();
    if (n < 2) return population;

    // Base permutation
    std::vector<int> base_path = waypoints;

    for (size_t i = 0; i < config_.population_size; ++i) {
        std::vector<int> path = base_path;
        if (n > 3 && i > 0) {
            // Shuffle only intermediate waypoints [1, n-2], locking index 0 and index n-1
            std::shuffle(path.begin() + 1, path.end() - 1, rng_);
        }
        population[i].path = std::move(path);
    }
    return population;
}

void GeneticAlgorithmOptimizer::evaluatePermutationPopulation(
    std::vector<Individual>& population,
    const DynamicCostMatrix& matrix
) {
    if (config_.use_cuda) {
        CUDAFitnessEvaluator cuda_eval;
        cuda_eval.evaluatePermutationPopulation(population, matrix);
    } else {
        int thread_count = 1;
#ifdef _OPENMP
        thread_count = (config_.num_threads > 0) ? config_.num_threads : omp_get_num_procs();
#endif
        #pragma omp parallel for schedule(static) num_threads(thread_count)
        for (int i = 0; i < static_cast<int>(population.size()); ++i) {
            population[i].score = evaluateTSPPermutation(population[i].path, matrix);
        }
    }
}

Individual GeneticAlgorithmOptimizer::optimizeTSPPermutation(
    const std::vector<int>& waypoints,
    const DynamicCostMatrix& cost_matrix
) {
    telemetry_history_.clear();

    int thread_count = 1;
#ifdef _OPENMP
    if (config_.num_threads > 0) {
        thread_count = config_.num_threads;
        omp_set_num_threads(config_.num_threads);
    } else {
        thread_count = omp_get_num_procs();
        omp_set_num_threads(thread_count);
    }
#endif

    if (config_.verbose_logging) {
        std::cout << "\n========================================================================\n";
        std::cout << "       STARTING TSP PERMUTATION GA OPTIMIZER (" 
                  << (config_.use_cuda ? "CUDA GPU" : "OpenMP CPU") << ")          \n";
        std::cout << "========================================================================\n";
        std::cout << "  Waypoint Count    : " << waypoints.size() << " waypoints\n";
        std::cout << "  Start Node (Lock0): #" << waypoints.front() << "\n";
        std::cout << "  End Node (LockEnd): #" << waypoints.back() << "\n";
        std::cout << "  Population Size   : " << config_.population_size << " chromosomes\n";
        std::cout << "  Max Generations   : " << config_.max_generations << "\n";
        std::cout << "  Mutation Rate     : " << std::fixed << std::setprecision(1) << (config_.mutation_rate * 100.0) << "% (Swap Mutation)\n";
        std::cout << "  Crossover Method  : Order Crossover (OX1)\n";
        std::cout << "========================================================================\n\n" << std::flush;
    }

    auto start_time = std::chrono::high_resolution_clock::now();

    // 1. Initialize Permutations
    std::vector<Individual> population = initializePermutationPopulation(waypoints);
    evaluatePermutationPopulation(population, cost_matrix);

    std::sort(population.begin(), population.end(), [](const Individual& a, const Individual& b) {
        return a.score.total_cost < b.score.total_cost;
    });

    Individual global_best = population.front();
    size_t elite_count = std::max(size_t(1), static_cast<size_t>(config_.population_size * config_.elitism_ratio));

    int max_threads = 1;
#ifdef _OPENMP
    max_threads = thread_count;
#endif
    std::vector<std::mt19937> thread_rngs(max_threads);
    for (int t = 0; t < max_threads; ++t) {
        thread_rngs[t].seed(config_.random_seed + t * 9973 + 1337);
    }

    // 2. Generation Loop
    for (size_t gen = 0; gen <= config_.max_generations; ++gen) {
        evaluatePermutationPopulation(population, cost_matrix);

        std::sort(population.begin(), population.end(), [](const Individual& a, const Individual& b) {
            return a.score.total_cost < b.score.total_cost;
        });

        if (population.front().score.total_cost < global_best.score.total_cost) {
            global_best = population.front();
        }

        if (config_.verbose_logging && (gen % 20 == 0 || gen == config_.max_generations)) {
            std::cout << "  [Gen " << std::setw(3) << gen << "] Best Cost: $"
                      << std::fixed << std::setprecision(2) << global_best.score.total_cost
                      << " | Distance: " << std::setprecision(1) << global_best.score.total_distance_km << " km"
                      << " | Transit: " << global_best.score.total_transit_hours << " hrs\n" << std::flush;
        }

        if (gen == config_.max_generations) break;

        std::vector<Individual> next_gen(config_.population_size);
        for (size_t i = 0; i < elite_count; ++i) {
            next_gen[i] = population[i];
        }

        #pragma omp parallel for schedule(dynamic, 64) num_threads(thread_count)
        for (int i = static_cast<int>(elite_count); i < static_cast<int>(config_.population_size); ++i) {
            int tid = 0;
#ifdef _OPENMP
            tid = omp_get_thread_num();
#endif
            auto& local_rng = thread_rngs[tid % max_threads];

            const Individual& p1 = tournamentSelectWithRNG(population, local_rng);
            const Individual& p2 = tournamentSelectWithRNG(population, local_rng);

            auto child = orderCrossoverOX1(p1.path, p2.path, local_rng);

            std::uniform_real_distribution<double> mut_dist(0.0, 1.0);
            if (mut_dist(local_rng) < config_.mutation_rate) {
                swapMutation(child, local_rng);
            }

            next_gen[i].path = std::move(child);
        }

        population = std::move(next_gen);
    }

    auto end_time = std::chrono::high_resolution_clock::now();
    double duration_ms = std::chrono::duration<double, std::milli>(end_time - start_time).count();

    if (config_.verbose_logging) {
        std::cout << "\n[TSP Complete] Optimized in " << std::fixed << std::setprecision(2) << duration_ms << " ms.\n";
        std::cout << "  Optimal Sequence: ";
        for (size_t i = 0; i < global_best.path.size(); ++i) {
            std::cout << global_best.path[i] << (i + 1 < global_best.path.size() ? " -> " : "\n");
        }
    }

    return global_best;
}

// =============================================================================
// Graph-Based GA Helper Methods (Backward Compatibility)
// =============================================================================

bool GeneticAlgorithmOptimizer::isValidSimplePath(const std::vector<int>& path, int expected_source, int expected_dest) const {
    if (path.size() < 2) return false;
    if (path.front() != expected_source || path.back() != expected_dest) return false;

    std::unordered_set<int> seen;
    for (size_t i = 0; i < path.size(); ++i) {
        if (seen.find(path[i]) != seen.end()) return false;
        seen.insert(path[i]);
        if (i < path.size() - 1) {
            if (!graph_.getEdge(path[i], path[i + 1])) {
                return false;
            }
        }
    }
    return true;
}

bool GeneticAlgorithmOptimizer::dfsSearchWithRNG(
    int current, int dest,
    std::vector<bool>& visited,
    std::vector<int>& path,
    int max_depth,
    int& step_budget,
    std::mt19937& rng
) {
    if (--step_budget <= 0) {
        return false;
    }

    path.push_back(current);

    if (current == dest) {
        return true;
    }

    if (static_cast<int>(path.size()) >= max_depth) {
        path.pop_back();
        return false;
    }

    const auto& outgoing = graph_.getOutgoingEdges(current);
    if (outgoing.empty()) {
        path.pop_back();
        return false;
    }

    const Node* dest_node = graph_.getNode(dest);
    double dest_lat = dest_node ? dest_node->lat : 0.0;
    double dest_lon = dest_node ? dest_node->lon : 0.0;

    std::vector<size_t> indices(outgoing.size());
    std::iota(indices.begin(), indices.end(), 0);

    constexpr double PI = 3.14159265358979323846;
    auto heuristic_dist = [&](int node_id) -> double {
        const Node* n = graph_.getNode(node_id);
        if (!n) return 1e9;
        double dphi = (dest_lat - n->lat) * PI / 180.0;
        double dlam = (dest_lon - n->lon) * PI / 180.0;
        double p1 = n->lat * PI / 180.0;
        double p2 = dest_lat * PI / 180.0;
        double a = std::sin(dphi / 2.0) * std::sin(dphi / 2.0) +
                   std::cos(p1) * std::cos(p2) *
                   std::sin(dlam / 2.0) * std::sin(dlam / 2.0);
        return 2.0 * std::atan2(std::sqrt(a), std::sqrt(std::max(0.0, 1.0 - a)));
    };

    std::sort(indices.begin(), indices.end(), [&](size_t a, size_t b) {
        return heuristic_dist(outgoing[a].dest_id) < heuristic_dist(outgoing[b].dest_id);
    });

    size_t k = std::min(indices.size(), size_t(5));
    if (k > 1) {
        std::shuffle(indices.begin(), indices.begin() + k, rng);
    }

    for (size_t idx : indices) {
        if (step_budget <= 0) break;
        int next_node = outgoing[idx].dest_id;
        if (next_node < 0 || static_cast<size_t>(next_node) >= visited.size()) continue;

        if (!visited[next_node]) {
            visited[next_node] = true;
            if (dfsSearchWithRNG(next_node, dest, visited, path, max_depth, step_budget, rng)) {
                return true;
            }
            visited[next_node] = false;
        }
    }

    path.pop_back();
    return false;
}

std::vector<int> GeneticAlgorithmOptimizer::generateRandomDFSPathWithRNG(
    int source, int dest, std::mt19937& rng, const std::vector<bool>& forbidden_nodes
) {
    size_t n = graph_.nodeCount();
    std::vector<bool> visited(n, false);

    if (!forbidden_nodes.empty()) {
        for (size_t i = 0; i < std::min(n, forbidden_nodes.size()); ++i) {
            if (forbidden_nodes[i] && static_cast<int>(i) != source && static_cast<int>(i) != dest) {
                visited[i] = true;
            }
        }
    }

    visited[source] = true;
    std::vector<int> path;
    int step_budget = config_.max_dfs_retries * 200;

    if (dfsSearchWithRNG(source, dest, visited, path, config_.max_dfs_depth, step_budget, rng)) {
        return path;
    }
    return {};
}

const Individual& GeneticAlgorithmOptimizer::tournamentSelectWithRNG(
    const std::vector<Individual>& population,
    std::mt19937& rng
) const {
    std::uniform_int_distribution<size_t> dist(0, population.size() - 1);
    size_t best_idx = dist(rng);
    double best_cost = population[best_idx].score.total_cost;

    for (size_t i = 1; i < config_.tournament_size; ++i) {
        size_t idx = dist(rng);
        if (population[idx].score.total_cost < best_cost) {
            best_cost = population[idx].score.total_cost;
            best_idx = idx;
        }
    }
    return population[best_idx];
}

std::vector<int> GeneticAlgorithmOptimizer::crossoverWithRNG(
    const std::vector<int>& parent1,
    const std::vector<int>& parent2,
    std::mt19937& rng,
    size_t& fallback_counter
) const {
    if (parent1.size() < 3 || parent2.size() < 3) {
        fallback_counter++;
        return parent1;
    }

    std::unordered_set<int> p2_nodes(parent2.begin() + 1, parent2.end() - 1);
    std::vector<int> common_nodes;

    for (size_t i = 1; i < parent1.size() - 1; ++i) {
        if (p2_nodes.find(parent1[i]) != p2_nodes.end()) {
            common_nodes.push_back(parent1[i]);
        }
    }

    if (common_nodes.empty()) {
        fallback_counter++;
        return parent1;
    }

    std::uniform_int_distribution<size_t> dist(0, common_nodes.size() - 1);
    int pivot = common_nodes[dist(rng)];

    auto it1 = std::find(parent1.begin(), parent1.end(), pivot);
    auto it2 = std::find(parent2.begin(), parent2.end(), pivot);

    if (it1 == parent1.end() || it2 == parent2.end()) {
        fallback_counter++;
        return parent1;
    }

    std::vector<int> child;
    child.insert(child.end(), parent1.begin(), it1);
    child.insert(child.end(), it2, parent2.end());

    if (isValidSimplePath(child, parent1.front(), parent1.back())) {
        return child;
    }

    fallback_counter++;
    return parent1;
}

void GeneticAlgorithmOptimizer::mutateWithRNG(std::vector<int>& path, int dest, std::mt19937& rng) {
    std::uniform_real_distribution<double> dist(0.0, 1.0);
    if (dist(rng) > config_.mutation_rate || path.size() < 3) return;

    std::uniform_int_distribution<size_t> idx_dist(1, path.size() - 2);
    size_t split_idx = idx_dist(rng);
    int split_node = path[split_idx];

    std::vector<bool> forbidden(graph_.nodeCount(), false);
    for (size_t i = 0; i < split_idx; ++i) {
        forbidden[path[i]] = true;
    }

    std::vector<int> new_suffix = generateRandomDFSPathWithRNG(split_node, dest, rng, forbidden);
    if (!new_suffix.empty()) {
        path.resize(split_idx);
        path.insert(path.end(), new_suffix.begin(), new_suffix.end());
    }
}

void GeneticAlgorithmOptimizer::evaluatePopulation(std::vector<Individual>& population) {
    if (config_.use_cuda) {
        static CUDAFitnessEvaluator cuda_eval;
        static bool graph_initialized = false;
        if (!graph_initialized) {
            cuda_eval.initGraph(graph_);
            graph_initialized = true;
        }
        cuda_eval.evaluatePopulation(population, config_);
    } else {
        int thread_count = 1;
#ifdef _OPENMP
        thread_count = (config_.num_threads > 0) ? config_.num_threads : omp_get_num_procs();
#endif
        #pragma omp parallel for schedule(static) num_threads(thread_count)
        for (int i = 0; i < static_cast<int>(population.size()); ++i) {
            population[i].score = evaluateRoute(population[i].path);
        }
    }
}

Individual GeneticAlgorithmOptimizer::optimizeRoute(int origin_id, int dest_id) {
    telemetry_history_.clear();

    int thread_count = 1;
#ifdef _OPENMP
    if (config_.num_threads > 0) {
        thread_count = config_.num_threads;
        omp_set_num_threads(config_.num_threads);
    } else {
        thread_count = omp_get_num_procs();
        omp_set_num_threads(thread_count);
    }
#endif

    if (config_.verbose_logging) {
        std::cout << "\n========================================================================\n";
        std::cout << "       STARTING GENETIC ALGORITHM ROUTE OPTIMIZATION (" 
                  << (config_.use_cuda ? "CUDA GPU" : "OpenMP CPU") << ")           \n";
        std::cout << "========================================================================\n";
        std::cout << "  Origin Node       : #" << origin_id << " (" << graph_.getNode(origin_id)->name << ")\n";
        std::cout << "  Destination Node  : #" << dest_id << " (" << graph_.getNode(dest_id)->name << ")\n";
        std::cout << "  Population Size   : " << config_.population_size << " chromosomes\n";
        std::cout << "  Max Generations   : " << config_.max_generations << "\n";
        std::cout << "  Mutation Rate     : " << std::fixed << std::setprecision(1) << (config_.mutation_rate * 100.0) << "%\n";
        std::cout << "  Tournament Size   : " << config_.tournament_size << "\n";
        std::cout << "  Execution Engine  : " << (config_.use_cuda ? "CUDA GPU Kernel" : "OpenMP Multi-Core CPU") << "\n";
        std::cout << "========================================================================\n\n" << std::flush;
    }

    auto start_time = std::chrono::high_resolution_clock::now();

    AStarOptimizer seed_optimizer(graph_, config_.fuel_rate_sea, config_.fuel_rate_road);
    auto seed = seed_optimizer.findOptimalRoute(origin_id, dest_id);
    if (!seed.is_valid) {
        std::cerr << "[GA Error] No navigable path between the requested nodes.\n";
        return {};
    }
    if (seed.path.size() == 1) {
        Individual stationary;
        stationary.path = std::move(seed.path);
        stationary.score.is_valid = true;
        return stationary;
    }
    Individual initial;
    initial.path = std::move(seed.path);
    std::vector<Individual> population(config_.population_size, initial);
    #pragma omp parallel for schedule(static) num_threads(thread_count)
    for (std::ptrdiff_t i = 1; i < static_cast<std::ptrdiff_t>(population.size()); ++i) {
        std::mt19937 rng(config_.random_seed + static_cast<std::mt19937::result_type>(i));
        mutateWithRNG(population[i].path, dest_id, rng);
    }

    evaluatePopulation(population);

    std::sort(population.begin(), population.end(), [](const Individual& a, const Individual& b) {
        return a.score.total_cost < b.score.total_cost;
    });

    Individual global_best = population.front();
    size_t elite_count = std::max(size_t(1), static_cast<size_t>(config_.population_size * config_.elitism_ratio));

    int max_threads = 1;
#ifdef _OPENMP
    max_threads = thread_count;
#endif
    std::vector<std::mt19937> thread_rngs(max_threads);
    for (int t = 0; t < max_threads; ++t) {
        thread_rngs[t].seed(config_.random_seed + t * 9973 + 1337);
    }

    for (size_t gen = 0; gen <= config_.max_generations; ++gen) {
        evaluatePopulation(population);

        std::sort(population.begin(), population.end(), [](const Individual& a, const Individual& b) {
            return a.score.total_cost < b.score.total_cost;
        });

        if (population.front().score.total_cost < global_best.score.total_cost) {
            global_best = population.front();
        }

        if (gen == config_.max_generations) break;

        std::vector<Individual> next_generation(config_.population_size);
        for (size_t i = 0; i < elite_count; ++i) {
            next_generation[i] = population[i];
        }

        #pragma omp parallel for schedule(dynamic, 64) num_threads(thread_count)
        for (int i = static_cast<int>(elite_count); i < static_cast<int>(config_.population_size); ++i) {
            int tid = 0;
#ifdef _OPENMP
            tid = omp_get_thread_num();
#endif
            auto& local_rng = thread_rngs[tid % max_threads];

            const Individual& parent1 = tournamentSelectWithRNG(population, local_rng);
            const Individual& parent2 = tournamentSelectWithRNG(population, local_rng);

            size_t local_fb = 0;
            auto child_path = crossoverWithRNG(parent1.path, parent2.path, local_rng, local_fb);
            mutateWithRNG(child_path, dest_id, local_rng);

            next_generation[i].path = std::move(child_path);
        }

        population = std::move(next_generation);
    }

    auto end_time = std::chrono::high_resolution_clock::now();
    double duration_ms = std::chrono::duration<double, std::milli>(end_time - start_time).count();

    if (config_.verbose_logging) {
        std::cout << "[GA Complete] Optimized in " << std::fixed << std::setprecision(2) << duration_ms << " ms.\n";
        printRouteDetails(global_best);
    }
    return global_best;
}

void GeneticAlgorithmOptimizer::printRouteDetails(const Individual& individual) const {
    const auto& score = individual.score;

    std::cout << "\n========================================================================\n";
    std::cout << "                     OPTIMAL MULTIMODAL ROUTE PLAN                     \n";
    std::cout << "========================================================================\n";
    std::cout << "  Overall Objective Cost : $" << std::fixed << std::setprecision(2) << score.total_cost << "\n";
    std::cout << "  Total Physical Distance: " << std::fixed << std::setprecision(2) << score.total_distance_km << " km\n";
    std::cout << "  Total Transit Duration : " << std::fixed << std::setprecision(2) << score.total_transit_hours << " hrs\n";
    std::cout << "  Fuel Cost Breakdown    : $" << std::fixed << std::setprecision(2) << score.total_fuel_cost << "\n";
    std::cout << "  Leg Count Breakdown    : " << score.sea_legs << " Sea Legs | " << score.road_legs << " Road Legs\n";
    std::cout << "========================================================================\n\n";
}

} // namespace RouteOptimizer
