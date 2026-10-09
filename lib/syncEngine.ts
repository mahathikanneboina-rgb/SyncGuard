/**
 * syncEngine.ts - Core Client-Side Synchronization Engine for SyncGuard
 *
 * Implements:
 * 1. State machine: Synced | Pending | Synchronizing | Conflict | Failed | Offline
 * 2. Upload Phase: Ordered processing of local pending operations queue
 * 3. Download Phase: Pull and merge newer server changes into IndexedDB
 * 4. Optimistic Concurrency & Conflict Detection (409 handling & conflict storage)
 * 5. Idempotent communication & Retry mechanism
 * 6. Live event notification & sync activity logging
 */

import type {
  SyncEngineStatus,
  PendingOperation,
  SyncRecord,
  ConflictDetail,
  ServerRecord,
} from "./types";
import {
  getAllRecords,
  saveRecordDirect,
  updateRecordSyncState,
  getPendingOperations,
  getAllOperations,
  updateOperationStatus,
  saveConflict,
  getUnresolvedConflicts,
  logActivity,
  setMeta,
  getMeta,
} from "./db";

export type SyncEventListener = (state: {
  status: SyncEngineStatus;
  isOnline: boolean;
  pendingCount: number;
  conflictCount: number;
  failedCount: number;
  lastSyncTime: string | null;
}) => void;

class SyncEngine {
  private isSynchronizing = false;
  private listeners: Set<SyncEventListener> = new Set();
  private lastSyncTime: string | null = null;

  constructor() {
    if (typeof window !== "undefined") {
      // Auto-sync when network returns
      window.addEventListener("online", () => {
        logActivity("Connection restored", "Device is online. Triggering synchronization.", "sync_start");
        this.runSync();
      });

      window.addEventListener("offline", () => {
        logActivity("Device went offline", "Offline mode active. Mutations will be queued in IndexedDB.", "change_queued");
        this.notify();
      });

      // Load last sync time from metadata store
      getMeta<string>("last_sync_time").then((time) => {
        if (time) this.lastSyncTime = time;
        this.notify();
      });
    }
  }

  public subscribe(listener: SyncEventListener): () => void {
    this.listeners.add(listener);
    this.getEngineState().then((state) => listener(state));
    return () => {
      this.listeners.delete(listener);
    };
  }

  public async notify(): Promise<void> {
    const state = await this.getEngineState();
    for (const listener of this.listeners) {
      listener(state);
    }
  }

  public async getEngineState(): Promise<{
    status: SyncEngineStatus;
    isOnline: boolean;
    pendingCount: number;
    conflictCount: number;
    failedCount: number;
    lastSyncTime: string | null;
  }> {
    if (typeof window === "undefined") {
      return {
        status: "synced",
        isOnline: true,
        pendingCount: 0,
        conflictCount: 0,
        failedCount: 0,
        lastSyncTime: this.lastSyncTime,
      };
    }

    const isOnline = navigator.onLine;

    if (!isOnline) {
      const ops = await getAllOperations();
      const conflicts = await getUnresolvedConflicts();
      const pendingOps = ops.filter((o) => o.status === "pending" || o.status === "in_flight");
      const failedOps = ops.filter((o) => o.status === "failed");

      return {
        status: "offline",
        isOnline: false,
        pendingCount: pendingOps.length,
        conflictCount: conflicts.length,
        failedCount: failedOps.length,
        lastSyncTime: this.lastSyncTime,
      };
    }

    if (this.isSynchronizing) {
      const ops = await getAllOperations();
      const conflicts = await getUnresolvedConflicts();
      const pendingOps = ops.filter((o) => o.status === "pending" || o.status === "in_flight");
      const failedOps = ops.filter((o) => o.status === "failed");

      return {
        status: "synchronizing",
        isOnline: true,
        pendingCount: pendingOps.length,
        conflictCount: conflicts.length,
        failedCount: failedOps.length,
        lastSyncTime: this.lastSyncTime,
      };
    }

    const ops = await getAllOperations();
    const conflicts = await getUnresolvedConflicts();
    const pendingOps = ops.filter((o) => o.status === "pending" || o.status === "in_flight");
    const failedOps = ops.filter((o) => o.status === "failed");

    let status: SyncEngineStatus = "synced";
    if (conflicts.length > 0) {
      status = "conflict";
    } else if (failedOps.length > 0) {
      status = "failed";
    } else if (pendingOps.length > 0) {
      status = "pending";
    }

    return {
      status,
      isOnline: true,
      pendingCount: pendingOps.length,
      conflictCount: conflicts.length,
      failedCount: failedOps.length,
      lastSyncTime: this.lastSyncTime,
    };
  }

  /**
   * Main synchronization routine:
   * 1. Upload local pending operations to PostgreSQL
   * 2. Download newer server records
   * 3. Record conflict details without overwriting
   */
  public async runSync(): Promise<{
    success: boolean;
    appliedCount: number;
    conflictCount: number;
    failedCount: number;
    pulledCount: number;
  }> {
    if (typeof window === "undefined") {
      return { success: false, appliedCount: 0, conflictCount: 0, failedCount: 0, pulledCount: 0 };
    }

    if (!navigator.onLine) {
      await logActivity(
        "Sync skipped",
        "Cannot synchronize while browser is offline",
        "sync_start"
      );
      this.notify();
      return { success: false, appliedCount: 0, conflictCount: 0, failedCount: 0, pulledCount: 0 };
    }

    if (this.isSynchronizing) {
      return { success: false, appliedCount: 0, conflictCount: 0, failedCount: 0, pulledCount: 0 };
    }

    this.isSynchronizing = true;
    await this.notify();
    await logActivity("Synchronization started", "Uploading pending changes and syncing with PostgreSQL", "sync_start");

    let appliedCount = 0;
    let conflictCount = 0;
    let failedCount = 0;
    let pulledCount = 0;

    try {
      // ----------------------------------------------------
      // PHASE 1: UPLOAD LOCAL OPERATIONS IN CHRONOLOGICAL ORDER
      // ----------------------------------------------------
      const pendingOps = await getPendingOperations();
      pendingOps.sort(
        (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
      );

      for (const op of pendingOps) {
        await updateOperationStatus(op.operation_id, "in_flight");

        try {
          if (op.operation_type === "create") {
            const res = await fetch("/api/records", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                id: op.record_id,
                title: op.payload.title,
                description: op.payload.description,
                value: op.payload.value,
                deviceId: op.device_id,
                operationId: op.operation_id,
              }),
            });

            const data = await res.json();

            if (res.status === 201 || (res.ok && data.isDuplicate)) {
              await updateOperationStatus(op.operation_id, "applied");
              await updateRecordSyncState(
                op.record_id,
                "synced",
                data.record?.version || 1
              );
              appliedCount++;
              await logActivity(
                "Record created on server",
                `Synced "${op.payload.title}" (v1) successfully`,
                "sync_success"
              );
            } else if (res.status === 409) {
              await updateOperationStatus(op.operation_id, "conflict", data.error);
              await updateRecordSyncState(op.record_id, "conflict");
              conflictCount++;
              await logActivity(
                "Creation conflict",
                `Conflict on creating "${op.payload.title}": ${data.error}`,
                "conflict"
              );
            } else {
              await updateOperationStatus(op.operation_id, "failed", data.error || "Server error");
              await updateRecordSyncState(op.record_id, "failed");
              failedCount++;
              await logActivity(
                "Create failed",
                `Server rejected "${op.payload.title}": ${data.error || "Unknown error"}`,
                "failed"
              );
            }
          } else if (op.operation_type === "update") {
            const res = await fetch(`/api/records/${op.record_id}`, {
              method: "PUT",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                title: op.payload.title,
                description: op.payload.description,
                value: op.payload.value,
                baseVersion: op.base_version || 1,
                deviceId: op.device_id,
                operationId: op.operation_id,
              }),
            });

            const data = await res.json();

            if (res.ok) {
              await updateOperationStatus(op.operation_id, "applied");
              await updateRecordSyncState(
                op.record_id,
                "synced",
                data.record?.version || op.local_version
              );
              appliedCount++;
              await logActivity(
                "Record updated",
                `Synced "${op.payload.title}" (v${data.record?.version || op.local_version}) successfully`,
                "sync_success"
              );
            } else if (res.status === 409) {
              // VERSION CONFLICT DETECTED
              await updateOperationStatus(op.operation_id, "conflict", data.error);
              await updateRecordSyncState(op.record_id, "conflict");

              const serverRec = data.serverRecord as ServerRecord | undefined;
              
              // Fetch previous versions to find the exact original version snapshot
              let originalSnapshot: { title: string; description: string; value: string } | undefined;
              try {
                const verRes = await fetch(`/api/records/${op.record_id}/versions`);
                if (verRes.ok) {
                  const verData = await verRes.json();
                  const origVer = verData.versions?.find(
                    (v: { version: number }) => v.version === (op.base_version || 1)
                  );
                  if (origVer) {
                    originalSnapshot = {
                      title: origVer.title,
                      description: origVer.description || "",
                      value: origVer.value || "",
                    };
                  }
                }
              } catch {
                // Fallback to sensible defaults
              }

              const conflictDetail: ConflictDetail = {
                id: crypto.randomUUID(),
                record_id: op.record_id,
                device_id: op.device_id,
                original_version: op.base_version || 1,
                local_version: op.local_version,
                server_version: data.currentVersion || (serverRec ? serverRec.version : 0),
                status: "unresolved",
                original_record: originalSnapshot || {
                  title: op.payload.title || "Record",
                  description: op.payload.description || "",
                  value: "Original Value",
                },
                local_changes: {
                  title: op.payload.title || "",
                  description: op.payload.description || "",
                  value: op.payload.value || "",
                },
                server_changes: {
                  title: serverRec?.title || "Unknown",
                  description: serverRec?.description || "",
                  value: serverRec?.value || "",
                  updated_at: serverRec?.updated_at,
                },
                timestamp: new Date().toISOString(),
                reason: `Both devices modified the same record from version ${op.base_version || 1} before synchronization.`,
              };

              await saveConflict(conflictDetail);
              conflictCount++;
              await logActivity(
                "Conflict detected",
                `Record "${op.payload.title}": Server is at v${data.currentVersion}, but client sent base_version v${op.base_version}`,
                "conflict"
              );
            } else {
              await updateOperationStatus(op.operation_id, "failed", data.error || "Server error");
              await updateRecordSyncState(op.record_id, "failed");
              failedCount++;
              await logActivity(
                "Update failed",
                `Failed to sync "${op.payload.title}": ${data.error || "Server error"}`,
                "failed"
              );
            }
          } else if (op.operation_type === "delete") {
            const url = `/api/records/${op.record_id}?operationId=${encodeURIComponent(
              op.operation_id
            )}&deviceId=${encodeURIComponent(op.device_id)}${
              op.base_version ? `&baseVersion=${op.base_version}` : ""
            }`;

            const res = await fetch(url, { method: "DELETE" });
            const data = await res.json();

            if (res.ok) {
              await updateOperationStatus(op.operation_id, "applied");
              appliedCount++;
              await logActivity(
                "Record deleted",
                `Deleted record ${op.record_id.slice(0, 8)}... on server`,
                "sync_success"
              );
            } else if (res.status === 409) {
              await updateOperationStatus(op.operation_id, "conflict", data.error);
              conflictCount++;
              await logActivity(
                "Delete conflict",
                `Delete conflict on record ${op.record_id.slice(0, 8)}: ${data.error}`,
                "conflict"
              );
            } else {
              await updateOperationStatus(op.operation_id, "failed", data.error || "Delete failed");
              failedCount++;
              await logActivity(
                "Delete failed",
                `Failed to delete record ${op.record_id.slice(0, 8)}: ${data.error}`,
                "failed"
              );
            }
          }
        } catch (opErr) {
          const msg = opErr instanceof Error ? opErr.message : "Network error";
          await updateOperationStatus(op.operation_id, "failed", msg);
          await updateRecordSyncState(op.record_id, "failed");
          failedCount++;
          await logActivity("Sync error", `Network error while syncing: ${msg}`, "failed");
        }
      }

      // ----------------------------------------------------
      // PHASE 2: DOWNLOAD NEWER SERVER CHANGES
      // ----------------------------------------------------
      try {
        const pullRes = await fetch("/api/records");
        if (pullRes.ok) {
          const pullData = await pullRes.json();
          const serverRecords = (pullData.records || []) as ServerRecord[];
          const localRecords = await getAllRecords();
          const localMap = new Map(localRecords.map((r) => [r.id, r]));

          for (const sRec of serverRecords) {
            const lRec = localMap.get(sRec.id);

            // If we have an active local pending change or unresolved conflict for this record, do NOT overwrite!
            if (lRec && (lRec.syncStatus === "pending" || lRec.syncStatus === "conflict")) {
              continue;
            }

            if (!lRec || sRec.version > lRec.version) {
              const newLocalRec: SyncRecord = {
                id: sRec.id,
                title: sRec.title,
                description: sRec.description || "",
                value: sRec.value || "",
                version: sRec.version,
                createdAt: sRec.created_at,
                updatedAt: sRec.updated_at,
                syncStatus: "synced",
              };
              await saveRecordDirect(newLocalRec);
              pulledCount++;
            }
          }

          if (pulledCount > 0) {
            await logActivity(
              "Server changes downloaded",
              `Updated ${pulledCount} record(s) from PostgreSQL`,
              "pull"
            );
          }
        }
      } catch (pullErr) {
        console.warn("Pull phase failed:", pullErr);
      }

      // Finalize sync completion
      const now = new Date().toISOString();
      this.lastSyncTime = now;
      await setMeta("last_sync_time", now);

      await logActivity(
        "Synchronization finished",
        `Applied: ${appliedCount}, Conflicts: ${conflictCount}, Errors: ${failedCount}, Pulled: ${pulledCount}`,
        conflictCount > 0 ? "conflict" : failedCount > 0 ? "failed" : "sync_success"
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Synchronization failed";
      await logActivity("Synchronization error", msg, "failed");
    } finally {
      this.isSynchronizing = false;
      await this.notify();
    }

    return {
      success: conflictCount === 0 && failedCount === 0,
      appliedCount,
      conflictCount,
      failedCount,
      pulledCount,
    };
  }
}

// Global Singleton for the sync engine
let globalSyncEngine: SyncEngine | null = null;

export function getSyncEngine(): SyncEngine {
  if (!globalSyncEngine) {
    globalSyncEngine = new SyncEngine();
  }
  return globalSyncEngine;
}
