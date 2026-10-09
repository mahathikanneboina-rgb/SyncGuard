-- SyncGuard PostgreSQL Database Schema
-- Phase 6: Central Server, Operations, Version Snapshots, Conflict Resolution & Hash Chain

-- 1. Users Table
CREATE TABLE IF NOT EXISTS users (
    id VARCHAR(255) PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    email VARCHAR(255) UNIQUE NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- 2. Central Records Table
CREATE TABLE IF NOT EXISTS records (
    id VARCHAR(255) PRIMARY KEY,
    title VARCHAR(255) NOT NULL,
    description TEXT,
    value TEXT,
    version INTEGER NOT NULL DEFAULT 1,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- 3. Operations History Table with SHA-256 Hash Chain
CREATE TABLE IF NOT EXISTS operations (
    id VARCHAR(255) PRIMARY KEY,
    record_id VARCHAR(255) NOT NULL,
    operation_type VARCHAR(50) NOT NULL,
    base_version INTEGER,
    new_version INTEGER,
    device_id VARCHAR(255),
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    operation_status VARCHAR(50) NOT NULL DEFAULT 'applied',
    hash VARCHAR(64),
    previous_hash VARCHAR(64),
    payload JSONB
);

-- 4. Record Version History Table
CREATE TABLE IF NOT EXISTS record_versions (
    id VARCHAR(255) PRIMARY KEY,
    record_id VARCHAR(255) NOT NULL,
    version INTEGER NOT NULL,
    title VARCHAR(255) NOT NULL,
    description TEXT,
    value TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- 5. Conflict Resolutions Table
CREATE TABLE IF NOT EXISTS conflict_resolutions (
    id VARCHAR(255) PRIMARY KEY,
    conflict_id VARCHAR(255) NOT NULL,
    record_id VARCHAR(255) NOT NULL,
    original_version INTEGER NOT NULL,
    local_version INTEGER NOT NULL,
    server_version INTEGER NOT NULL,
    resolution_type VARCHAR(50) NOT NULL,
    resolved_value JSONB NOT NULL,
    resolved_by VARCHAR(255),
    final_version INTEGER NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Performance Indexes
CREATE INDEX IF NOT EXISTS idx_records_updated_at ON records (updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_record_versions_record_id ON record_versions (record_id, version DESC);
CREATE INDEX IF NOT EXISTS idx_operations_record_id ON operations (record_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_operations_created_at ON operations (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_conflict_resolutions_record_id ON conflict_resolutions (record_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_conflict_resolutions_created_at ON conflict_resolutions (created_at DESC);