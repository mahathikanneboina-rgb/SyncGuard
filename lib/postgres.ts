import { Pool, QueryResult, QueryResultRow } from "pg";

/**
 * PostgreSQL connection pool manager for SyncGuard.
 * Uses DATABASE_URL environment variable.
 */

declare global {
  // eslint-disable-next-line no-var
  var _pgPool: Pool | undefined;
}

function createPool(): Pool | null {
  const connectionString = process.env.DATABASE_URL;

  if (!connectionString) {
    return null;
  }

  const isRemote =
    connectionString.includes("neon.tech") ||
    connectionString.includes("supabase.co") ||
    connectionString.includes("render.com") ||
    connectionString.includes("railway.app") ||
    connectionString.includes("sslmode=require") ||
    process.env.PGSSL === "true";

  return new Pool({
    connectionString,
    ssl: isRemote ? { rejectUnauthorized: false } : undefined,
    max: 10,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 5000,
  });
}

const pool = globalThis._pgPool ?? createPool();
if (process.env.NODE_ENV !== "production" && pool) {
  globalThis._pgPool = pool;
}

export function isDatabaseConfigured(): boolean {
  return Boolean(process.env.DATABASE_URL);
}

export async function query<T extends QueryResultRow = QueryResultRow>(
  text: string,
  params?: unknown[]
): Promise<QueryResult<T>> {
  if (!pool) {
    throw new Error(
      "DATABASE_URL environment variable is not configured. Please set DATABASE_URL in .env.local"
    );
  }
  return pool.query<T>(text, params);
}

export async function getClient() {
  if (!pool) {
    throw new Error(
      "DATABASE_URL environment variable is not configured. Please set DATABASE_URL in .env.local"
    );
  }
  return pool.connect();
}

/**
 * Initializes database tables & migrations if they do not exist.
 */
export async function initDatabase(): Promise<{ success: boolean; message: string }> {
  if (!pool) {
    return {
      success: false,
      message: "DATABASE_URL is not configured in .env.local",
    };
  }

  const schemaQuery = `
    CREATE TABLE IF NOT EXISTS users (
      id VARCHAR(255) PRIMARY KEY,
      name VARCHAR(255) NOT NULL,
      email VARCHAR(255) UNIQUE NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS records (
      id VARCHAR(255) PRIMARY KEY,
      title VARCHAR(255) NOT NULL,
      description TEXT,
      value TEXT,
      version INTEGER NOT NULL DEFAULT 1,
      created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

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

    -- Ensure columns exist if migrating from previous schema
    DO $$
    BEGIN
      IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='operations' AND column_name='hash') THEN
        ALTER TABLE operations ADD COLUMN hash VARCHAR(64);
      END IF;
      IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='operations' AND column_name='previous_hash') THEN
        ALTER TABLE operations ADD COLUMN previous_hash VARCHAR(64);
      END IF;
      IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='operations' AND column_name='payload') THEN
        ALTER TABLE operations ADD COLUMN payload JSONB;
      END IF;
    END $$;

    CREATE TABLE IF NOT EXISTS record_versions (
      id VARCHAR(255) PRIMARY KEY,
      record_id VARCHAR(255) NOT NULL,
      version INTEGER NOT NULL,
      title VARCHAR(255) NOT NULL,
      description TEXT,
      value TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

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

    CREATE INDEX IF NOT EXISTS idx_records_updated_at ON records (updated_at DESC);
    CREATE INDEX IF NOT EXISTS idx_record_versions_record_id ON record_versions (record_id, version DESC);
    CREATE INDEX IF NOT EXISTS idx_operations_record_id ON operations (record_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_operations_created_at ON operations (created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_conflict_resolutions_record_id ON conflict_resolutions (record_id, created_at DESC);
  `;

  try {
    await pool.query(schemaQuery);
    return { success: true, message: "Database tables initialized successfully" };
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Unknown database initialization error";
    return { success: false, message: msg };
  }
}