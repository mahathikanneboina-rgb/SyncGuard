import { NextRequest, NextResponse } from "next/server";
import { broadcastRealtimeEvent } from "../../../../lib/broadcaster";
import { RealtimeEventType } from "../../../../lib/types";

// POST /api/events/broadcast - Broadcast an event to all connected WebSocket clients
export async function POST(req: NextRequest) {
  let body: {
    type?: RealtimeEventType;
    data?: unknown;
    deviceId?: string;
  };

  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON request body" }, { status: 400 });
  }

  if (!body.type) {
    return NextResponse.json({ error: "'type' is required" }, { status: 400 });
  }

  broadcastRealtimeEvent(body.type, body.data, body.deviceId);

  return NextResponse.json({ success: true, broadcastedType: body.type });
}
