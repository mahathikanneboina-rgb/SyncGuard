import { NextRequest, NextResponse } from "next/server";
import { query, isDatabaseConfigured } from "../../../../lib/postgres";

// POST /api/integrity/simulate-tamper - Test endpoint for Test B (demonstrating tamper detection)
export async function POST(req: NextRequest) {
  if (!isDatabaseConfigured()) {
    return NextResponse.json(
      { error: "PostgreSQL is not configured. Set DATABASE_URL in .env.local" },
      { status: 503 }
    );
  }

  let body: { operationId?: string; tamperedPayload?: Record<string, unknown> };
  try {
    body = await req.json();
  } catch {
    body = {};
  }

  try {
    let targetOpId = body.operationId;

    if (!targetOpId) {
      // Pick the most recent operation with a hash
      const latest = await query<{ id: string }>(
        "SELECT id FROM operations WHERE hash IS NOT NULL ORDER BY created_at DESC LIMIT 1"
      );
      if (latest.rows.length === 0) {
        return NextResponse.json(
          { error: "No hashed operations found to tamper. Create a record first." },
          { status: 400 }
        );
      }
      targetOpId = latest.rows[0].id;
    }

    // Alter the stored payload or operation_type in PostgreSQL without updating the hash
    await query(
      `UPDATE operations
       SET payload = jsonb_set(COALESCE(payload, '{}'::jsonb), '{tampered}', '"UNAUTHORIZED_MODIFICATION"'::jsonb)
       WHERE id = $1`,
      [targetOpId]
    );

    return NextResponse.json({
      message: "Operation payload tampered for testing. Run 'Verify Integrity' to test tamper detection.",
      tamperedOperationId: targetOpId,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Database error";
    return NextResponse.json({ error: "Failed to simulate tamper: " + msg }, { status: 500 });
  }
}
