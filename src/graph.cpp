#include "graph.hpp"

#include <fstream>
#include <sstream>
#include <iomanip>
#include <algorithm>
#include <cctype>
#include <cmath>
#include <limits>

namespace RouteOptimizer {

namespace {

// Helper: Trim leading and trailing whitespace and surrounding quotes
std::string trim(const std::string& str) {
    size_t first = str.find_first_not_of(" \t\r\n\"");
    if (first == std::string::npos) return "";
    size_t last = str.find_last_not_of(" \t\r\n\"");
    return str.substr(first, (last - first + 1));
}

// Helper: Convert string to lower case
std::string toLower(std::string s) {
    std::transform(s.begin(), s.end(), s.begin(), [](unsigned char c) {
        return static_cast<char>(std::tolower(c));
    });
    return s;
}

// Helper: Parse a CSV line into fields, respecting quoted strings containing commas
std::vector<std::string> parseCSVLine(const std::string& line) {
    std::vector<std::string> fields;
    std::string field;
    bool in_quotes = false;

    for (size_t i = 0; i < line.size(); ++i) {
        char c = line[i];
        if (c == '"') {
            in_quotes = !in_quotes;
        } else if (c == ',' && !in_quotes) {
            fields.push_back(trim(field));
            field.clear();
        } else {
            field.push_back(c);
        }
    }
    fields.push_back(trim(field));
    return fields;
}

} // anonymous namespace

std::string nodeTypeToString(NodeType type) {
    switch (type) {
        case NodeType::PORT: return "port";
        case NodeType::HUB:  return "hub";
        default:             return "unknown";
    }
}

NodeType stringToNodeType(const std::string& str) {
    std::string s = toLower(trim(str));
    if (s == "port" || s == "sea") return NodeType::PORT;
    if (s == "hub" || s == "road") return NodeType::HUB;
    return NodeType::UNKNOWN;
}

std::string transportModeToString(TransportMode mode) {
    switch (mode) {
        case TransportMode::SEA:  return "sea";
        case TransportMode::ROAD: return "road";
        default:                  return "unknown";
    }
}

TransportMode stringToTransportMode(const std::string& str) {
    std::string s = toLower(trim(str));
    if (s == "sea") return TransportMode::SEA;
    if (s == "road") return TransportMode::ROAD;
    return TransportMode::UNKNOWN;
}

bool MultimodalGraph::loadNodesCSV(const std::string& filepath) {
    std::ifstream file(filepath);
    if (!file.is_open()) {
        std::cerr << "[Graph Error] Failed to open nodes CSV: " << filepath << std::endl;
        return false;
    }

    nodes_.clear();
    node_id_to_index_.clear();
    adj_list_.clear();

    std::string line;
    bool is_header = true;
    int line_num = 0;

    std::vector<Node> temp_nodes;
    int max_node_id = -1;

    while (std::getline(file, line)) {
        line_num++;
        if (line.empty() || line[0] == '#') continue;

        if (is_header) {
            is_header = false;
            // Check if first line contains column names
            std::string lower_line = toLower(line);
            if (lower_line.find("id") != std::string::npos && lower_line.find("lat") != std::string::npos) {
                continue;
            }
        }

        auto tokens = parseCSVLine(line);
        if (tokens.size() < 6) {
            std::cerr << "[Graph Warning] Skipping malformed line " << line_num 
                      << " in " << filepath << " (expected 6 fields, got " << tokens.size() << ")" << std::endl;
            continue;
        }

        try {
            Node node;
            node.id = std::stoi(tokens[0]);
            node.name = tokens[1];
            node.lat = std::stod(tokens[2]);
            node.lon = std::stod(tokens[3]);
            node.region = tokens[4];
            node.node_type = stringToNodeType(tokens[5]);
            // Optional congestion_delay column if 7th field exists, else default 0.0
            if (tokens.size() >= 7) {
                node.congestion_delay = std::stod(tokens[6]);
            } else {
                // Realistic default congestion: major ports get 1.5 - 2.5h handling buffer
                node.congestion_delay = (node.node_type == NodeType::PORT) ? 2.0 : 0.5;
            }
            if (node.id < 0 || node.id == std::numeric_limits<int>::max() ||
                !std::isfinite(node.lat) || std::abs(node.lat) > 90 ||
                !std::isfinite(node.lon) || std::abs(node.lon) > 180 ||
                !std::isfinite(node.congestion_delay) || node.congestion_delay < 0) {
                std::cerr << "[Graph Error] Invalid node values on line " << line_num << "\n";
                return false;
            }

            temp_nodes.push_back(node);
            max_node_id = std::max(max_node_id, node.id);
        } catch (const std::exception& e) {
            std::cerr << "[Graph Error] Exception parsing line " << line_num << ": " << e.what() << std::endl;
            return false;
        }
    }

    if (temp_nodes.empty() || max_node_id < 0) {
        return false;
    }

    // Direct indexing: resize to max_node_id + 1
    nodes_.resize(max_node_id + 1);
    adj_list_.resize(max_node_id + 1);

    for (const auto& n : temp_nodes) {
        if (node_id_to_index_.count(n.id)) {
            std::cerr << "[Graph Error] Duplicate node ID " << n.id << "\n";
            return false;
        }
        nodes_[n.id] = n;
        node_id_to_index_[n.id] = n.id;
    }

    return !nodes_.empty();
}

bool MultimodalGraph::loadEdgesCSV(const std::string& filepath) {
    std::ifstream file(filepath);
    if (!file.is_open()) {
        std::cerr << "[Graph Error] Failed to open edges CSV: " << filepath << std::endl;
        return false;
    }

    all_edges_.clear();
    for (auto& edges : adj_list_) {
        edges.clear();
    }

    std::string line;
    bool is_header = true;
    int line_num = 0;

    while (std::getline(file, line)) {
        line_num++;
        if (line.empty() || line[0] == '#') continue;

        if (is_header) {
            is_header = false;
            std::string lower_line = toLower(line);
            if (lower_line.find("source") != std::string::npos || lower_line.find("from") != std::string::npos) {
                continue;
            }
        }

        auto tokens = parseCSVLine(line);
        if (tokens.size() < 5) {
            std::cerr << "[Graph Warning] Skipping malformed line " << line_num 
                      << " in " << filepath << " (expected 5 fields, got " << tokens.size() << ")" << std::endl;
            continue;
        }

        try {
            Edge edge;
            edge.source_id = std::stoi(tokens[0]);
            edge.dest_id = std::stoi(tokens[1]);
            edge.distance_km = std::stod(tokens[2]);
            edge.base_transit_hours = std::stod(tokens[3]);
            edge.mode = stringToTransportMode(tokens[4]);
            if (!std::isfinite(edge.distance_km) || edge.distance_km < 0 ||
                !std::isfinite(edge.base_transit_hours) || edge.base_transit_hours < 0 ||
                edge.mode == TransportMode::UNKNOWN) {
                std::cerr << "[Graph Error] Invalid edge weight or mode on line " << line_num << "\n";
                return false;
            }

            // Validate endpoints
            if (!hasNode(edge.source_id)) {
                std::cerr << "[Graph Warning] Edge source ID " << edge.source_id << " not in node table (line " << line_num << ")" << std::endl;
                continue;
            }
            if (!hasNode(edge.dest_id)) {
                std::cerr << "[Graph Warning] Edge dest ID " << edge.dest_id << " not in node table (line " << line_num << ")" << std::endl;
                continue;
            }

            all_edges_.push_back(edge);
            adj_list_[edge.source_id].push_back(edge);
        } catch (const std::exception& e) {
            std::cerr << "[Graph Error] Exception parsing edge line " << line_num << ": " << e.what() << std::endl;
            return false;
        }
    }

    return !all_edges_.empty();
}

bool MultimodalGraph::loadFromCSV(const std::string& nodes_csv, const std::string& edges_csv) {
    if (!loadNodesCSV(nodes_csv)) {
        return false;
    }
    if (!loadEdgesCSV(edges_csv)) {
        return false;
    }
    return validateGraph();
}

bool MultimodalGraph::hasNode(int node_id) const {
    return node_id >= 0 && node_id < static_cast<int>(nodes_.size()) && nodes_[node_id].id == node_id;
}

const Node* MultimodalGraph::getNode(int node_id) const {
    if (hasNode(node_id)) {
        return &nodes_[node_id];
    }
    return nullptr;
}

const std::vector<Edge>& MultimodalGraph::getOutgoingEdges(int node_id) const {
    static const std::vector<Edge> empty_edges;
    if (node_id >= 0 && node_id < static_cast<int>(adj_list_.size())) {
        return adj_list_[node_id];
    }
    return empty_edges;
}

const Edge* MultimodalGraph::getEdge(int u, int v) const {
    if (u >= 0 && u < static_cast<int>(adj_list_.size())) {
        for (const auto& e : adj_list_[u]) {
            if (e.dest_id == v) {
                return &e;
            }
        }
    }
    return nullptr;
}

bool MultimodalGraph::isBridgeEdge(const Edge& edge) const {
    const Node* src = getNode(edge.source_id);
    const Node* dst = getNode(edge.dest_id);
    if (!src || !dst) return false;

    return (src->isPort() && dst->isHub()) || (src->isHub() && dst->isPort());
}

bool MultimodalGraph::validateGraph() const {
    if (nodes_.empty()) {
        std::cerr << "[Validation Error] Graph contains 0 nodes." << std::endl;
        return false;
    }
    if (all_edges_.empty()) {
        std::cerr << "[Validation Error] Graph contains 0 edges." << std::endl;
        return false;
    }

    size_t bridge_count = 0;
    for (const auto& e : all_edges_) {
        if (isBridgeEdge(e)) {
            bridge_count++;
        }
    }

    if (bridge_count == 0) {
        std::cerr << "[Validation Warning] No sea<->road bridge edges detected in graph!" << std::endl;
    }

    return true;
}

GraphSummary MultimodalGraph::computeSummary() const {
    GraphSummary s;
    s.total_nodes = 0;
    s.total_edges = all_edges_.size();

    for (const auto& n : nodes_) {
        if (n.id < 0) continue;
        s.total_nodes++;
        if (n.node_type == NodeType::PORT) s.port_nodes++;
        else if (n.node_type == NodeType::HUB) s.hub_nodes++;
        s.nodes_by_region[n.region]++;
    }

    for (const auto& e : all_edges_) {
        if (e.mode == TransportMode::SEA) {
            s.sea_edges++;
        } else if (e.mode == TransportMode::ROAD) {
            s.road_edges++;
        }
        if (isBridgeEdge(e)) {
            s.bridge_edges++;
        }
    }

    s.min_degree = nodes_.empty() ? 0 : 1e9;
    s.max_degree = 0;
    size_t total_out_degree = 0;

    for (const auto& n : nodes_) {
        if (n.id < 0) continue;
        int deg = (n.id < static_cast<int>(adj_list_.size())) ? static_cast<int>(adj_list_[n.id].size()) : 0;
        if (deg == 0) {
            s.isolated_nodes++;
        }
        s.min_degree = std::min(s.min_degree, deg);
        s.max_degree = std::max(s.max_degree, deg);
        total_out_degree += deg;
    }

    s.avg_degree = (s.total_nodes > 0) ? static_cast<double>(total_out_degree) / s.total_nodes : 0.0;
    if (s.min_degree > s.max_degree) s.min_degree = 0;

    return s;
}

void MultimodalGraph::printSummary() const {
    GraphSummary s = computeSummary();

    std::cout << "\n========================================================================\n";
    std::cout << "         GLOBAL SUPPLY CHAIN ROUTE OPTIMIZER - GRAPH SUMMARY           \n";
    std::cout << "========================================================================\n";
    
    std::cout << "\n[NODE INVENTORY]\n";
    std::cout << "  Total Multimodal Nodes : " << std::setw(6) << s.total_nodes << "\n";
    std::cout << "    - Seaports (port)    : " << std::setw(6) << s.port_nodes 
              << " (" << std::fixed << std::setprecision(1) << (100.0 * s.port_nodes / s.total_nodes) << "%)\n";
    std::cout << "    - Inland Hubs (hub)  : " << std::setw(6) << s.hub_nodes 
              << " (" << std::fixed << std::setprecision(1) << (100.0 * s.hub_nodes / s.total_nodes) << "%)\n";
    
    std::cout << "\n[REGIONAL DISTRIBUTION]\n";
    for (const auto& [region, count] : s.nodes_by_region) {
        std::cout << "    - " << std::setw(18) << std::left << region << ": " 
                  << std::setw(5) << std::right << count << " nodes\n";
    }

    std::cout << "\n[EDGE & CONNECTIVITY INVENTORY]\n";
    std::cout << "  Total Directed Edges   : " << std::setw(6) << s.total_edges << "\n";
    std::cout << "    - Sea Lanes (sea)    : " << std::setw(6) << s.sea_edges 
              << " (" << std::fixed << std::setprecision(1) << (100.0 * s.sea_edges / s.total_edges) << "%)\n";
    std::cout << "    - Roadways (road)    : " << std::setw(6) << s.road_edges 
              << " (" << std::fixed << std::setprecision(1) << (100.0 * s.road_edges / s.total_edges) << "%)\n";
    std::cout << "    - Bridge Edges       : " << std::setw(6) << s.bridge_edges 
              << " (Sea Port <-> Inland Hub transitions)\n";

    std::cout << "\n[TOPOLOGY METRICS]\n";
    std::cout << "  Average Degree (out)   : " << std::fixed << std::setprecision(2) << s.avg_degree << "\n";
    std::cout << "  Min / Max Out-Degree   : " << s.min_degree << " / " << s.max_degree << "\n";
    std::cout << "  Isolated Nodes (deg=0) : " << s.isolated_nodes << "\n";

    // Print a few sample bridge connections
    std::cout << "\n[SAMPLE MULTIMODAL BRIDGE CONNECTIONS (PORT <-> HUB)]\n";
    int bridge_samples = 0;
    for (const auto& edge : all_edges_) {
        if (isBridgeEdge(edge)) {
            const Node* src = getNode(edge.source_id);
            const Node* dst = getNode(edge.dest_id);
            if (src && dst) {
                std::cout << "  [" << nodeTypeToString(src->node_type) << "] " 
                          << std::setw(30) << std::left << src->name 
                          << " <---> [" << nodeTypeToString(dst->node_type) << "] " 
                          << std::setw(32) << std::left << dst->name 
                          << " (" << std::setw(6) << std::right << edge.distance_km << " km, " 
                          << std::setw(5) << edge.base_transit_hours << " hrs)\n";
                bridge_samples++;
                if (bridge_samples >= 6) break;
            }
        }
    }

    std::cout << "========================================================================\n\n";
}

void MultimodalGraph::setLaneTimes(const std::vector<double>& times) {
    std::vector<size_t> next_edge(adj_list_.size(), 0);
    for (size_t i = 0; i < all_edges_.size(); ++i) {
        auto& edge = all_edges_[i];
        edge.base_transit_hours = times.at(i);
        const int source = edge.source_id;
        adj_list_[source][next_edge[source]++].base_transit_hours = edge.base_transit_hours;
    }
}

void MultimodalGraph::setNodeCongestionDelay(int node_id, double delay_hours) {
    if (!std::isfinite(delay_hours) || delay_hours < 0) return;
    if (node_id >= 0 && node_id < static_cast<int>(nodes_.size())) {
        nodes_[node_id].congestion_delay = std::max(0.0, delay_hours);
    }
}

bool MultimodalGraph::loadCongestionJSON(const std::string& json_filepath) {
    std::ifstream file(json_filepath);
    if (!file.is_open()) {
        return false;
    }

    std::string content((std::istreambuf_iterator<char>(file)), std::istreambuf_iterator<char>());
    if (content.empty()) return false;

    // Reset all existing congestion delays to 0.0 first
    for (auto& node : nodes_) {
        node.congestion_delay = 0.0;
    }

    size_t loaded_count = 0;

    // Format 1: Direct key-value {"56332": 24.5, "56345": 12.0}
    for (size_t i = 0; i < content.size(); ++i) {
        if (content[i] == '"') {
            size_t key_start = i + 1;
            size_t key_end = content.find('"', key_start);
            if (key_end == std::string::npos) break;
            std::string key = content.substr(key_start, key_end - key_start);

            size_t colon_pos = content.find(':', key_end);
            if (colon_pos == std::string::npos) break;

            size_t val_start = content.find_first_not_of(" \t\r\n", colon_pos + 1);
            if (val_start == std::string::npos) break;

            bool is_numeric_key = !key.empty() && std::all_of(key.begin(), key.end(), [](char c) {
                return std::isdigit(static_cast<unsigned char>(c));
            });

            if (is_numeric_key) {
                size_t val_end = content.find_first_of(",}\r\n \t", val_start);
                std::string val_str = content.substr(val_start, (val_end == std::string::npos ? content.size() : val_end) - val_start);
                try {
                    int node_id = std::stoi(key);
                    double delay = std::stod(val_str);
                    setNodeCongestionDelay(node_id, delay);
                    loaded_count++;
                } catch (...) {}
            }
            i = colon_pos;
        }
    }

    // Format 2: Structured {"delays": [{"node_id": 56332, "delay_hours": 24.0}, ...]}
    size_t pos = 0;
    while ((pos = content.find("node_id", pos)) != std::string::npos) {
        size_t id_colon = content.find(':', pos);
        if (id_colon != std::string::npos) {
            size_t id_val_start = content.find_first_not_of(" \t\r\n", id_colon + 1);
            size_t id_val_end = content.find_first_of(",}\r\n \t", id_val_start);
            if (id_val_start != std::string::npos && id_val_end != std::string::npos) {
                std::string id_str = content.substr(id_val_start, id_val_end - id_val_start);
                size_t delay_pos = content.find("delay_hours", id_val_end);
                if (delay_pos != std::string::npos && delay_pos < content.find('}', id_val_end)) {
                    size_t d_colon = content.find(':', delay_pos);
                    if (d_colon != std::string::npos) {
                        size_t d_val_start = content.find_first_not_of(" \t\r\n", d_colon + 1);
                        size_t d_val_end = content.find_first_of(",}\r\n \t", d_val_start);
                        if (d_val_start != std::string::npos) {
                            std::string d_str = content.substr(d_val_start, (d_val_end == std::string::npos ? content.size() : d_val_end) - d_val_start);
                            try {
                                int nid = std::stoi(id_str);
                                double delay = std::stod(d_str);
                                setNodeCongestionDelay(nid, delay);
                                loaded_count++;
                            } catch (...) {}
                        }
                    }
                }
            }
        }
        pos += 7;
    }

    std::cout << "[Graph] Loaded " << loaded_count << " congestion delay record(s) from " << json_filepath << "\n";
    return true;
}

} // namespace RouteOptimizer
