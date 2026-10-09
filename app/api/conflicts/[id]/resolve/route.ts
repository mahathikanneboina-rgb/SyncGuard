import { NextRequest, NextResponse } from "next/server";
import { getClient, isDatabaseConfigured } from "../../../../../lib/postgres";
import { ServerRecord } from "../../../../../lib/types";
import { broadcastRealtimeEvent } from "../../../../../lib/broadcaster";

interface RouteParams {
  params: Promise<{ id: string }>;
}

// POST /api/conflicts/[id]/resolve - Apply conflict resolution, create final version & broadcast real-time event
export async function POST(req: NextRequest, { params }: RouteParams) {
  if (!isDatabaseConfigured()) {
    return NextResponse.json(
      { error: "PostgreSQL is not configured. Set DATABASE_URL in .env.local" },
      { status: 503 }
    );
  }

  const { id: conflictId } = await params;

  let body: {
    recordId: string;
    resolutionType: "keep_local" | "keep_server" | "manual_merge";
    resolvedValue: {
      title: string;
      description?: string;
      value?: string;
    };
    originalVersion?: number;
    localVersion?: number;
    serverVersion?: number;
    resolvedBy?: string;
  };

  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { error: "Invalid JSON request body" },
      { status: 400 }
    );
  }

  const {
    recordId,
    resolutionType,
    resolvedValue,
    originalVersion = 1,
    localVersion = 2,
    serverVersion = 2,
    resolvedBy = "user",
  } = body;

  if (!recordId) {
    return NextResponse.json(
      { error: "'recordId' is required" },
      { status: 400 }
    );
  }

  if (!["keep_local", "keep_server", "manual_merge"].includes(resolutionType)) {
    return NextResponse.json(
      { error: "Invalid 'resolutionType'. Must be 'keep_local', 'keep_server', or 'manual_merge'" },
      { status: 400 }
    );
  }

  if (!resolvedValue || !resolvedValue.title || !resolvedValue.title.trim()) {
    return NextResponse.json(
      { error: "Resolved value must include a valid non-empty 'title'" },
      { status: 400 }
    );
  }

  const client = await getClient();
  const resolutionId = crypto.randomUUID();
  const versionSnapshotId = crypto.randomUUID();
  const operationId = crypto.randomUUID();

  try {
    await client.query("BEGIN");

    // 1. Fetch current server record
    const recordRes = await client.query<ServerRecord>(
      "SELECT id, title, description, value, version, created_at, updated_at FROM records WHERE id = $1 FOR UPDATE",
      [recordId]
    );

    if (recordRes.rows.length === 0) {
      await client.query("ROLLBACK");
      return NextResponse.json(
        { error: "Record not found with ID: " + recordId },
        { status: 404 }
      );
    }

    const currentRecord = recordRes.rows[0];

    // Every conflict resolution creates a new clean final version (e.g., v1 -> v2A/v2B -> v3)
    const finalVersion = currentRecord.version + 1;
    const now = new Date();

    const title = resolvedValue.title.trim();
    const description = (resolvedValue.description || "").trim();
    const value = (resolvedValue.value || "").trim();

    // 2. Update record in records table with the resolved value and incremented version
    const updatedRes = await client.query<ServerRecord>(
      `UPDATE records
       SET title = $1, description = $2, value = $3, version = $4, updated_at = $5
       WHERE id = $6
       RETURNING id, title, description, value, version, created_at, updated_at`,
      [title, description, value, finalVersion, now, recordId]
    );

    const updatedRecord = updatedRes.rows[0];

    // 3. Store new resolved version snapshot in record_versions
    await client.query(
      `INSERT INTO record_versions (id, record_id, version, title, description, value, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [versionSnapshotId, recordId, finalVersion, title, description, value, now]
    );

    // 4. Record the resolution decision in conflict_resolutions table
    await client.query(
      `INSERT INTO conflict_resolutions (
        id, conflict_id, record_id, original_version, local_version, server_version,
        resolution_type, resolved_value, resolved_by, final_version, created_at
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
      [
        resolutionId,
        conflictId,
        recordId,
        originalVersion,
        localVersion,
        currentRecord.version,
        resolutionType,
        JSON.stringify({ title, description, value }),
        resolvedBy,
        finalVersion,
        now,
      ]
    );

    // 5. Log resolution in operations table
    await client.query(
      `INSERT INTO operations (id, record_id, operation_type, base_version, new_version, device_id, created_at, operation_status)
       VALUES ($1, $2, 'update', $3, $4, $5, $6, 'applied')`,
      [operationId, recordId, currentRecord.version, finalVersion, resolvedBy, now]
    );

    await client.query("COMMIT");

    // 6. Broadcast real-time conflict.resolved event to all connected clients
    broadcastRealtimeEvent(
      "conflict.resolved",
      {
        conflictId,
        recordId,
        recordTitle: title,
        resolutionType,
        finalVersion,
      },
      resolvedBy
    );

    return NextResponse.json({
      message: "Conflict resolved successfully",
      resolutionId,
      finalVersion,
      resolutionType,
      record: updatedRecord,
    });
  } catch (err) {
    await client.query("ROLLBACK");
    const msg = err instanceof Error ? err.message : "Server error";
    return NextResponse.json(
      { error: "Failed to resolve conflict: " + msg },
      { status: 500 }
    );
  } finally {
    client.release();
  }
}
