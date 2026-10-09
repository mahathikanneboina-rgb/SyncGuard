/**
 * realtime.ts - Client-Side Real-Time WebSocket Connection Manager
 *
 * Implements:
 * 1. Connection states: connected | connecting | disconnected | reconnecting
 * 2. Automatic exponential backoff reconnection
 * 3. Real-time event handling (record.*, sync.*, conflict.*, integrity.*, recovery.*)
 * 4. Multi-client synchronization trigger without overwriting uncommitted offline changes
 * 5. In-memory real-time activity event log
 */

import type {
  RealtimeConnectionState,
  RealtimeEventMessage,
  RealtimeEventType,
  SyncActivityItem,
} from "./types";
import { getDeviceId } from "./device";
import { getSyncEngine } from "./syncEngine";
import { logActivity } from "./db";

export type RealtimeStatusListener = (state: RealtimeConnectionState) => void;
export type RealtimeEventListener = (event: RealtimeEventMessage) => void;

class RealtimeClient {
  private ws: WebSocket | null = null;
  private state: RealtimeConnectionState = "disconnected";
  private statusListeners: Set<RealtimeStatusListener> = new Set();
  private eventListeners: Set<RealtimeEventListener> = new Set();
  private reconnectAttempts = 0;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private pingInterval: NodeJS.Timeout | null = null;
  private recentEvents: SyncActivityItem[] = [];

  constructor() {
    if (typeof window !== "undefined") {
      // Connect when browser is online
      window.addEventListener("online", () => {
        this.reconnectAttempts = 0;
        this.connect();
      });

      window.addEventListener("offline", () => {
        this.setState("disconnected");
        this.cleanup();
      });

      // Initial connection attempt
      if (navigator.onLine) {
        this.connect();
      }
    }
  }

  public getState(): RealtimeConnectionState {
    return this.state;
  }

  public getRecentEvents(): SyncActivityItem[] {
    return this.recentEvents;
  }

  public subscribeStatus(listener: RealtimeStatusListener): () => void {
    this.statusListeners.add(listener);
    listener(this.state);
    return () => {
      this.statusListeners.delete(listener);
    };
  }

  public subscribeEvents(listener: RealtimeEventListener): () => void {
    this.eventListeners.add(listener);
    return () => {
      this.eventListeners.delete(listener);
    };
  }

  private setState(newState: RealtimeConnectionState) {
    if (this.state === newState) return;
    this.state = newState;
    for (const l of this.statusListeners) {
      l(this.state);
    }
  }

  public connect(): void {
    if (typeof window === "undefined" || !navigator.onLine) {
      this.setState("disconnected");
      return;
    }

    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) {
      return;
    }

    this.cleanup();

    if (this.reconnectAttempts > 0) {
      this.setState("reconnecting");
    } else {
      this.setState("connecting");
    }

    const host = window.location.hostname || "localhost";
    const port = process.env.NEXT_PUBLIC_WS_PORT || "3001";
    const wsUrl = `ws://${host}:${port}`;

    try {
      this.ws = new WebSocket(wsUrl);

      this.ws.onopen = () => {
        this.reconnectAttempts = 0;
        this.setState("connected");
        this.startHeartbeat();
      };

      this.ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
          this.handleIncomingEvent(msg);
        } catch {
          // ignore non-JSON messages
        }
      };

      this.ws.onclose = () => {
        this.cleanup();
        if (navigator.onLine) {
          this.scheduleReconnect();
        } else {
          this.setState("disconnected");
        }
      };

      this.ws.onerror = () => {
        this.cleanup();
        if (navigator.onLine) {
          this.scheduleReconnect();
        } else {
          this.setState("disconnected");
        }
      };
    } catch {
      this.scheduleReconnect();
    }
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer || typeof window === "undefined" || !navigator.onLine) return;

    this.reconnectAttempts++;
    this.setState("reconnecting");

    // Exponential backoff: 1s, 2s, 4s, 8s, max 15s
    const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts - 1), 15000);

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, delay);
  }

  private startHeartbeat(): void {
    this.stopHeartbeat();
    this.pingInterval = setInterval(() => {
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        try {
          this.ws.send(JSON.stringify({ type: "ping" }));
        } catch {
          // ignore
        }
      }
    }, 20000);
  }

  private stopHeartbeat(): void {
    if (this.pingInterval) {
      clearInterval(this.pingInterval);
      this.pingInterval = null;
    }
  }

  private cleanup(): void {
    this.stopHeartbeat();
    if (this.ws) {
      this.ws.onopen = null;
      this.ws.onmessage = null;
      this.ws.onclose = null;
      this.ws.onerror = null;
      if (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING) {
        try {
          this.ws.close();
        } catch {
          // ignore
        }
      }
      this.ws = null;
    }
  }

  /**
   * Handle real-time incoming event from WebSocket
   */
  private handleIncomingEvent(event: RealtimeEventMessage): void {
    const myDeviceId = getDeviceId();

    // Notify all UI event listeners
    for (const listener of this.eventListeners) {
      listener(event);
    }

    const timeStr = new Date().toLocaleTimeString(undefined, {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });

    // Record in in-memory real-time activity log
    const activityItem: SyncActivityItem = {
      id: crypto.randomUUID(),
      timestamp: event.timestamp || new Date().toISOString(),
      title: `[Real-Time] ${this.formatEventTitle(event.type)}`,
      description: this.formatEventDescription(event),
      type: "realtime",
    };

    this.recentEvents = [activityItem, ...this.recentEvents.slice(0, 19)];

    // If event originated from another device, trigger smart background pull
    if (event.deviceId !== myDeviceId) {
      if (
        event.type === "record.created" ||
        event.type === "record.updated" ||
        event.type === "record.deleted" ||
        event.type === "conflict.resolved" ||
        event.type === "recovery.completed"
      ) {
        // Run sync pull phase to update local IndexedDB records
        getSyncEngine().runSync();
      }
    }
  }

  private formatEventTitle(type: RealtimeEventType): string {
    switch (type) {
      case "record.created":
        return "Record Created";
      case "record.updated":
        return "Record Updated";
      case "record.deleted":
        return "Record Deleted";
      case "conflict.detected":
        return "Conflict Detected";
      case "conflict.resolved":
        return "Conflict Resolved";
      case "recovery.completed":
        return "Version Restored";
      case "sync.started":
        return "Sync Started";
      case "sync.completed":
        return "Sync Completed";
      case "integrity.checked":
        return "Integrity Verified";
      default:
        return "Event Received";
    }
  }

  private formatEventDescription(event: RealtimeEventMessage): string {
    const data = (event.data as Record<string, unknown>) || {};
    const recordTitle = (data.title as string) || (data.recordTitle as string) || "Record";

    switch (event.type) {
      case "record.created":
        return `New record "${recordTitle}" added by ${event.deviceId || "device"}`;
      case "record.updated":
        return `Record "${recordTitle}" updated to v${data.version || ""} by ${event.deviceId || "device"}`;
      case "record.deleted":
        return `Record deleted by ${event.deviceId || "device"}`;
      case "conflict.detected":
        return `Version conflict on "${recordTitle}" (Server v${data.serverVersion} vs Local v${data.localVersion})`;
      case "conflict.resolved":
        return `Conflict on "${recordTitle}" resolved as v${data.finalVersion}`;
      case "recovery.completed":
        return `Restored "${recordTitle}" to v${data.newVersion}`;
      default:
        return `Real-time event received from ${event.deviceId || "server"}`;
    }
  }

  /**
   * Broadcast an event from client to all other connected clients
   */
  public sendEvent<T = unknown>(type: RealtimeEventType, data: T): void {
    const message: RealtimeEventMessage<T> = {
      type,
      timestamp: new Date().toISOString(),
      deviceId: getDeviceId(),
      data,
    };

    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      try {
        this.ws.send(JSON.stringify(message));
      } catch {
        // ignore
      }
    }
  }
}

// Global Singleton
let globalRealtimeClient: RealtimeClient | null = null;

export function getRealtimeClient(): RealtimeClient {
  if (!globalRealtimeClient) {
    globalRealtimeClient = new RealtimeClient();
  }
  return globalRealtimeClient;
}
