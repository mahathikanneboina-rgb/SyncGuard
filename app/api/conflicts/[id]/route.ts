import { NextRequest, NextResponse } from "next/server";
import { query, isDatabaseConfigured } from "../../../../lib/postgres";

interface RouteParams {
  params: Promise<{ id: string }>;
}

// GET /api/conflicts/[id] - Get details for a specific conflict
export async function GET(req: NextRequest, { params }: RouteParams) {
  if (!isDatabaseConfigured()) {
    return NextResponse.json(
      { error: "PostgreSQL is not configured. Set DATABASE_URL in .env.local" },
      { status: 503 }
    );
  }

  const { id } = await params;

  try {
    const res = await query(
      `SELECT o.id as operation_id, o.record_id, o.base_version, o.new_version as server_version,
              o.device_id, o.created_at, o.operation_status,
              r.title as current_title, r.description as current_description,
              r.value as current_value, r.version as current_version
       FROM operations o
       LEFT JOIN records r ON o.record_id = r.id
       WHERE o.id = $1 OR o.record_id = $1
       ORDER BY o.created_at DESC LIMIT 1`,
      [id]
    );

    if (res.rows.length === 0) {
      return NextResponse.json({ error: "Conflict not found" }, { status: 404 });
    }

    return NextResponse.json({ conflict: res.rows[0] });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Database error";
    return NextResponse.json(
      { error: "Failed to fetch conflict: " + msg },
      { status: 500 }
    );
  }
}
