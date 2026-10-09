import { NextRequest, NextResponse } from "next/server";
import { query, getClient, isDatabaseConfigured } from "../../../lib/postgres";
import { ServerRecord } from "../../../lib/types";
import { computeOperationHash, getLatestOperationHash } from "../../../lib/integrity";
import { broadcastRealtimeEvent } from "../../../lib/broadcaster";

// GET /api/records - Retrieve all records from PostgreSQL
export async function GET() {
  if (!isDatabaseConfigured()) {
    return NextResponse.json(
      {
        error: "PostgreSQL is not configured. Set DATABASE_URL in .env.local",
        isConfigured: false,
        records: [],
      },
      { status: 503 }
    );
  }

  try {
    const result = await query<ServerRecord>(
      "SELECT id, title, description, value, version, created_at, updated_at FROM records ORDER BY updated_at DESC"
    );
    return NextResponse.json({
      records: result.rows,
      count: result.rowCount,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Database query failed";
    return NextResponse.json(
      { error: "Failed to fetch records: " + message },
      { status: 500 }
    );
  }
}

// POST /api/records - Create a new record with tamper-evident operation hash & real-time broadcast
export async function POST(req: NextRequest) {
  if (!isDatabaseConfigured()) {
    return NextResponse.json(
      { error: "PostgreSQL is not configured. Set DATABASE_URL in .env.local" },
      { status: 503 }
    );
  }

  let body: {
    id?: string;
    title?: string;
    description?: string;
    value?: string;
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

  const { title, description = "", value = "", deviceId = "unknown-device" } = body;

  if (!title || typeof title !== "string" || !title.trim()) {
    return NextResponse.json(
      { error: "Record 'title' is required and cannot be empty" },
      { status: 400 }
    );
  }

  const recordId = body.id || crypto.randomUUID();
  const operationId = body.operationId || crypto.randomUUID();
  const versionId = crypto.randomUUID();

  const client = await getClient();

  try {
    await client.query("BEGIN");

    // Idempotency check: duplicate operation ID
    const existingOp = await client.query(
      "SELECT id, operation_status FROM operations WHERE id = $1",
      [operationId]
    );

    if (existingOp.rows.length > 0) {
      await client.query("ROLLBACK");
      return NextResponse.json(
        {
          error: "Duplicate operation ID: " + operationId + " already processed",
          operationStatus: existingOp.rows[0].operation_status,
          isDuplicate: true,
        },
        { status: 200 }
      );
    }

    // Check if record already exists
    const existingRecord = await client.query(
      "SELECT id FROM records WHERE id = $1",
      [recordId]
    );

    if (existingRecord.rows.length > 0) {
      await client.query("ROLLBACK");
      return NextResponse.json(
        { error: "Record with ID " + recordId + " already exists" },
        { status: 409 }
      );
    }

    const now = new Date();
    const payload = {
      id: recordId,
      title: title.trim(),
      description: description.trim(),
      value: value.trim(),
    };

    // 1. Insert into records table
    const recordResult = await client.query<ServerRecord>(
      `INSERT INTO records (id, title, description, value, version, created_at, updated_at)
       VALUES ($1, $2, $3, $4, 1, $5, $5)
       RETURNING id, title, description, value, version, created_at, updated_at`,
      [recordId, title.trim(), description.trim(), value.trim(), now]
    );

    const createdRecord = recordResult.rows[0];

    // 2. Insert initial version into record_versions table
    await client.query(
      `INSERT INTO record_versions (id, record_id, version, title, description, value, created_at)
       VALUES ($1, $2, 1, $3, $4, $5, $6)`,
      [versionId, recordId, title.trim(), description.trim(), value.trim(), now]
    );

    // 3. Compute SHA-256 Hash Chain
    const previousHash = await getLatestOperationHash(client);
    const operationHash = computeOperationHash({
      operation_id: operationId,
      record_id: recordId,
      operation_type: "create",
      base_version: null,
      new_version: 1,
      device_id: deviceId,
      timestamp: now,
      payload,
      previous_hash: previousHash,
    });

    // 4. Log operation in operations table with hash chain
    await client.query(
      `INSERT INTO operations (
        id, record_id, operation_type, base_version, new_version, device_id,
        created_at, operation_status, hash, previous_hash, payload
       ) VALUES ($1, $2, 'create', NULL, 1, $3, $4, 'applied', $5, $6, $7)`,
      [
        operationId,
        recordId,
        deviceId,
        now,
        operationHash,
        previousHash,
        JSON.stringify(payload),
      ]
    );

    await client.query("COMMIT");

    // 5. Broadcast real-time event to all connected clients
    broadcastRealtimeEvent(
      "record.created",
      {
        recordId,
        version: 1,
        title: createdRecord.title,
        value: createdRecord.value,
      },
      deviceId
    );

    return NextResponse.json(
      {
        message: "Record created successfully",
        record: createdRecord,
        operationHash,
      },
      { status: 201 }
    );
  } catch (err) {
    await client.query("ROLLBACK");
    const message = err instanceof Error ? err.message : "Server error";
    return NextResponse.json(
      { error: "Failed to create record: " + message },
      { status: 500 }
    );
  } finally {
    client.release();
  }
}