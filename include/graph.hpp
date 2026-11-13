#pragma once

#include <iostream>
#include <string>
#include <vector>
#include <unordered_map>
#include <memory>
#include <optional>

namespace RouteOptimizer {

/**
 * @brief Node classification in multimodal transport network
 */
enum class NodeType {
    PORT,    ///< Seaport or maritime waypoint
    HUB,     ///< Inland logistics hub, railhead, or highway terminal
    UNKNOWN
};

/**
 * @brief Transportation mode for an edge
 */
enum class TransportMode {
    SEA,     ///< Maritime shipping lane
    ROAD,    ///< Highway, regional road, or port connector/drayage
    UNKNOWN
};

// String conversion helpers
std::string nodeTypeToString(NodeType type);
NodeType stringToNodeType(const std::string& str);

std::string transportModeToString(TransportMode mode);
TransportMode stringToTransportMode(const std::string& str);

/**
 * @brief Node representation in multimodal network
 * Requirement 1: id, lat, lon, congestion_delay (double, default 0), region (string), node_type (enum: PORT, HUB)
 */
struct Node {
    int id = -1;
    std::string name;
    double lat = 0.0;
    double lon = 0.0;
    double congestion_delay = 0.0; // Terminal / port congestion buffer in hours
    std::string region;            // "APAC", "EU", "AMERICAS", etc.
    NodeType node_type = NodeType::UNKNOWN;

    bool isPort() const { return node_type == NodeType::PORT; }
    bool isHub() const { return node_type == NodeType::HUB; }
};

/**
 * @brief Directed edge representation in multimodal network
 * Requirement 2: dest_id, distance_km, base_transit_hours, mode (enum: SEA, ROAD)
 */
struct Edge {
    int source_id = -1;
    int dest_id = -1;
    double distance_km = 0.0;
    double base_transit_hours = 0.0;
    TransportMode mode = TransportMode::UNKNOWN;
};

/**
 * @brief Summary statistics for the loaded multimodal graph
 */
struct GraphSummary {
    size_t total_nodes = 0;
    size_t port_nodes = 0;
    size_t hub_nodes = 0;
    std::unordered_map<std::string, size_t> nodes_by_region;

    size_t total_edges = 0;
    size_t sea_edges = 0;
    size_t road_edges = 0;
    size_t bridge_edges = 0; // Edges transitioning between Port and Hub

    size_t isolated_nodes = 0;
    double avg_degree = 0.0;
    int min_degree = 0;
    int max_degree = 0;
};

/**
 * @brief In-memory multimodal supply chain graph
 * Requirement 3: Graph stored as an adjacency list: std::vector<std::vector<Edge>>, indexed directly by node id
 */
class MultimodalGraph {
public:
    MultimodalGraph() = default;

    /**
     * @brief Load nodes and edges from CSV files
     * @param nodes_csv Path to nodes.csv
     * @param edges_csv Path to edges.csv
     * @return true on success, false on failure
     */
    bool loadFromCSV(const std::string& nodes_csv, const std::string& edges_csv);

    /**
     * @brief Validate graph topology and integrity
     * @return true if graph passes all validation checks
     */
    bool validateGraph() const;

    /**
     * @brief Compute and retrieve comprehensive graph summary
     */
    GraphSummary computeSummary() const;

    /**
     * @brief Print human-readable summary table to stdout
     */
    void printSummary() const;

    // Node & Edge Direct Accessors
    const std::vector<Node>& getNodes() const { return nodes_; }
    const std::vector<Edge>& getAllEdges() const { return all_edges_; }
    
    // Direct indexing by node id: Requirement 3
    const std::vector<std::vector<Edge>>& getAdjacencyList() const { return adj_list_; }
    const std::vector<Edge>& getOutgoingEdges(int node_id) const;
    const Node* getNode(int node_id) const;

    // Look up directed edge between u and v
    const Edge* getEdge(int u, int v) const;

    bool hasNode(int node_id) const;
    size_t nodeCount() const { return nodes_.size(); }
    size_t edgeCount() const { return all_edges_.size(); }

    /**
     * @brief Set or update terminal congestion delay for a given node
     */
    void setNodeCongestionDelay(int node_id, double delay_hours);
    void setLaneTimes(const std::vector<double>& times);

    /**
     * @brief Load dynamic congestion delay values from a JSON config file
     * @param json_filepath Path to JSON file
     * @return true on success, false on failure
     */
    bool loadCongestionJSON(const std::string& json_filepath);

    /**
     * @brief Check if an edge is an intermodal bridge (Port <-> Hub)
     */
    bool isBridgeEdge(const Edge& edge) const;

private:
    std::vector<Node> nodes_;                            // Indexed directly by node id
    std::vector<Edge> all_edges_;
    std::vector<std::vector<Edge>> adj_list_;            // Indexed directly by node id (Requirement 3)
    std::unordered_map<int, size_t> node_id_to_index_;

    // CSV parsing helpers
    bool loadNodesCSV(const std::string& filepath);
    bool loadEdgesCSV(const std::string& filepath);
};

} // namespace RouteOptimizer
