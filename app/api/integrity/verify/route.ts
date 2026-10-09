import { NextResponse } from "next/server";
import { isDatabaseConfigured } from "../../../../lib/postgres";
import { verifyOperationsIntegrity } from "../../../../lib/integrity";

// GET /api/integrity/verify - Verify tamper-evident SHA-256 operation hash chain
export async function GET() {
  if (!isDatabaseConfigured()) {
    return NextResponse.json(
      {
        error: "PostgreSQL is not configured. Set DATABASE_URL in .env.local",
        status: "invalid",
        operationsChecked: 0,
        errors: [{ reason: "Database not configured" }],
      },
      { status: 503 }
    );
  }

  try {
    const result = await verifyOperationsIntegrity();
    return NextResponse.json(result);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Integrity verification failed";
    return NextResponse.json(
      {
        status: "invalid",
        operationsChecked: 0,
        errors: [{ reason: msg }],
        verifiedAt: new Date().toISOString(),
      },
      { status: 500 }
    );
  }
}
