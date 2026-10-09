import { NextRequest, NextResponse } from "next/server";
import { query, isDatabaseConfigured } from "../../../lib/postgres";
import { ServerOperation } from "../../../lib/types";

// GET /api/operations - Retrieve server operations log
export async function GET(req: NextRequest) {
  if (!isDatabaseConfigured()) {
    return NextResponse.json(
      {
        error: "PostgreSQL is not configured. Set DATABASE_URL in .env.local",
        isConfigured: false,
        operations: [],
      },
      { status: 503 }
    );
  }

  const recordId = req.nextUrl.searchParams.get("recordId");
  const limitParam = req.nextUrl.searchParams.get("limit");
  const limit = limitParam ? Math.min(Math.max(parseInt(limitParam, 10) || 50, 1), 100) : 50;

  try {
    let result;
    if (recordId) {
      result = await query<ServerOperation>(
        "SELECT id, record_id, operation_type, base_version, new_version, device_id, created_at, operation_status FROM operations WHERE record_id = $1 ORDER BY created_at DESC LIMIT $2",
        [recordId, limit]
      );
    } else {
      result = await query<ServerOperation>(
        "SELECT id, record_id, operation_type, base_version, new_version, device_id, created_at, operation_status FROM operations ORDER BY created_at DESC LIMIT $1",
        [limit]
      );
    }

    return NextResponse.json({
      operations: result.rows,
      count: result.rowCount,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Database query failed";
    return NextResponse.json(
      { error: "Failed to fetch operations log: " + message },
      { status: 500 }
    );
  }
}