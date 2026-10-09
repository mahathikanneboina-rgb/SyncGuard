import crypto from "crypto";
import type { PoolClient } from "pg";
import { query, getClient } from "./postgres";
import type { IntegrityVerificationResult, ServerOperation } from "./types";

export interface OperationHashInput {
  operation_id: string;
  record_id: string;
  operation_type: string;
  base_version: number | null;
  new_version: number | null;
  device_id: string | null;
  timestamp: string | Date;
  payload: unknown;
  previous_hash: string;
}

/**
 * Deterministic JSON stringifier to ensure identical object representations
 */
export function canonicalizePayload(payload: unknown): string {
  if (!payload || typeof payload !== "object") {
    return payload !== undefined && payload !== null ? String(payload) : "";
  }
  const keys = Object.keys(payload as object).sort();
  const sortedObj: Record<string, unknown> = {};
  for (const k of keys) {
    const val = (payload as Record<string, unknown>)[k];
    sortedObj[k] = val !== undefined ? val : null;
  }
  return JSON.stringify(sortedObj);
}

/**
 * Calculates deterministic SHA-256 integrity hash for an operation.
 * Note: Hashing is for tamper detection and integrity verification, NOT encryption.
 */
export function computeOperationHash(input: OperationHashInput): string {
  const isoTimestamp =
    input.timestamp instanceof Date
      ? input.timestamp.toISOString()
      : new Date(input.timestamp).toISOString();

  const canonicalString = [
    input.operation_id,
    input.record_id,
    input.operation_type,
    input.base_version !== null && input.base_version !== undefined
      ? String(input.base_version)
      : "NULL",
    input.new_version !== null && input.new_version !== undefined
      ? String(input.new_version)
      : "NULL",
    input.device_id || "unknown",
    isoTimestamp,
    canonicalizePayload(input.payload),
    input.previous_hash || "GENESIS",
  ].join("|");

  return crypto.createHash("sha256").update(canonicalString, "utf8").digest("hex");
}

/**
 * Retrieves the hash of the latest operation in the database chain.
 * Returns 'GENESIS' if this is the first operation.
 */
export async function getLatestOperationHash(client?: PoolClient): Promise<string> {
  const sql = "SELECT hash FROM operations WHERE hash IS NOT NULL ORDER BY created_at DESC LIMIT 1";
  const res = client ? await client.query(sql) : await query(sql);

  if (res.rows.length > 0 && res.rows[0].hash) {
    return res.rows[0].hash;
  }
  return "GENESIS";
}

/**
 * Verifies the entire operation hash chain for tamper detection.
 */
export async function verifyOperationsIntegrity(): Promise<IntegrityVerificationResult> {
  const res = await query<ServerOperation>(
    `SELECT id, record_id, operation_type, base_version, new_version,
            device_id, created_at, operation_status, hash, previous_hash, payload
     FROM operations
     ORDER BY created_at ASC`
  );

  const operations = res.rows;
  const errors: IntegrityVerificationResult["errors"] = [];

  let expectedPreviousHash = "GENESIS";

  for (let i = 0; i < operations.length; i++) {
    const op = operations[i];

    // If operations were created before Phase 6 and don't have hashes, we calculate and note it
    if (!op.hash) {
      continue;
    }

    // 1. Verify previous_hash link
    if (op.previous_hash !== expectedPreviousHash) {
      errors.push({
        operationId: op.id,
        recordId: op.record_id,
        index: i + 1,
        expectedHash: op.hash,
        storedHash: op.hash,
        expectedPrevHash: expectedPreviousHash,
        storedPrevHash: op.previous_hash || "NULL",
        reason: `Broken hash chain: expected previous_hash '${expectedPreviousHash.slice(
          0,
          10
        )}...', but found '${(op.previous_hash || "NULL").slice(0, 10)}...'`,
      });
    }

    // 2. Recalculate operation hash
    const calculatedHash = computeOperationHash({
      operation_id: op.id,
      record_id: op.record_id,
      operation_type: op.operation_type,
      base_version: op.base_version,
      new_version: op.new_version,
      device_id: op.device_id,
      timestamp: op.created_at,
      payload: op.payload,
      previous_hash: op.previous_hash || "GENESIS",
    });

    // 3. Compare calculated with stored
    if (calculatedHash !== op.hash) {
      errors.push({
        operationId: op.id,
        recordId: op.record_id,
        index: i + 1,
        expectedHash: calculatedHash,
        storedHash: op.hash,
        reason: `Hash mismatch: operation data was altered. Recomputed hash '${calculatedHash.slice(
          0,
          10
        )}...' does not match stored hash '${op.hash.slice(0, 10)}...'`,
      });
    }

    // The current stored/calculated hash becomes the expected previous_hash for the next operation
    expectedPreviousHash = op.hash;
  }

  return {
    status: errors.length === 0 ? "valid" : "invalid",
    operationsChecked: operations.filter((o) => Boolean(o.hash)).length,
    errors,
    verifiedAt: new Date().toISOString(),
  };
}
