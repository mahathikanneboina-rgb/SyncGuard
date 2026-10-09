import { NextRequest, NextResponse } from "next/server";
import { query, isDatabaseConfigured } from "../../../../../lib/postgres";
import { RecordVersion } from "../../../../../lib/types";

interface RouteParams {
  params: Promise<{ id: string }>;
}

// GET /api/records/[id]/versions - Get version history for a record
export async function GET(req: NextRequest, { params }: RouteParams) {
  if (!isDatabaseConfigured()) {
    return NextResponse.json(
      { error: "PostgreSQL is not configured. Set DATABASE_URL in .env.local" },
      { status: 503 }
    );
  }

  const { id } = await params;

  try {
    const result = await query<RecordVersion>(
      "SELECT id, record_id, version, title, description, value, created_at FROM record_versions WHERE record_id = $1 ORDER BY version DESC",
      [id]
    );

    return NextResponse.json({
      recordId: id,
      versions: result.rows,
      count: result.rowCount,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Database error";
    return NextResponse.json(
      { error: "Failed to fetch record versions: " + message },
      { status: 500 }
    );
  }
}