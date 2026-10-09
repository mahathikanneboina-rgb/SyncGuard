import type { ServerRecord, RecordVersion, ServerOperation } from "./types";

/**
 * Check if the server database is reachable and healthy
 */
export async function checkServerHealth(): Promise<{
  connected: boolean;
  isConfigured: boolean;
  message?: string;
}> {
  try {
    const res = await fetch("/api/health");
    const data = await res.json();
    return {
      connected: res.ok && data.status === "connected",
      isConfigured: data.isConfigured !== false,
      message: data.error || data.message,
    };
  } catch {
    return {
      connected: false,
      isConfigured: false,
      message: "Server is unreachable or offline",
    };
  }
}

/**
 * Fetch all records stored on the central PostgreSQL server
 */
export async function fetchServerRecords(): Promise<{
  records: ServerRecord[];
  error?: string;
}> {
  try {
    const res = await fetch("/api/records");
    const data = await res.json();
    if (!res.ok) {
      return { records: [], error: data.error || "Failed to fetch server records" };
    }
    return { records: data.records || [] };
  } catch (err) {
    return {
      records: [],
      error: err instanceof Error ? err.message : "Network request failed",
    };
  }
}

/**
 * Fetch past versions for a specific record from PostgreSQL
 */
export async function fetchRecordVersions(
  recordId: string
): Promise<{ versions: RecordVersion[]; error?: string }> {
  try {
    const res = await fetch(`/api/records/${recordId}/versions`);
    const data = await res.json();
    if (!res.ok) {
      return { versions: [], error: data.error || "Failed to fetch versions" };
    }
    return { versions: data.versions || [] };
  } catch (err) {
    return {
      versions: [],
      error: err instanceof Error ? err.message : "Network request failed",
    };
  }
}

/**
 * Fetch the operation history log from PostgreSQL
 */
export async function fetchServerOperations(): Promise<{
  operations: ServerOperation[];
  error?: string;
}> {
  try {
    const res = await fetch("/api/operations");
    const data = await res.json();
    if (!res.ok) {
      return { operations: [], error: data.error || "Failed to fetch operations" };
    }
    return { operations: data.operations || [] };
  } catch (err) {
    return {
      operations: [],
      error: err instanceof Error ? err.message : "Network request failed",
    };
  }
}