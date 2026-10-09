// Overall Sync Engine State
export type SyncEngineStatus =
  | "synced"
  | "pending"
  | "synchronizing"
  | "conflict"
  | "failed"
  | "offline";

// Sync status for an individual record
export type SyncStatus = "synced" | "pending" | "synchronizing" | "conflict" | "failed";

// Real-time WebSocket connection state
export type RealtimeConnectionState =
  | "connected"
  | "connecting"
  | "disconnected"
  | "reconnecting";

// Real-time Event Types
export type RealtimeEventType =
  | "record.created"
  | "record.updated"
  | "record.deleted"
  | "sync.started"
  | "sync.completed"
  | "conflict.detected"
  | "conflict.resolved"
  | "integrity.checked"
  | "recovery.completed"
  | "ping"
  | "pong";

// Real-time Message Payload
export interface RealtimeEventMessage<T = unknown> {
  type: RealtimeEventType;
  timestamp: string;
  deviceId?: string;
  data: T;
}

// Mutation operation type
export type OperationType = "create" | "update" | "delete" | "restore";

// Operation status in queue
export type OperationStatus = "pending" | "in_flight" | "applied" | "conflict" | "failed";

// Conflict status
export type ConflictStatus = "unresolved" | "resolved";

// Conflict Resolution Type
export type ConflictResolutionType = "keep_local" | "keep_server" | "manual_merge";

// Local SyncRecord stored in IndexedDB
export interface SyncRecord {
  id: string;
  title: string;
  description: string;
  value: string;
  createdAt: string;
  updatedAt: string;
  version: number;
  syncStatus: SyncStatus;
}

// Local Operation Queue item stored in IndexedDB
export interface PendingOperation {
  operation_id: string;
  record_id: string;
  device_id: string;
  operation_type: OperationType;
  base_version: number | null;
  local_version: number;
  timestamp: string;
  payload: {
    id?: string;
    title?: string;
    description?: string;
    value?: string;
  };
  status: OperationStatus;
  error_message?: string;
}

// Conflict Information preserved for explanation and resolution
export interface ConflictDetail {
  id: string;
  record_id: string;
  device_id: string;
  original_version: number;
  local_version: number;
  server_version: number;
  status: ConflictStatus;
  original_record?: {
    title: string;
    description: string;
    value: string;
  };
  local_changes: {
    title: string;
    description: string;
    value: string;
  };
  server_changes: {
    title: string;
    description: string;
    value: string;
    updated_at?: string;
  };
  timestamp: string;
  reason: string;
  resolution?: {
    type: ConflictResolutionType;
    resolved_value: {
      title: string;
      description: string;
      value: string;
    };
    final_version: number;
    resolved_at: string;
    resolved_by?: string;
  };
}

// Conflict Resolution Audit Record
export interface ConflictResolutionRecord {
  id: string;
  conflict_id: string;
  record_id: string;
  original_version: number;
  local_version: number;
  server_version: number;
  resolution_type: ConflictResolutionType;
  resolved_value: {
    title: string;
    description: string;
    value: string;
  };
  resolved_by: string;
  final_version: number;
  created_at: string;
}

// Integrity Verification Result
export interface IntegrityVerificationResult {
  status: "valid" | "invalid";
  operationsChecked: number;
  errors: Array<{
    operationId: string;
    recordId: string;
    index: number;
    expectedHash: string;
    storedHash: string;
    expectedPrevHash?: string;
    storedPrevHash?: string;
    reason: string;
  }>;
  verifiedAt: string;
}

// Activity Log item for synchronization & real-time history
export interface SyncActivityItem {
  id: string;
  timestamp: string;
  title: string;
  description: string;
  type: "sync_start" | "sync_success" | "change_queued" | "conflict" | "failed" | "pull" | "resolved" | "restore" | "integrity" | "realtime";
}

// PostgreSQL Server Record Schema
export interface ServerRecord {
  id: string;
  title: string;
  description: string | null;
  value: string | null;
  version: number;
  created_at: string;
  updated_at: string;
}

// PostgreSQL Record Version History Schema
export interface RecordVersion {
  id: string;
  record_id: string;
  version: number;
  title: string;
  description: string | null;
  value: string | null;
  created_at: string;
  changed_by?: string;
  operation_type?: string;
}

// PostgreSQL Operation Log Schema with SHA-256 Hash Chain
export interface ServerOperation {
  id: string;
  record_id: string;
  operation_type: OperationType;
  base_version: number | null;
  new_version: number | null;
  device_id: string | null;
  created_at: string;
  operation_status: "applied" | "conflict" | "rejected";
  hash?: string | null;
  previous_hash?: string | null;
  payload?: Record<string, unknown> | null;
}

// PostgreSQL User Schema
export interface User {
  id: string;
  name: string;
  email: string;
  created_at: string;
}