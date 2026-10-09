/**
 * db.ts - Enhanced IndexedDB storage & local mutation queue for SyncGuard
 *
 * Database: syncguard-db (version 2)
 * Object stores:
 *   - records        : User data records stored locally
 *   - operations     : Pending mutation operations queue
 *   - conflicts      : Preserved conflict information & resolutions
 *   - sync_activity  : Synchronization event log
 *   - meta           : Engine metadata (last_sync_time, etc.)
 */

import type {
  SyncRecord,
  PendingOperation,
  OperationType,
  OperationStatus,
  ConflictDetail,
  ConflictResolutionType,
  SyncActivityItem,
  SyncStatus,
} from "./types";
import { getDeviceId } from "./device";

const DB_NAME = "syncguard-db";
const DB_VERSION = 2;

const STORES = {
  RECORDS: "records",
  OPERATIONS: "operations",
  CONFLICTS: "conflicts",
  ACTIVITY: "sync_activity",
  META: "meta",
} as const;

// ---------- IndexedDB Initialization ----------

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof window === "undefined" || !window.indexedDB) {
      reject(new Error("IndexedDB is only available in browser context"));
      return;
    }

    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;

      // 1. Records store
      if (!db.objectStoreNames.contains(STORES.RECORDS)) {
        db.createObjectStore(STORES.RECORDS, { keyPath: "id" });
      }

      // 2. Operations store (mutation queue)
      if (!db.objectStoreNames.contains(STORES.OPERATIONS)) {
        const opStore = db.createObjectStore(STORES.OPERATIONS, {
          keyPath: "operation_id",
        });
        opStore.createIndex("status", "status", { unique: false });
        opStore.createIndex("record_id", "record_id", { unique: false });
      }

      // Migrate legacy pendingChanges if upgrading from v1
      if (db.objectStoreNames.contains("pendingChanges")) {
        try {
          db.deleteObjectStore("pendingChanges");
        } catch {
          // ignore
        }
      }

      // 3. Conflicts store
      if (!db.objectStoreNames.contains(STORES.CONFLICTS)) {
        const conflictStore = db.createObjectStore(STORES.CONFLICTS, {
          keyPath: "id",
        });
        conflictStore.createIndex("record_id", "record_id", { unique: false });
        conflictStore.createIndex("status", "status", { unique: false });
      }

      // 4. Sync Activity log store
      if (!db.objectStoreNames.contains(STORES.ACTIVITY)) {
        db.createObjectStore(STORES.ACTIVITY, { keyPath: "id" });
      }

      // 5. Metadata store
      if (!db.objectStoreNames.contains(STORES.META)) {
        db.createObjectStore(STORES.META, { keyPath: "key" });
      }
    };

    request.onsuccess = (event) => {
      resolve((event.target as IDBOpenDBRequest).result);
    };

    request.onerror = (event) => {
      reject(
        new Error(
          "Failed to open IndexedDB: " +
            ((event.target as IDBOpenDBRequest).error?.message ?? "unknown error")
        )
      );
    };
  });
}

function promisifyRequest<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () =>
      reject(new Error(request.error?.message ?? "IndexedDB request failed"));
  });
}

function waitForTransaction(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () =>
      reject(new Error(tx.error?.message ?? "Transaction failed"));
  });
}

function generateId(): string {
  return crypto.randomUUID();
}

// ---------- Records CRUD ----------

export async function getAllRecords(): Promise<SyncRecord[]> {
  const db = await openDB();
  const tx = db.transaction(STORES.RECORDS, "readonly");
  return promisifyRequest<SyncRecord[]>(tx.objectStore(STORES.RECORDS).getAll());
}

export async function getRecord(id: string): Promise<SyncRecord | undefined> {
  const db = await openDB();
  const tx = db.transaction(STORES.RECORDS, "readonly");
  return promisifyRequest<SyncRecord | undefined>(
    tx.objectStore(STORES.RECORDS).get(id)
  );
}

export async function saveRecordDirect(record: SyncRecord): Promise<void> {
  const db = await openDB();
  const tx = db.transaction(STORES.RECORDS, "readwrite");
  tx.objectStore(STORES.RECORDS).put(record);
  await waitForTransaction(tx);
}

export async function createRecord(
  data: Pick<SyncRecord, "title" | "description" | "value">
): Promise<SyncRecord> {
  const now = new Date().toISOString();
  const recordId = generateId();
  const operationId = generateId();
  const deviceId = getDeviceId();

  const record: SyncRecord = {
    id: recordId,
    title: data.title,
    description: data.description,
    value: data.value,
    createdAt: now,
    updatedAt: now,
    version: 1,
    syncStatus: "pending",
  };

  const op: PendingOperation = {
    operation_id: operationId,
    record_id: recordId,
    device_id: deviceId,
    operation_type: "create",
    base_version: null,
    local_version: 1,
    timestamp: now,
    payload: {
      id: recordId,
      title: data.title,
      description: data.description,
      value: data.value,
    },
    status: "pending",
  };

  const db = await openDB();
  const tx = db.transaction([STORES.RECORDS, STORES.OPERATIONS], "readwrite");
  tx.objectStore(STORES.RECORDS).add(record);
  tx.objectStore(STORES.OPERATIONS).add(op);
  await waitForTransaction(tx);

  await logActivity(
    "Offline change queued",
    `Created record "${record.title}" (v1) locally`,
    "change_queued"
  );

  return record;
}

export async function updateRecord(
  id: string,
  updates: Partial<Pick<SyncRecord, "title" | "description" | "value">>
): Promise<SyncRecord> {
  const existing = await getRecord(id);
  if (!existing) throw new Error("Record " + id + " not found");

  const now = new Date().toISOString();
  const operationId = generateId();
  const deviceId = getDeviceId();
  const baseVersion = existing.version;
  const newLocalVersion = existing.version + 1;

  const updated: SyncRecord = {
    ...existing,
    ...updates,
    updatedAt: now,
    version: newLocalVersion,
    syncStatus: "pending",
  };

  const op: PendingOperation = {
    operation_id: operationId,
    record_id: id,
    device_id: deviceId,
    operation_type: "update",
    base_version: baseVersion,
    local_version: newLocalVersion,
    timestamp: now,
    payload: {
      title: updated.title,
      description: updated.description,
      value: updated.value,
    },
    status: "pending",
  };

  const db = await openDB();
  const tx = db.transaction([STORES.RECORDS, STORES.OPERATIONS], "readwrite");
  tx.objectStore(STORES.RECORDS).put(updated);
  tx.objectStore(STORES.OPERATIONS).add(op);
  await waitForTransaction(tx);

  await logActivity(
    "Offline change queued",
    `Updated record "${updated.title}" (v${baseVersion} → v${newLocalVersion}) locally`,
    "change_queued"
  );

  return updated;
}

export async function deleteRecord(id: string): Promise<void> {
  const existing = await getRecord(id);
  const now = new Date().toISOString();
  const operationId = generateId();
  const deviceId = getDeviceId();

  const op: PendingOperation = {
    operation_id: operationId,
    record_id: id,
    device_id: deviceId,
    operation_type: "delete",
    base_version: existing ? existing.version : null,
    local_version: existing ? existing.version : 1,
    timestamp: now,
    payload: { id },
    status: "pending",
  };

  const db = await openDB();
  const tx = db.transaction([STORES.RECORDS, STORES.OPERATIONS], "readwrite");
  tx.objectStore(STORES.RECORDS).delete(id);
  tx.objectStore(STORES.OPERATIONS).add(op);
  await waitForTransaction(tx);

  await logActivity(
    "Offline change queued",
    `Deleted record ${id.slice(0, 8)}... locally`,
    "change_queued"
  );
}

export async function updateRecordSyncState(
  id: string,
  syncStatus: SyncStatus,
  version?: number
): Promise<void> {
  const existing = await getRecord(id);
  if (!existing) return;

  const updated: SyncRecord = {
    ...existing,
    syncStatus,
    version: version !== undefined ? version : existing.version,
  };

  const db = await openDB();
  const tx = db.transaction(STORES.RECORDS, "readwrite");
  tx.objectStore(STORES.RECORDS).put(updated);
  await waitForTransaction(tx);
}

// ---------- Operations Queue ----------

export async function getAllOperations(): Promise<PendingOperation[]> {
  const db = await openDB();
  const tx = db.transaction(STORES.OPERATIONS, "readonly");
  return promisifyRequest<PendingOperation[]>(
    tx.objectStore(STORES.OPERATIONS).getAll()
  );
}

export async function getPendingOperations(): Promise<PendingOperation[]> {
  const all = await getAllOperations();
  return all.filter(
    (op) => op.status === "pending" || op.status === "failed" || op.status === "in_flight"
  );
}

export async function updateOperationStatus(
  operationId: string,
  status: OperationStatus,
  errorMessage?: string
): Promise<void> {
  const db = await openDB();
  const tx = db.transaction(STORES.OPERATIONS, "readwrite");
  const store = tx.objectStore(STORES.OPERATIONS);
  const op = await promisifyRequest<PendingOperation | undefined>(
    store.get(operationId)
  );

  if (op) {
    op.status = status;
    if (errorMessage !== undefined) {
      op.error_message = errorMessage;
    }
    store.put(op);
  }
  await waitForTransaction(tx);
}

export async function removeOperation(operationId: string): Promise<void> {
  const db = await openDB();
  const tx = db.transaction(STORES.OPERATIONS, "readwrite");
  tx.objectStore(STORES.OPERATIONS).delete(operationId);
  await waitForTransaction(tx);
}

// ---------- Conflicts Store & Resolution ----------

export async function saveConflict(conflict: ConflictDetail): Promise<void> {
  const db = await openDB();
  const tx = db.transaction(STORES.CONFLICTS, "readwrite");
  tx.objectStore(STORES.CONFLICTS).put(conflict);
  await waitForTransaction(tx);
}

export async function getAllConflicts(): Promise<ConflictDetail[]> {
  const db = await openDB();
  const tx = db.transaction(STORES.CONFLICTS, "readonly");
  return promisifyRequest<ConflictDetail[]>(
    tx.objectStore(STORES.CONFLICTS).getAll()
  );
}

export async function getUnresolvedConflicts(): Promise<ConflictDetail[]> {
  const all = await getAllConflicts();
  return all.filter((c) => c.status !== "resolved");
}

export async function getResolvedConflicts(): Promise<ConflictDetail[]> {
  const all = await getAllConflicts();
  return all.filter((c) => c.status === "resolved");
}

export async function getConflictById(id: string): Promise<ConflictDetail | undefined> {
  const db = await openDB();
  const tx = db.transaction(STORES.CONFLICTS, "readonly");
  return promisifyRequest<ConflictDetail | undefined>(
    tx.objectStore(STORES.CONFLICTS).get(id)
  );
}

export async function getConflictForRecord(
  recordId: string
): Promise<ConflictDetail | undefined> {
  const all = await getAllConflicts();
  // Return the active unresolved conflict first, or most recent
  return (
    all.find((c) => c.record_id === recordId && c.status !== "resolved") ||
    all.find((c) => c.record_id === recordId)
  );
}

export async function resolveConflictInDb(
  conflictId: string,
  resolution: {
    type: ConflictResolutionType;
    resolvedValue: { title: string; description: string; value: string };
    finalVersion: number;
    resolvedBy?: string;
  }
): Promise<void> {
  const db = await openDB();
  const tx = db.transaction([STORES.CONFLICTS, STORES.RECORDS], "readwrite");
  const conflictStore = tx.objectStore(STORES.CONFLICTS);
  const recordStore = tx.objectStore(STORES.RECORDS);

  const conflict = await promisifyRequest<ConflictDetail | undefined>(
    conflictStore.get(conflictId)
  );

  if (conflict) {
    conflict.status = "resolved";
    conflict.resolution = {
      type: resolution.type,
      resolved_value: resolution.resolvedValue,
      final_version: resolution.finalVersion,
      resolved_at: new Date().toISOString(),
      resolved_by: resolution.resolvedBy,
    };
    conflictStore.put(conflict);

    // Update local record to resolved state
    const record = await promisifyRequest<SyncRecord | undefined>(
      recordStore.get(conflict.record_id)
    );
    if (record) {
      record.title = resolution.resolvedValue.title;
      record.description = resolution.resolvedValue.description;
      record.value = resolution.resolvedValue.value;
      record.version = resolution.finalVersion;
      record.syncStatus = "synced";
      record.updatedAt = new Date().toISOString();
      recordStore.put(record);
    }
  }

  await waitForTransaction(tx);

  await logActivity(
    "Conflict resolved",
    `Resolved conflict on record ${conflict?.record_id.slice(0, 8)}... (${resolution.type})`,
    "resolved"
  );
}

export async function removeConflict(id: string): Promise<void> {
  const db = await openDB();
  const tx = db.transaction(STORES.CONFLICTS, "readwrite");
  tx.objectStore(STORES.CONFLICTS).delete(id);
  await waitForTransaction(tx);
}

// ---------- Sync Activity History ----------

export async function logActivity(
  title: string,
  description: string,
  type: SyncActivityItem["type"]
): Promise<void> {
  const item: SyncActivityItem = {
    id: generateId(),
    timestamp: new Date().toISOString(),
    title,
    description,
    type,
  };

  try {
    const db = await openDB();
    const tx = db.transaction(STORES.ACTIVITY, "readwrite");
    tx.objectStore(STORES.ACTIVITY).add(item);
    await waitForTransaction(tx);
  } catch {
    // Non-critical
  }
}

export async function getRecentActivity(limit = 20): Promise<SyncActivityItem[]> {
  const db = await openDB();
  const tx = db.transaction(STORES.ACTIVITY, "readonly");
  const all = await promisifyRequest<SyncActivityItem[]>(
    tx.objectStore(STORES.ACTIVITY).getAll()
  );
  return all
    .sort(
      (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
    )
    .slice(0, limit);
}

// ---------- Metadata Store ----------

export async function setMeta(key: string, value: unknown): Promise<void> {
  const db = await openDB();
  const tx = db.transaction(STORES.META, "readwrite");
  tx.objectStore(STORES.META).put({ key, value, updatedAt: new Date().toISOString() });
  await waitForTransaction(tx);
}

export async function getMeta<T = unknown>(key: string): Promise<T | undefined> {
  const db = await openDB();
  const tx = db.transaction(STORES.META, "readonly");
  const item = await promisifyRequest<{ key: string; value: T } | undefined>(
    tx.objectStore(STORES.META).get(key)
  );
  return item?.value;
}