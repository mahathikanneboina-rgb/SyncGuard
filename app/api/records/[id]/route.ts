import { NextRequest, NextResponse } from "next/server";
import { query, getClient, isDatabaseConfigured } from "../../../../lib/postgres";
import { ServerRecord } from "../../../../lib/types";
import { computeOperationHash, getLatestOperationHash } from "../../../../lib/integrity";
import { broadcastRealtimeEvent } from "../../../../lib/broadcaster";

interface RouteParams {
  params: Promise<{ id: string }>;
}

// GET /api/records/[id] - Get a single record by ID
export async function GET(req: NextRequest, { params }: RouteParams) {
  if (!isDatabaseConfigured()) {
    return NextResponse.json(
      { error: "PostgreSQL is not configured. Set DATABASE_URL in .env.local" },
      { status: 503 }
    );
  }

  const { id } = await params;

  try {
    const result = await query<ServerRecord>(
      "SELECT id, title, description, value, version, created_at, updated_at FROM records WHERE id = $1",
      [id]
    );

    if (result.rows.length === 0) {
      return NextResponse.json(
        { error: "Record not found with ID: " + id },
        { status: 404 }
      );
    }

    return NextResponse.json({ record: result.rows[0] });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Database error";
    return NextResponse.json(
      { error: "Failed to get record: " + message },
      { status: 500 }
    );
  }
}

// PUT /api/records/[id] - Update a record with optimistic version check, hash chain, & real-time broadcast
export async function PUT(req: NextRequest, { params }: RouteParams) {
  if (!isDatabaseConfigured()) {
    return NextResponse.json(
      { error: "PostgreSQL is not configured. Set DATABASE_URL in .env.local" },
      { status: 503 }
    );
  }

  const { id } = await params;

  let body: {
    title?: string;
    description?: string;
    value?: string;
    baseVersion?: number;
    deviceId?: string;
    operationId?: string;
  };

  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { error: "Invalid JSON request body" },
      { status: 400 }
    );
  }

  const { title, description = "", value = "", baseVersion, deviceId = "unknown-device" } = body;

  if (!title || typeof title !== "string" || !title.trim()) {
    return NextResponse.json(
      { error: "Record 'title' is required and cannot be empty" },
      { status: 400 }
    );
  }

  if (typeof baseVersion !== "number" || baseVersion < 1) {
    return NextResponse.json(
      { error: "'baseVersion' (integer >= 1) is required for updates to verify conflict status" },
      { status: 400 }
    );
  }

  const operationId = body.operationId || crypto.randomUUID();
  const versionId = crypto.randomUUID();
  const client = await getClient();

  try {
    await client.query("BEGIN");

    // 1. Idempotency check: duplicate operationId
    const existingOp = await client.query(
      "SELECT id, operation_status, new_version, hash FROM operations WHERE id = $1",
      [operationId]
    );

    if (existingOp.rows.length > 0) {
      await client.query("ROLLBACK");
      const recRes = await client.query<ServerRecord>(
        "SELECT id, title, description, value, version, created_at, updated_at FROM records WHERE id = $1",
        [id]
      );
      return NextResponse.json(
        {
          message: "Operation was already processed (idempotent)",
          record: recRes.rows[0],
          isDuplicate: true,
          operationHash: existingOp.rows[0].hash,
        },
        { status: 200 }
      );
    }

    // 2. Fetch current record from database
    const currentRes = await client.query<ServerRecord>(
      "SELECT id, title, description, value, version, created_at, updated_at FROM records WHERE id = $1 FOR UPDATE",
      [id]
    );

    if (currentRes.rows.length === 0) {
      await client.query("ROLLBACK");
      return NextResponse.json(
        { error: "Record not found with ID: " + id },
        { status: 404 }
      );
    }

    const currentRecord = currentRes.rows[0];
    const now = new Date();
    const payload = {
      title: title.trim(),
      description: description.trim(),
      value: value.trim(),
    };

    // 3. Versioning validation: Reject update if baseVersion does not match current server version
    if (currentRecord.version !== baseVersion) {
      const prevHash = await getLatestOperationHash(client);
      const conflictHash = computeOperationHash({
        operation_id: operationId,
        record_id: id,
        operation_type: "update",
        base_version: baseVersion,
        new_version: currentRecord.version,
        device_id: deviceId,
        timestamp: now,
        payload,
        previous_hash: prevHash,
      });

      // Record conflict in operations table with hash chain
      await client.query(
        `INSERT INTO operations (
          id, record_id, operation_type, base_version, new_version, device_id,
          created_at, operation_status, hash, previous_hash, payload
         ) VALUES ($1, $2, 'update', $3, $4, $5, $6, 'conflict', $7, $8, $9)`,
        [
          operationId,
          id,
          baseVersion,
          currentRecord.version,
          deviceId,
          now,
          conflictHash,
          prevHash,
          JSON.stringify(payload),
        ]
      );

      await client.query("COMMIT");

      // Broadcast real-time conflict notification to all connected clients
      broadcastRealtimeEvent(
        "conflict.detected",
        {
          recordId: id,
          recordTitle: currentRecord.title,
          localVersion: baseVersion,
          serverVersion: currentRecord.version,
          deviceId,
        },
        deviceId
      );

      return NextResponse.json(
        {
          error: "Version conflict: server record is at version " + currentRecord.version + ", but update was sent with base_version " + baseVersion + ".",
          currentVersion: currentRecord.version,
          baseVersion: baseVersion,
          serverRecord: {
            id: currentRecord.id,
            title: currentRecord.title,
            description: currentRecord.description,
            value: currentRecord.value,
            version: currentRecord.version,
            created_at: currentRecord.created_at,
            updated_at: currentRecord.updated_at,
          },
        },
        { status: 409 }
      );
    }

    const newVersion = currentRecord.version + 1;

    // 4. Update the record with incremented version
    const updatedRes = await client.query<ServerRecord>(
      `UPDATE records
       SET title = $1, description = $2, value = $3, version = $4, updated_at = $5
       WHERE id = $6
       RETURNING id, title, description, value, version, created_at, updated_at`,
      [title.trim(), description.trim(), value.trim(), newVersion, now, id]
    );

    const updatedRecord = updatedRes.rows[0];

    // 5. Store snapshot in record_versions for history and recovery
    await client.query(
      `INSERT INTO record_versions (id, record_id, version, title, description, value, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [versionId, id, newVersion, title.trim(), description.trim(), value.trim(), now]
    );

    // 6. Compute SHA-256 Hash Chain
    const previousHash = await getLatestOperationHash(client);
    const operationHash = computeOperationHash({
      operation_id: operationId,
      record_id: id,
      operation_type: "update",
      base_version: baseVersion,
      new_version: newVersion,
      device_id: deviceId,
      timestamp: now,
      payload,
      previous_hash: previousHash,
    });

    // 7. Log operation in operations table with hash chain
    await client.query(
      `INSERT INTO operations (
        id, record_id, operation_type, base_version, new_version, device_id,
        created_at, operation_status, hash, previous_hash, payload
       ) VALUES ($1, $2, 'update', $3, $4, $5, $6, 'applied', $7, $8, $9)`,
      [
        operationId,
        id,
        baseVersion,
        newVersion,
        deviceId,
        now,
        operationHash,
        previousHash,
        JSON.stringify(payload),
      ]
    );

    await client.query("COMMIT");

    // 8. Broadcast real-time update event to all connected clients
    broadcastRealtimeEvent(
      "record.updated",
      {
        recordId: id,
        version: newVersion,
        title: updatedRecord.title,
        value: updatedRecord.value,
      },
      deviceId
    );

    return NextResponse.json({
      message: "Record updated successfully",
      record: updatedRecord,
      previousVersion: baseVersion,
      newVersion: newVersion,
      operationHash,
    });
  } catch (err) {
    await client.query("ROLLBACK");
    const message = err instanceof Error ? err.message : "Server error";
    return NextResponse.json(
      { error: "Failed to update record: " + message },
      { status: 500 }
    );
  } finally {
    client.release();
  }
}

// DELETE /api/records/[id] - Delete a record with version check, SHA-256 hash preservation, & real-time broadcast
export async function DELETE(req: NextRequest, { params }: RouteParams) {
  if (!isDatabaseConfigured()) {
    return NextResponse.json(
      { error: "PostgreSQL is not configured. Set DATABASE_URL in .env.local" },
      { status: 503 }
    );
  }

  const { id } = await params;
  const operationId = req.nextUrl.searchParams.get("operationId") || crypto.randomUUID();
  const deviceId = req.nextUrl.searchParams.get("deviceId") || "unknown-device";
  const baseVersionStr = req.nextUrl.searchParams.get("baseVersion");

  const client = await getClient();

  try {
    await client.query("BEGIN");

    // Idempotency check
    const existingOp = await client.query(
      "SELECT id FROM operations WHERE id = $1",
      [operationId]
    );
    if (existingOp.rows.length > 0) {
      await client.query("ROLLBACK");
      return NextResponse.json({ message: "Delete operation already processed" });
    }

    // Fetch current record
    const currentRes = await client.query<ServerRecord>(
      "SELECT id, title, description, value, version, created_at, updated_at FROM records WHERE id = $1 FOR UPDATE",
      [id]
    );

    if (currentRes.rows.length === 0) {
      await client.query("ROLLBACK");
      return NextResponse.json({ message: "Record already deleted or does not exist", id });
    }

    const currentRecord = currentRes.rows[0];

    // Base version validation if provided
    if (baseVersionStr) {
      const baseVersion = parseInt(baseVersionStr, 10);
      if (!isNaN(baseVersion) && currentRecord.version !== baseVersion) {
        await client.query("ROLLBACK");
        return NextResponse.json(
          {
            error: "Version conflict: server record is at version " + currentRecord.version + ", but deletion was based on version " + baseVersion,
            currentVersion: currentRecord.version,
            baseVersion: baseVersion,
            serverRecord: currentRecord,
          },
          { status: 409 }
        );
      }
    }

    const now = new Date();
    const payload = { id, deleted_version: currentRecord.version };

    // 1. Delete from records
    await client.query("DELETE FROM records WHERE id = $1", [id]);

    // 2. Compute SHA-256 Hash Chain
    const previousHash = await getLatestOperationHash(client);
    const operationHash = computeOperationHash({
      operation_id: operationId,
      record_id: id,
      operation_type: "delete",
      base_version: currentRecord.version,
      new_version: null,
      device_id: deviceId,
      timestamp: now,
      payload,
      previous_hash: previousHash,
    });

    // 3. Log operation in operations table with hash chain
    await client.query(
      `INSERT INTO operations (
        id, record_id, operation_type, base_version, new_version, device_id,
        created_at, operation_status, hash, previous_hash, payload
       ) VALUES ($1, $2, 'delete', $3, NULL, $4, $5, 'applied', $6, $7, $8)`,
      [
        operationId,
        id,
        currentRecord.version,
        deviceId,
        now,
        operationHash,
        previousHash,
        JSON.stringify(payload),
      ]
    );

    await client.query("COMMIT");

    // 4. Broadcast real-time delete event
    broadcastRealtimeEvent(
      "record.deleted",
      { recordId: id, deletedVersion: currentRecord.version },
      deviceId
    );

    return NextResponse.json({
      message: "Record deleted successfully",
      id: id,
      deletedVersion: currentRecord.version,
      operationHash,
    });
  } catch (err) {
    await client.query("ROLLBACK");
    const message = err instanceof Error ? err.message : "Server error";
    return NextResponse.json(
      { error: "Failed to delete record: " + message },
      { status: 500 }
    );
  } finally {
    client.release();
  }
}