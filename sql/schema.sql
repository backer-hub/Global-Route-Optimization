-- =============================================================================
-- Global Supply Chain Route Optimizer — MySQL Database Schema
-- =============================================================================

CREATE DATABASE IF NOT EXISTS route_optimizer_db
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;

USE route_optimizer_db;

-- -----------------------------------------------------------------------------
-- 1. Nodes Table (Multimodal Seaports, Waypoints & Inland Logistics Hubs)
-- -----------------------------------------------------------------------------
DROP TABLE IF EXISTS congestion_events;
DROP TABLE IF EXISTS route_history;
DROP TABLE IF EXISTS edges;
DROP TABLE IF EXISTS nodes;

CREATE TABLE nodes (
    id INT NOT NULL PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    lat DECIMAL(10, 6) NOT NULL,
    lon DECIMAL(10, 6) NOT NULL,
    region VARCHAR(32) NOT NULL DEFAULT 'APAC',
    congestion_delay DOUBLE NOT NULL DEFAULT 0.0,
    node_type VARCHAR(16) NOT NULL DEFAULT 'port',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_region (region),
    INDEX idx_node_type (node_type),
    INDEX idx_congestion (congestion_delay)
) ENGINE=InnoDB;

-- -----------------------------------------------------------------------------
-- 2. Edges Table (Maritime Lanes, Highway Corridors & Intermodal Bridges)
-- -----------------------------------------------------------------------------
CREATE TABLE edges (
    id INT AUTO_INCREMENT PRIMARY KEY,
    source_id INT NOT NULL,
    dest_id INT NOT NULL,
    distance_km DOUBLE NOT NULL,
    base_transit_hours DOUBLE NOT NULL,
    mode VARCHAR(16) NOT NULL DEFAULT 'sea',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (source_id) REFERENCES nodes(id) ON DELETE CASCADE,
    FOREIGN KEY (dest_id) REFERENCES nodes(id) ON DELETE CASCADE,
    INDEX idx_src_dest (source_id, dest_id),
    INDEX idx_mode (mode)
) ENGINE=InnoDB;

-- -----------------------------------------------------------------------------
-- 3. Route History Table (Historical Optimization Runs)
-- -----------------------------------------------------------------------------
CREATE TABLE route_history (
    id INT AUTO_INCREMENT PRIMARY KEY,
    run_timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    source_id INT NOT NULL,
    dest_id INT NOT NULL,
    total_cost DOUBLE NOT NULL,
    total_distance_km DOUBLE NOT NULL DEFAULT 0.0,
    total_transit_hours DOUBLE NOT NULL DEFAULT 0.0,
    fuel_cost DOUBLE NOT NULL DEFAULT 0.0,
    mode_switches INT NOT NULL DEFAULT 0,
    path_json JSON NOT NULL COMMENT 'Array of ordered node IDs, e.g. [56332, 19943, 56345]',
    execution_time_ms DOUBLE NOT NULL DEFAULT 0.0,
    engine VARCHAR(32) NOT NULL DEFAULT 'CUDA',
    INDEX idx_src_dst (source_id, dest_id),
    INDEX idx_timestamp (run_timestamp)
) ENGINE=InnoDB;

-- -----------------------------------------------------------------------------
-- 4. Congestion Events Table (Disruption Incident Logs)
-- -----------------------------------------------------------------------------
CREATE TABLE congestion_events (
    id INT AUTO_INCREMENT PRIMARY KEY,
    node_id INT NOT NULL,
    delay_hours DOUBLE NOT NULL,
    event_type VARCHAR(64) NOT NULL COMMENT 'e.g. port_strike, weather_delay, customs_slowdown',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (node_id) REFERENCES nodes(id) ON DELETE CASCADE,
    INDEX idx_node_event (node_id, event_type),
    INDEX idx_created (created_at)
) ENGINE=InnoDB;

-- =============================================================================
-- SEED DATA IMPORT SCRIPT (LOAD DATA INFILE)
-- Replace the path with the absolute file path on your local / server instance:
-- =============================================================================
-- LOAD DATA LOCAL INFILE '/path/to/data/nodes.csv'
-- INTO TABLE nodes
-- FIELDS TERMINATED BY ',' 
-- ENCLOSED BY '"'
-- LINES TERMINATED BY '\n'
-- IGNORE 1 ROWS
-- (id, name, lat, lon, region, node_type);
--
-- LOAD DATA LOCAL INFILE '/path/to/data/edges.csv'
-- INTO TABLE edges
-- FIELDS TERMINATED BY ',' 
-- ENCLOSED BY '"'
-- LINES TERMINATED BY '\n'
-- IGNORE 1 ROWS
-- (source_id, dest_id, distance_km, base_transit_hours, mode);
