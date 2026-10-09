"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { getRealtimeClient } from "../lib/realtime";
import type { RealtimeEventMessage } from "../lib/types";

export default function RealtimeConflictToast() {
  const [toast, setToast] = useState<{
    id: string;
    recordTitle: string;
    recordId: string;
    serverVersion: number;
    localVersion: number;
  } | null>(null);

  useEffect(() => {
    const client = getRealtimeClient();
    const unsub = client.subscribeEvents((event: RealtimeEventMessage) => {
      if (event.type === "conflict.detected") {
        const data = (event.data as Record<string, unknown>) || {};
        setToast({
          id: String(data.conflictId || crypto.randomUUID()),
          recordTitle: String(data.recordTitle || "Record"),
          recordId: String(data.recordId || ""),
          serverVersion: Number(data.serverVersion || 2),
          localVersion: Number(data.localVersion || 1),
        });

        // Auto-dismiss after 10s
        setTimeout(() => {
          setToast(null);
        }, 10000);
      }
    });

    return () => unsub();
  }, []);

  if (!toast) return null;

  return (
    <div className="fixed bottom-6 right-6 z-50 max-w-sm w-full animate-slide-up">
      <div className="rounded-2xl border border-red-800 bg-zinc-900/95 p-4 shadow-2xl backdrop-blur-md text-zinc-100 space-y-3">
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-2 text-red-400 font-semibold text-sm">
            <span className="h-2.5 w-2.5 rounded-full bg-red-400 animate-ping" />
            <span>Real-Time Conflict Detected</span>
          </div>
          <button
            onClick={() => setToast(null)}
            className="text-zinc-500 hover:text-zinc-300 text-xs"
          >
            ✕
          </button>
        </div>

        <p className="text-xs text-zinc-300">
          Record <strong className="text-zinc-100">&quot;{toast.recordTitle}&quot;</strong> has concurrent offline modifications.
        </p>

        <div className="flex items-center justify-between pt-1">
          <span className="text-[11px] text-zinc-500 font-mono">
            Server: v{toast.serverVersion} • Local: v{toast.localVersion}
          </span>
          <Link
            href="/conflicts"
            onClick={() => setToast(null)}
            className="rounded-lg bg-red-500 hover:bg-red-400 px-3 py-1.5 text-xs font-semibold text-zinc-950 transition-colors shadow-sm"
          >
            View Conflict →
          </Link>
        </div>
      </div>
    </div>
  );
}
