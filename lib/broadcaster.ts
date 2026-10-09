import { WebSocketServer, WebSocket } from "ws";
import type { RealtimeEventMessage, RealtimeEventType } from "./types";

declare global {
  // eslint-disable-next-line no-var
  var _syncguardWss: WebSocketServer | undefined;
  // eslint-disable-next-line no-var
  var _syncguardClients: Set<WebSocket> | undefined;
}

const WS_PORT = parseInt(process.env.WS_PORT || "3001", 10);

/**
 * Initializes or retrieves the global WebSocket server instance
 */
export function getWebSocketServer(): {
  wss: WebSocketServer | null;
  clients: Set<WebSocket>;
} {
  if (typeof window !== "undefined") {
    return { wss: null, clients: new Set() };
  }

  if (!globalThis._syncguardClients) {
    globalThis._syncguardClients = new Set<WebSocket>();
  }

  return {
    wss: globalThis._syncguardWss || null,
    clients: globalThis._syncguardClients,
  };
}

/**
 * Broadcasts a real-time event to all connected WebSocket clients
 */
export async function broadcastRealtimeEvent<T = unknown>(
  type: RealtimeEventType,
  data: T,
  deviceId?: string
): Promise<void> {
  const message: RealtimeEventMessage<T> = {
    type,
    timestamp: new Date().toISOString(),
    deviceId,
    data,
  };

  const payloadStr = JSON.stringify(message);

  // 1. Direct WebSocket broadcast to any local clients
  const { clients } = getWebSocketServer();
  if (clients) {
    for (const ws of clients) {
      if (ws.readyState === WebSocket.OPEN) {
        try {
          ws.send(payloadStr);
        } catch {
          // ignore
        }
      }
    }
  }

  // 2. Forward to standalone WebSocket server on port 3001 via HTTP broadcast
  try {
    fetch(`http://127.0.0.1:${WS_PORT}/broadcast`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: payloadStr,
    }).catch(() => {
      // Non-blocking if WS server is starting or restarting
    });
  } catch {
    // ignore
  }
}
