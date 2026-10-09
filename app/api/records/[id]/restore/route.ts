import { NextRequest, NextResponse } from "next/server";
import { getClient, isDatabaseConfigured } from "../../../../../lib/postgres";
import { ServerRecord, RecordVersion } from "../../../../../lib/types";
import { computeOperationHash, getLatestOperationHash } from "../../../../../lib/integrity";
import { broadcastRealtimeEvent } from "../../../../../lib/broadcaster";

interface RouteParams {
  params: Promise<{ id: string }>;
}

// POST /api/records/[id]/restore - Restore a historical version without deleting history & broadcast real-time event
export async function POST(req: NextRequest, { params }: RouteParams) {
  if (!isDatabaseConfigured()) {
    return NextResponse.json(
      { error: "PostgreSQL is not configured. Set DATABASE_URL in .env.local" },
      { status: 503 }
    );
  }

  const { id: recordId } = await params;

  let body: {
    versionToRestore?: number;
    deviceId?: string;
  };

  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { error: "Invalid JSON request body" },
      { status: 400 }
    );
  }

  const { versionToRestore, deviceId = "unknown-device" } = body;

  if (typeof versionToRestore !== "number" || versionToRestore < 1) {
    return NextResponse.json(
      { error: "'versionToRestore' must be a valid positive integer" },
      { status: 400 }
    );
  }

  const client = await getClient();
  const operationId = crypto.randomUUID();
  const versionSnapshotId = crypto.randomUUID();

  try {
    await client.query("BEGIN");

    // 1. Fetch current record
    const currentRes = await client.query<ServerRecord>(
      "SELECT id, title, description, value, version, created_at, updated_at FROM records WHERE id = $1 FOR UPDATE",
      [recordId]
    );

    if (currentRes.rows.length === 0) {
      await client.query("ROLLBACK");
      return NextResponse.json(
        { error: "Record not found with ID: " + recordId },
        { status: 404 }
      );
    }

    const currentRecord = currentRes.rows[0];

    // 2. Fetch requested historical version from record_versions
    const versionRes = await client.query<RecordVersion>(
      "SELECT id, record_id, version, title, description, value, created_at FROM record_versions WHERE record_id = $1 AND version = $2",
      [recordId, versionToRestore]
    );

    if (versionRes.rows.length === 0) {
      await client.query("ROLLBACK");
      return NextResponse.json(
        { error: `Historical version v${versionToRestore} was not found for record ${recordId}` },
        { status: 404 }
      );
    }

    const historicalSnapshot = versionRes.rows[0];

    // 3. Increment version to create the restored state (e.g. v5 -> restore v2 -> v6)
    const newVersion = currentRecord.version + 1;
    const now = new Date();
    const restoredTitle = historicalSnapshot.title;
    const restoredDesc = historicalSnapshot.description || "";
    const restoredVal = historicalSnapshot.value || "";

    // 4. Update records table with restored content
    const updatedRes = await client.query<ServerRecord>(
      `UPDATE records
       SET title = $1, description = $2, value = $3, version = $4, updated_at = $5
       WHERE id = $6
       RETURNING id, title, description, value, version, created_at, updated_at`,
      [restoredTitle, restoredDesc, restoredVal, newVersion, now, recordId]
    );

    const updatedRecord = updatedRes.rows[0];

    // 5. Store the new restored version snapshot in record_versions
    await client.query(
      `INSERT INTO record_versions (id, record_id, version, title, description, value, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [versionSnapshotId, recordId, newVersion, restoredTitle, restoredDesc, restoredVal, now]
    );

    // 6. Compute SHA-256 Hash Chain for the restore operation
    const previousHash = await getLatestOperationHash(client);
    const payload = {
      action: "RESTORE",
      source_version: versionToRestore,
      created_version: newVersion,
      restored_title: restoredTitle,
      restored_value: restoredVal,
    };

    const operationHash = computeOperationHash({
      operation_id: operationId,
      record_id: recordId,
      operation_type: "restore",
      base_version: currentRecord.version,
      new_version: newVersion,
      device_id: deviceId,
      timestamp: now,
      payload,
      previous_hash: previousHash,
    });

    // 7. Log restore operation in operations table with hash chain
    await client.query(
      `INSERT INTO operations (
        id, record_id, operation_type, base_version, new_version, device_id,
        created_at, operation_status, hash, previous_hash, payload
       ) VALUES ($1, $2, 'restore', $3, $4, $5, $6, 'applied', $7, $8, $9)`,
      [
        operationId,
        recordId,
        currentRecord.version,
        newVersion,
        deviceId,
        now,
        operationHash,
        previousHash,
        JSON.stringify(payload),
      ]
    );

    await client.query("COMMIT");

    // 8. Broadcast real-time recovery.completed event
    broadcastRealtimeEvent(
      "recovery.completed",
      {
        recordId,
        restoredFromVersion: versionToRestore,
        newVersion,
        title: restoredTitle,
      },
      deviceId
    );

    return NextResponse.json({
      message: `Successfully restored version v${versionToRestore} as new version v${newVersion}`,
      restoredFromVersion: versionToRestore,
      newVersion: newVersion,
      record: updatedRecord,
      operationHash,
    });
  } catch (err) {
    await client.query("ROLLBACK");
    const msg = err instanceof Error ? err.message : "Server error";
    return NextResponse.json(
      { error: "Failed to restore version: " + msg },
      { status: 500 }
    );
  } finally {
    client.release();
  }
}
