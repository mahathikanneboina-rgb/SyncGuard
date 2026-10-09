import { NextResponse } from "next/server";
import { query, isDatabaseConfigured } from "../../../../lib/postgres";

// GET /api/conflicts/history - Get resolved conflicts audit history
export async function GET() {
  if (!isDatabaseConfigured()) {
    return NextResponse.json(
      { error: "PostgreSQL is not configured. Set DATABASE_URL in .env.local", history: [] },
      { status: 503 }
    );
  }

  try {
    const result = await query(
      `SELECT cr.id, cr.conflict_id, cr.record_id, cr.original_version,
              cr.local_version, cr.server_version, cr.resolution_type,
              cr.resolved_value, cr.resolved_by, cr.final_version, cr.created_at,
              r.title as current_record_title
       FROM conflict_resolutions cr
       LEFT JOIN records r ON cr.record_id = r.id
       ORDER BY cr.created_at DESC`
    );

    return NextResponse.json({
      history: result.rows,
      count: result.rowCount,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Database error";
    return NextResponse.json(
      { error: "Failed to fetch conflict resolution history: " + msg },
      { status: 500 }
    );
  }
}
