"use client";

import { useEffect, useState } from "react";
import { getSyncEngine } from "../lib/syncEngine";
import { getRealtimeClient } from "../lib/realtime";
import type { SyncEngineStatus, RealtimeConnectionState } from "../lib/types";

const SYNC_CONFIG: Record<
  SyncEngineStatus,
  { label: string; dotClass: string; containerClass: string }
> = {
  synced: {
    label: "Synced",
    dotClass: "bg-emerald-400",
    containerClass: "border-emerald-800/80 bg-emerald-950/20 text-emerald-300",
  },
  pending: {
    label: "Pending",
    dotClass: "bg-amber-400 animate-pulse",
    containerClass: "border-amber-800/80 bg-amber-950/20 text-amber-300",
  },
  synchronizing: {
    label: "Synchronizing...",
    dotClass: "bg-sky-400 animate-spin",
    containerClass: "border-sky-800/80 bg-sky-950/30 text-sky-300",
  },
  conflict: {
    label: "Conflict",
    dotClass: "bg-red-400 animate-pulse",
    containerClass: "border-red-800/80 bg-red-950/30 text-red-300",
  },
  failed: {
    label: "Sync Failed",
    dotClass: "bg-rose-400",
    containerClass: "border-rose-800/80 bg-rose-950/30 text-rose-300",
  },
  offline: {
    label: "Offline",
    dotClass: "bg-zinc-400 animate-pulse",
    containerClass: "border-zinc-700 bg-zinc-900 text-zinc-400",
  },
};

const RT_CONFIG: Record<
  RealtimeConnectionState,
  { label: string; dotClass: string; containerClass: string }
> = {
  connected: {
    label: "Real-time Connected",
    dotClass: "bg-emerald-400",
    containerClass: "border-emerald-900/60 bg-emerald-950/30 text-emerald-400",
  },
  connecting: {
    label: "Connecting...",
    dotClass: "bg-sky-400 animate-spin",
    containerClass: "border-sky-900/60 bg-sky-950/30 text-sky-300",
  },
  reconnecting: {
    label: "Reconnecting...",
    dotClass: "bg-amber-400 animate-pulse",
    containerClass: "border-amber-900/60 bg-amber-950/30 text-amber-300",
  },
  disconnected: {
    label: "Disconnected",
    dotClass: "bg-zinc-500",
    containerClass: "border-zinc-800 bg-zinc-900 text-zinc-400",
  },
};

export default function OnlineStatus() {
  const [syncState, setSyncState] = useState<{
    status: SyncEngineStatus;
    isOnline: boolean;
    pendingCount: number;
    conflictCount: number;
    failedCount: number;
  }>({
    status: "synced",
    isOnline: true,
    pendingCount: 0,
    conflictCount: 0,
    failedCount: 0,
  });

  const [realtimeState, setRealtimeState] = useState<RealtimeConnectionState>("connecting");

  useEffect(() => {
    const engine = getSyncEngine();
    const rtClient = getRealtimeClient();

    const unsubEngine = engine.subscribe((state) => {
      setSyncState({
        status: state.status,
        isOnline: state.isOnline,
        pendingCount: state.pendingCount,
        conflictCount: state.conflictCount,
        failedCount: state.failedCount,
      });
    });

    const unsubRt = rtClient.subscribeStatus((state) => {
      setRealtimeState(state);
    });

    return () => {
      unsubEngine();
      unsubRt();
    };
  }, []);

  const syncConfig = SYNC_CONFIG[syncState.status] || SYNC_CONFIG.synced;
  const rtConfig = RT_CONFIG[realtimeState] || RT_CONFIG.disconnected;

  return (
    <div className="flex flex-wrap items-center gap-2">
      {/* Real-time WebSocket connection state indicator */}
      <div
        className={
          "flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition-colors " +
          rtConfig.containerClass
        }
        title="WebSocket Real-Time Channel Status"
      >
        <span className={"h-2 w-2 rounded-full " + rtConfig.dotClass} />
        <span>{rtConfig.label}</span>
      </div>

      {/* Online / Offline badge */}
      <div
        className={
          "flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition-colors " +
          (syncState.isOnline
            ? "border-zinc-800 bg-zinc-900 text-zinc-300"
            : "border-amber-700/80 bg-amber-950/40 text-amber-400")
        }
      >
        <span
          className={
            "h-2 w-2 rounded-full " +
            (syncState.isOnline ? "bg-emerald-400" : "bg-amber-400 animate-pulse")
          }
        />
        {syncState.isOnline ? "Online" : "Offline"}
      </div>

      {/* Sync Engine Status Pill */}
      <div
        className={
          "flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition-colors " +
          syncConfig.containerClass
        }
        aria-live="polite"
      >
        <span className={"h-2 w-2 rounded-full " + syncConfig.dotClass} />
        <span>{syncConfig.label}</span>
      </div>
    </div>
  );
}