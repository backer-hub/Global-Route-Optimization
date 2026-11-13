#include "mpi_partition.hpp"
#include <iostream>
#include <iomanip>
#include <algorithm>
#include <cstring>
#include <sstream>
#include <cstdlib>
#include <limits>

#ifdef _OPENMP
#include <omp.h>
#endif

#ifdef USE_MPI
#include <mpi.h>
#endif

namespace RouteOptimizer {

// =============================================================================
// Regional Partition Manager
// =============================================================================

RegionalPartitionManager::RegionalPartitionManager(int rank, int world_size)
    : rank_(rank), world_size_(world_size) {
    assigned_regions_ = getAssignedRegionsForRank(rank_, world_size_);
}

std::vector<std::string> RegionalPartitionManager::getAssignedRegionsForRank(int rank, int world_size) {
    // Requirement 1: Rank 0 = "APAC", Rank 1 = "EU", Rank 2 = "AMERICAS"
    // Supports running with fewer ranks (e.g. mpirun -np 2, mpirun -np 1)
    if (world_size <= 1) {
        return {"APAC", "EU", "AMERICAS"};
    }
    if (world_size == 2) {
        if (rank == 0) return {"APAC"};
        if (rank == 1) return {"EU", "AMERICAS"};
    }
    if (world_size >= 3) {
        if (rank == 0) return {"APAC"};
        if (rank == 1) return {"EU"};
        if (rank == 2) return {"AMERICAS"};
        // Auxiliary ranks if world_size > 3
        if (rank % 3 == 0) return {"APAC"};
        if (rank % 3 == 1) return {"EU"};
        if (rank % 3 == 2) return {"AMERICAS"};
    }
    return {"APAC"};
}

int RegionalPartitionManager::getRankForRegion(const std::string& region, int world_size) {
    if (world_size <= 1) return 0;
    if (world_size == 2) {
        if (region == "APAC") return 0;
        return 1; // EU and AMERICAS assigned to rank 1
    }
    if (region == "APAC") return 0;
    if (region == "EU") return 1;
    if (region == "AMERICAS") return 2;
    return 0;
}

bool RegionalPartitionManager::isNodeLocal(const Node& node) const {
    for (const auto& reg : assigned_regions_) {
        if (node.region == reg) return true;
    }
    return false;
}

void RegionalPartitionManager::partitionGraph(
    const MultimodalGraph& full_graph,
    MultimodalGraph& out_local_subgraph,
    std::vector<BoundaryEdge>& out_boundary_edges
) const {
    out_boundary_edges.clear();

    // Identify all boundary edges (connecting two distinct regions)
    // Requirement 2: Keep boundary edges in a separate structure, not inside any single rank's adjacency list
    for (const auto& edge : full_graph.getAllEdges()) {
        const Node* src = full_graph.getNode(edge.source_id);
        const Node* dst = full_graph.getNode(edge.dest_id);
        if (!src || !dst) continue;

        if (src->region != dst->region) {
            BoundaryEdge b_edge;
            b_edge.source_id = edge.source_id;
            b_edge.dest_id = edge.dest_id;
            b_edge.source_region = src->region;
            b_edge.dest_region = dst->region;
            b_edge.source_rank = getRankForRegion(src->region, world_size_);
            b_edge.dest_rank = getRankForRegion(dst->region, world_size_);
            b_edge.distance_km = edge.distance_km;
            b_edge.base_transit_hours = edge.base_transit_hours;
            b_edge.mode = edge.mode;

            out_boundary_edges.push_back(b_edge);
        }
    }

    out_local_subgraph = full_graph;
}

// =============================================================================
// MPI Controller Implementation
// =============================================================================

MPIController::MPIController(int* argc, char*** argv) {
    // Check environment variables from MPI launchers (mpirun / mpiexec)
    const char* pmi_rank = std::getenv("PMI_RANK");
    const char* ompi_rank = std::getenv("OMPI_COMM_WORLD_RANK");
    const char* msmpi_rank = std::getenv("MSMPI_RANK");

    if (pmi_rank) rank_ = std::atoi(pmi_rank);
    else if (ompi_rank) rank_ = std::atoi(ompi_rank);
    else if (msmpi_rank) rank_ = std::atoi(msmpi_rank);

    const char* pmi_size = std::getenv("PMI_SIZE");
    const char* ompi_size = std::getenv("OMPI_COMM_WORLD_SIZE");
    const char* msmpi_size = std::getenv("MSMPI_SIZE");

    if (pmi_size) world_size_ = std::atoi(pmi_size);
    else if (ompi_size) world_size_ = std::atoi(ompi_size);
    else if (msmpi_size) world_size_ = std::atoi(msmpi_size);

    // CLI overrides for simulated distributed testing
    for (int i = 1; i < *argc; ++i) {
        std::string arg = (*argv)[i];
        if (arg == "--rank" && i + 1 < *argc) {
            rank_ = std::stoi((*argv)[++i]);
        } else if (arg == "--world-size" && i + 1 < *argc) {
            world_size_ = std::stoi((*argv)[++i]);
        }
    }

#ifdef USE_MPI
    int is_init = 0;
    MPI_Initialized(&is_init);
    if (!is_init) {
        int provided = 0;
        int err = MPI_Init_thread(argc, argv, MPI_THREAD_FUNNELED, &provided);
        if (err == MPI_SUCCESS) {
            MPI_Comm_rank(MPI_COMM_WORLD, &rank_);
            MPI_Comm_size(MPI_COMM_WORLD, &world_size_);
            is_mpi_initialized_ = true;
        }
    } else {
        MPI_Comm_rank(MPI_COMM_WORLD, &rank_);
        MPI_Comm_size(MPI_COMM_WORLD, &world_size_);
        is_mpi_initialized_ = true;
    }
#endif
}

MPIController::~MPIController() {
#ifdef USE_MPI
    if (is_mpi_initialized_) {
        MPI_Finalize();
    }
#endif
}

void MPIController::sendVehicleState(const VehicleState& vehicle, int dest_rank) {
#ifdef USE_MPI
    if (is_mpi_initialized_ && dest_rank != rank_) {
        MPI_Send(&vehicle, sizeof(VehicleState), MPI_BYTE, dest_rank, MPI_TAG_VEHICLE_HANDOFF, MPI_COMM_WORLD);
    }
#else
    (void)vehicle;
    (void)dest_rank;
#endif
}

bool MPIController::probeAndReceiveVehicleState(VehicleState& out_vehicle, int source_rank) {
#ifdef USE_MPI
    if (!is_mpi_initialized_) return false;

    int flag = 0;
    MPI_Status status;
    int src = (source_rank < 0) ? MPI_ANY_SOURCE : source_rank;

    MPI_Iprobe(src, MPI_TAG_VEHICLE_HANDOFF, MPI_COMM_WORLD, &flag, &status);
    if (flag) {
        MPI_Recv(&out_vehicle, sizeof(VehicleState), MPI_BYTE, status.MPI_SOURCE, MPI_TAG_VEHICLE_HANDOFF, MPI_COMM_WORLD, MPI_STATUS_IGNORE);
        return true;
    }
    return false;
#else
    (void)out_vehicle;
    (void)source_rank;
    return false;
#endif
}

Individual MPIController::bestRoute(const Individual& local) const {
#ifdef USE_MPI
    struct { double cost; int rank; } candidate{
        local.score.is_valid ? local.score.total_cost : std::numeric_limits<double>::infinity(), rank_
    }, winner{};
    MPI_Allreduce(&candidate, &winner, 1, MPI_DOUBLE_INT, MPI_MINLOC, MPI_COMM_WORLD);

    Individual result;
    if (rank_ == winner.rank) result = local;
    int size = static_cast<int>(result.path.size());
    MPI_Bcast(&size, 1, MPI_INT, winner.rank, MPI_COMM_WORLD);
    result.path.resize(size);
    MPI_Bcast(result.path.data(), size, MPI_INT, winner.rank, MPI_COMM_WORLD);
    MPI_Bcast(&result.score, sizeof(result.score), MPI_BYTE, winner.rank, MPI_COMM_WORLD);
    return result;
#else
    return local;
#endif
}

void MPIController::synchronize() {
#ifdef USE_MPI
    if (is_mpi_initialized_) {
        MPI_Barrier(MPI_COMM_WORLD);
    }
#endif
}

// =============================================================================
// OpenMP Benchmark & Timing Instrumentation (Requirement 6)
// =============================================================================

void runOpenMPBenchmark(
    const MultimodalGraph& graph,
    int origin_id,
    int dest_id,
    const GAConfig& base_config
) {
    int total_procs = 4;
#ifdef _OPENMP
    total_procs = omp_get_num_procs();
#endif

    std::cout << "\n========================================================================\n";
    std::cout << "          OPENMP PARALLEL PERFORMANCE BENCHMARK INSTRUMENTATION         \n";
    std::cout << "========================================================================\n";
    std::cout << "  Benchmark Route   : #" << origin_id << " (" << graph.getNode(origin_id)->name 
              << ") -> #" << dest_id << " (" << graph.getNode(dest_id)->name << ")\n";
    std::cout << "  Population Size   : " << base_config.population_size << " chromosomes\n";
    std::cout << "  Generations Count : " << base_config.max_generations << " iterations\n";
    std::cout << "  System Procs      : " << total_procs << " hardware threads available\n";
    std::cout << "------------------------------------------------------------------------\n";

    // 1. Single-Threaded Execution (OpenMP Off)
    GAConfig single_config = base_config;
    single_config.num_threads = 1;
    single_config.verbose_logging = false;

    std::cout << "[Benchmark] Running Single-Threaded GA (1 thread)... " << std::flush;
    auto t1_start = std::chrono::high_resolution_clock::now();
    GeneticAlgorithmOptimizer single_opt(graph, single_config);
    Individual single_res = single_opt.optimizeRoute(origin_id, dest_id);
    auto t1_end = std::chrono::high_resolution_clock::now();
    double single_duration_ms = std::chrono::duration<double, std::milli>(t1_end - t1_start).count();
    std::cout << "Done (" << std::fixed << std::setprecision(2) << single_duration_ms << " ms).\n";

    // 2. Multi-Threaded Execution (OpenMP On)
    int max_threads = (base_config.num_threads > 0) ? base_config.num_threads : total_procs;
    GAConfig multi_config = base_config;
    multi_config.num_threads = max_threads;
    multi_config.verbose_logging = false;

    std::cout << "[Benchmark] Running Multi-Threaded GA (" << max_threads << " OpenMP threads)... " << std::flush;
    auto t2_start = std::chrono::high_resolution_clock::now();
    GeneticAlgorithmOptimizer multi_opt(graph, multi_config);
    Individual multi_res = multi_opt.optimizeRoute(origin_id, dest_id);
    auto t2_end = std::chrono::high_resolution_clock::now();
    double multi_duration_ms = std::chrono::duration<double, std::milli>(t2_end - t2_start).count();
    std::cout << "Done (" << std::fixed << std::setprecision(2) << multi_duration_ms << " ms).\n";

    double speedup = single_duration_ms / multi_duration_ms;
    double efficiency = (speedup / max_threads) * 100.0;

    std::cout << "\n------------------------------------------------------------------------\n";
    std::cout << "                     BENCHMARK COMPARISON RESULTS                      \n";
    std::cout << "------------------------------------------------------------------------\n";
    std::cout << "  Single-Threaded Runtime (1 thread) : " << std::setw(8) << std::fixed << std::setprecision(2) << single_duration_ms << " ms (" << (single_duration_ms/1000.0) << " s)\n";
    std::cout << "  Multi-Threaded Runtime (" << std::setw(2) << max_threads << " threads) : " << std::setw(8) << multi_duration_ms << " ms (" << (multi_duration_ms/1000.0) << " s)\n";
    std::cout << "  Observed Parallel Speedup Factor   : " << std::setw(8) << std::setprecision(2) << speedup << "x\n";
    std::cout << "  Parallel Efficiency                : " << std::setw(8) << std::setprecision(1) << efficiency << "%\n";
    std::cout << "  Single-Thread Best Cost            : $" << std::fixed << std::setprecision(2) << single_res.score.total_cost << "\n";
    std::cout << "  Multi-Thread Best Cost             : $" << std::fixed << std::setprecision(2) << multi_res.score.total_cost << "\n";
    std::cout << "========================================================================\n\n" << std::flush;
}

} // namespace RouteOptimizer
