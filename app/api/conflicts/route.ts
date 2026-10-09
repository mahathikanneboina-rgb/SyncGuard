import { NextResponse } from "next/server";
import { query, isDatabaseConfigured } from "../../../lib/postgres";

// GET /api/conflicts - List all conflicts logged on server
export async function GET() {
  if (!isDatabaseConfigured()) {
    return NextResponse.json(
      { error: "PostgreSQL is not configured. Set DATABASE_URL in .env.local", conflicts: [] },
      { status: 503 }
    );
  }

  try {
    const result = await query(
      `SELECT o.id as operation_id, o.record_id, o.base_version, o.new_version as server_version,
              o.device_id, o.created_at, o.operation_status,
              r.title as current_title, r.version as current_version
       FROM operations o
       LEFT JOIN records r ON o.record_id = r.id
       WHERE o.operation_status = 'conflict'
       ORDER BY o.created_at DESC`
    );

    return NextResponse.json({
      conflicts: result.rows,
      count: result.rowCount,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Database error";
    return NextResponse.json(
      { error: "Failed to fetch conflicts: " + msg },
      { status: 500 }
    );
  }
}
