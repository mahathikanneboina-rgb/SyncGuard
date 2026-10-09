/**
 * conflicts.ts - Conflict explanation generator and resolution coordinator
 */

import type {
  ConflictDetail,
  ConflictResolutionType,
  ConflictResolutionRecord,
} from "./types";
import { resolveConflictInDb, getConflictById } from "./db";
import { getDeviceId } from "./device";
import { getSyncEngine } from "./syncEngine";

export interface FieldComparison {
  name: string;
  key: "title" | "description" | "value";
  original: string;
  local: string;
  server: string;
  status: "unchanged" | "changed_locally" | "changed_on_server" | "conflict";
}

/**
 * Generates field-level diffs between Original, Local, and Server records
 */
export function computeFieldComparisons(conflict: ConflictDetail): FieldComparison[] {
  const fields: Array<{ name: string; key: "title" | "description" | "value" }> = [
    { name: "Title", key: "title" },
    { name: "Description", key: "description" },
    { name: "Value / Stock", key: "value" },
  ];

  return fields.map((f) => {
    const orig = (conflict.original_record?.[f.key] ?? "").trim();
    const local = (conflict.local_changes?.[f.key] ?? "").trim();
    const server = (conflict.server_changes?.[f.key] ?? "").trim();

    const localChanged = local !== orig;
    const serverChanged = server !== orig;

    let status: FieldComparison["status"] = "unchanged";
    if (localChanged && serverChanged) {
      status = local === server ? "unchanged" : "conflict";
    } else if (localChanged) {
      status = "changed_locally";
    } else if (serverChanged) {
      status = "changed_on_server";
    }

    return {
      name: f.name,
      key: f.key,
      original: orig || "(empty)",
      local: local || "(empty)",
      server: server || "(empty)",
      status,
    };
  });
}

/**
 * Generates a clear, dynamic human-readable conflict explanation
 */
export function generateConflictExplanation(conflict: ConflictDetail): string {
  const origVer = conflict.original_version;
  const localVer = conflict.local_version;
  const serverVer = conflict.server_version;
  const device = conflict.device_id || "Current Device";

  const diffs = computeFieldComparisons(conflict);
  const conflictingFields = diffs.filter((d) => d.status === "conflict");

  let fieldSummary = "";
  if (conflictingFields.length > 0) {
    fieldSummary = conflictingFields
      .map(
        (f) =>
          `The field "${f.name}" was modified concurrently: this device changed it to "${f.local}", while the server already accepted "${f.server}" (originally "${f.original}").`
      )
      .join(" ");
  } else {
    fieldSummary = "Independent fields were updated concurrently on both sides without overlapping values.";
  }

  return `Why did this conflict happen?

This record was originally at version ${origVer} when both devices were working offline.

Another device synchronized first and advanced the central record to version ${serverVer}.

When this device (${device}) attempted to synchronize local version ${localVer} using base version ${origVer}, SyncGuard detected that the server was already ahead at version ${serverVer}.

${fieldSummary}

SyncGuard prevented silent data loss and preserved both versions for your review.`;
}

/**
 * Execute conflict resolution (Keep Local | Keep Server | Manual Merge)
 */
export async function executeConflictResolution(params: {
  conflictId: string;
  recordId: string;
  resolutionType: ConflictResolutionType;
  resolvedValue: {
    title: string;
    description: string;
    value: string;
  };
  originalVersion: number;
  localVersion: number;
  serverVersion: number;
}): Promise<{ success: boolean; finalVersion?: number; error?: string }> {
  const deviceId = getDeviceId();

  try {
    // 1. Send resolution to server if online
    if (navigator.onLine) {
      const res = await fetch(`/api/conflicts/${params.conflictId}/resolve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          recordId: params.recordId,
          resolutionType: params.resolutionType,
          resolvedValue: params.resolvedValue,
          originalVersion: params.originalVersion,
          localVersion: params.localVersion,
          serverVersion: params.serverVersion,
          resolvedBy: deviceId,
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        return { success: false, error: data.error || "Server resolution failed" };
      }

      const finalVer = data.finalVersion || params.serverVersion + 1;

      // 2. Update local IndexedDB
      await resolveConflictInDb(params.conflictId, {
        type: params.resolutionType,
        resolvedValue: params.resolvedValue,
        finalVersion: finalVer,
        resolvedBy: deviceId,
      });

      // 3. Refresh sync engine
      getSyncEngine().runSync();

      return { success: true, finalVersion: finalVer };
    } else {
      // Offline resolution: save into IndexedDB, will be synchronized when reconnected
      const finalVer = Math.max(params.localVersion, params.serverVersion) + 1;
      await resolveConflictInDb(params.conflictId, {
        type: params.resolutionType,
        resolvedValue: params.resolvedValue,
        finalVersion: finalVer,
        resolvedBy: deviceId,
      });

      return { success: true, finalVersion: finalVer };
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Resolution error";
    return { success: false, error: msg };
  }
}

/**
 * Fetch conflict resolution audit history from server
 */
export async function fetchConflictHistory(): Promise<{
  history: ConflictResolutionRecord[];
  error?: string;
}> {
  try {
    const res = await fetch("/api/conflicts/history");
    const data = await res.json();
    if (!res.ok) {
      return { history: [], error: data.error || "Failed to fetch history" };
    }
    return { history: data.history || [] };
  } catch (err) {
    return {
      history: [],
      error: err instanceof Error ? err.message : "Network error",
    };
  }
}
