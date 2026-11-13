#pragma once

#include "graph.hpp"
#include "ga.hpp"
#include <string>
#include <vector>
#include <memory>
#include <chrono>

namespace RouteOptimizer {

/**
 * @brief Tag constants for MPI message passing
 */
constexpr int MPI_TAG_VEHICLE_HANDOFF = 100;
constexpr int MPI_TAG_TERMINATION     = 101;
constexpr int MPI_TAG_RESULT_COLLECT  = 102;

/**
 * @brief Cross-region boundary edge (connects two distinct regions)
 * Requirement 2: Boundary edges kept in a separate structure, not inside any single rank's adjacency list.
 */
struct BoundaryEdge {
    int source_id = -1;
    int dest_id = -1;
    std::string source_region;
    std::string dest_region;
    int source_rank = -1;
    int dest_rank = -1;
    double distance_km = 0.0;
    double base_transit_hours = 0.0;
    TransportMode mode = TransportMode::UNKNOWN;
};

/**
 * @brief Vehicle state packet passed across regional boundaries
 * Requirement 3: VehicleState struct (currentNodeId, fuelUsed, timeElapsed)
 */
struct VehicleState {
    int vehicle_id = 0;              ///< Unique route/vehicle tracking identifier
    int current_node_id = -1;        ///< Current location at region boundary
    int target_dest_id = -1;         ///< Final ultimate destination node ID
    double fuel_used = 0.0;          ///< Accumulated fuel cost ($)
    double time_elapsed = 0.0;       ///< Accumulated transit duration (hrs)
    double total_distance_km = 0.0;  ///< Accumulated distance traversed (km)
    int mode_switches = 0;           ///< Accumulated mode switch count
    int prev_mode = -1;              ///< Previous transport mode (0=SEA, 1=ROAD, -1=UNKNOWN)
    int path_length = 0;             ///< Number of node hops recorded so far
    int path_nodes[4096] = {0};      ///< Sequential array of node IDs
    int source_rank = 0;             ///< Origin rank
    int dest_rank = 0;               ///< Destination rank
    bool is_completed = false;       ///< True when target_dest_id is reached
};

/**
 * @brief Regional partition manager for MPI distributed execution
 * Requirement 1: Rank 0 = APAC, Rank 1 = EU, Rank 2 = AMERICAS (supports fewer ranks too)
 */
class RegionalPartitionManager {
public:
    RegionalPartitionManager(int rank, int world_size);

    /**
     * @brief Assign regions to a given MPI rank
     */
    static std::vector<std::string> getAssignedRegionsForRank(int rank, int world_size);

    /**
     * @brief Determine which rank owns a given region
     */
    static int getRankForRegion(const std::string& region, int world_size);

    /**
     * @brief Check if a node's region is assigned to this rank
     */
    bool isNodeLocal(const Node& node) const;

    /**
     * @brief Extract regional subgraph for this rank and separate boundary edges
     * Requirement 1 & 2: Subgraph contains only local nodes/edges; boundary edges kept separate.
     */
    void partitionGraph(
        const MultimodalGraph& full_graph,
        MultimodalGraph& out_local_subgraph,
        std::vector<BoundaryEdge>& out_boundary_edges
    ) const;

    int getRank() const { return rank_; }
    int getWorldSize() const { return world_size_; }
    const std::vector<std::string>& getAssignedRegions() const { return assigned_regions_; }

private:
    int rank_ = 0;
    int world_size_ = 1;
    std::vector<std::string> assigned_regions_;
};

/**
 * @brief MPI Distributed Controller
 */
class MPIController {
public:
    MPIController(int* argc, char*** argv);
    ~MPIController();

    int getRank() const { return rank_; }
    int getWorldSize() const { return world_size_; }
    bool isRoot() const { return rank_ == 0; }
    bool isMPIActive() const { return is_mpi_initialized_; }
    Individual bestRoute(const Individual& local) const;

    /**
     * @brief Send VehicleState to another rank via MPI_Send
     */
    void sendVehicleState(const VehicleState& vehicle, int dest_rank);

    /**
     * @brief Poll and receive VehicleState from any rank (or specific rank)
     */
    bool probeAndReceiveVehicleState(VehicleState& out_vehicle, int source_rank = -1);

    /**
     * @brief Barrier synchronization
     */
    void synchronize();

private:
    int rank_ = 0;
    int world_size_ = 1;
    bool is_mpi_initialized_ = false;
};

/**
 * @brief Run OpenMP parallel vs single-threaded benchmark comparison
 * Requirement 6: Basic timing instrumentation logging wall-clock time with OpenMP on vs off
 */
void runOpenMPBenchmark(
    const MultimodalGraph& graph,
    int origin_id,
    int dest_id,
    const GAConfig& base_config
);

} // namespace RouteOptimizer
