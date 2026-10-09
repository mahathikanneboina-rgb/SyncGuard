import { NextResponse } from "next/server";
import { query, initDatabase, isDatabaseConfigured } from "../../../lib/postgres";

// GET /api/health - Database connection health & table initialization
export async function GET() {
  if (!isDatabaseConfigured()) {
    return NextResponse.json({
      status: "disconnected",
      isConfigured: false,
      message: "DATABASE_URL is not set in .env.local",
    });
  }

  try {
    // Run automated table initialization
    const initResult = await initDatabase();
    if (!initResult.success) {
      return NextResponse.json(
        {
          status: "error",
          isConfigured: true,
          error: initResult.message,
        },
        { status: 500 }
      );
    }

    const recordsCountRes = await query<{ count: string }>("SELECT COUNT(*) FROM records");
    const opsCountRes = await query<{ count: string }>("SELECT COUNT(*) FROM operations");
    const versionsCountRes = await query<{ count: string }>("SELECT COUNT(*) FROM record_versions");

    return NextResponse.json({
      status: "connected",
      isConfigured: true,
      tables: {
        records: parseInt(recordsCountRes.rows[0].count, 10),
        operations: parseInt(opsCountRes.rows[0].count, 10),
        recordVersions: parseInt(versionsCountRes.rows[0].count, 10),
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Database connection failed";
    return NextResponse.json(
      {
        status: "error",
        isConfigured: true,
        error: message,
      },
      { status: 500 }
    );
  }
}