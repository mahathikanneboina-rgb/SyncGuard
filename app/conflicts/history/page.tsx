"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { getResolvedConflicts } from "../../../lib/db";
import { fetchConflictHistory } from "../../../lib/conflicts";
import type { ConflictDetail, ConflictResolutionRecord } from "../../../lib/types";
import OnlineStatus from "../../../components/OnlineStatus";

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleString(undefined, {
      dateStyle: "medium",
      timeStyle: "short",
    });
  } catch {
    return iso;
  }
}

export default function ConflictHistoryPage() {
  const [localResolved, setLocalResolved] = useState<ConflictDetail[]>([]);
  const [serverHistory, setServerHistory] = useState<ConflictResolutionRecord[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    async function loadData() {
      try {
        const [localRes, serverRes] = await Promise.all([
          getResolvedConflicts(),
          fetchConflictHistory(),
        ]);
        setLocalResolved(localRes);
        setServerHistory(serverRes.history || []);
      } catch {
        // ignore
      } finally {
        setIsLoading(false);
      }
    }
    loadData();
  }, []);

  // Merge server and local history
  const allResolvedCount = Math.max(localResolved.length, serverHistory.length);

  return (
    <main className="min-h-screen bg-zinc-950 text-zinc-100">
      <div className="mx-auto max-w-6xl px-6 py-8">

        {/* Header */}
        <header className="flex flex-wrap items-center justify-between gap-4 border-b border-zinc-800 pb-6">
          <div>
            <div className="flex items-center gap-2 text-sm text-zinc-500 mb-1">
              <Link href="/" className="hover:text-zinc-300 transition-colors">
                SyncGuard
              </Link>
              <span>/</span>
              <Link href="/conflicts" className="hover:text-zinc-300 transition-colors">
                Conflicts
              </Link>
              <span>/</span>
              <span className="text-zinc-300">History</span>
            </div>
            <h1 className="text-3xl font-semibold tracking-tight">Conflict Resolution History</h1>
            <p className="mt-1 text-sm text-zinc-400">
              Audit trail of resolved conflicts, preserved version snapshots, and merge decisions
            </p>
          </div>

          <div className="flex items-center gap-3">
            <Link
              href="/conflicts"
              className="rounded-lg border border-zinc-700 px-3.5 py-1.5 text-xs text-zinc-300 hover:bg-zinc-800 transition-colors"
            >
              ← Active Conflicts
            </Link>
            <OnlineStatus />
          </div>
        </header>

        {/* History List */}
        <section className="mt-8">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-xl font-medium">
              Resolved Conflicts Log
              {!isLoading && (
                <span className="ml-2 text-sm font-normal text-zinc-500">
                  ({allResolvedCount})
                </span>
              )}
            </h2>
          </div>

          {isLoading ? (
            <div className="rounded-2xl border border-zinc-800 bg-zinc-900 p-12 text-center text-zinc-500 text-sm">
              Loading resolution history...
            </div>
          ) : localResolved.length === 0 && serverHistory.length === 0 ? (
            <div className="rounded-2xl border border-zinc-800 bg-zinc-900 p-12 text-center space-y-3">
              <p className="text-zinc-400 font-medium">No Resolved Conflicts Yet</p>
              <p className="text-xs text-zinc-600 max-w-md mx-auto">
                When version conflicts occur and are resolved via Keep Local, Keep Server, or Manual Merge, their complete audit logs will be displayed here.
              </p>
            </div>
          ) : (
            <div className="space-y-4">
              {/* Server-backed resolution history */}
              {serverHistory.map((item) => (
                <div
                  key={item.id}
                  className="rounded-2xl border border-zinc-800 bg-zinc-900 p-6 space-y-4 hover:border-zinc-700 transition-colors"
                >
                  <div className="flex flex-wrap items-start justify-between gap-4">
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="rounded bg-zinc-800 text-zinc-300 border border-zinc-700 px-2 py-0.5 text-xs font-mono">
                          Conflict #{item.conflict_id.slice(0, 8)}
                        </span>
                        <span className="rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-800 px-2.5 py-0.5 text-xs font-medium">
                          Resolved: {item.resolution_type.replace("_", " ").toUpperCase()}
                        </span>
                        <span className="rounded-full bg-sky-500/10 text-sky-400 border border-sky-800 px-2.5 py-0.5 text-xs font-semibold font-mono">
                          Final Version: v{item.final_version}
                        </span>
                      </div>

                      <h3 className="text-lg font-medium text-zinc-100 mt-2">
                        Record ID: {item.record_id}
                      </h3>
                      <p className="text-xs text-zinc-500 font-mono mt-0.5">
                        Resolved By: {item.resolved_by || "device"} • Resolved At: {formatDate(item.created_at)}
                      </p>
                    </div>
                  </div>

                  {/* Version Lineage Breakdown */}
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs border-t border-zinc-800 pt-4">
                    <div className="rounded-lg border border-zinc-800 bg-zinc-950 p-3">
                      <span className="text-zinc-500 block text-[11px]">Original Base</span>
                      <span className="font-semibold text-zinc-300">v{item.original_version}</span>
                    </div>

                    <div className="rounded-lg border border-amber-900/40 bg-amber-950/10 p-3">
                      <span className="text-amber-500/80 block text-[11px]">Local Conflicting</span>
                      <span className="font-semibold text-amber-300">v{item.local_version}</span>
                    </div>

                    <div className="rounded-lg border border-emerald-900/40 bg-emerald-950/10 p-3">
                      <span className="text-emerald-500/80 block text-[11px]">Server Conflicting</span>
                      <span className="font-semibold text-emerald-300">v{item.server_version}</span>
                    </div>

                    <div className="rounded-lg border border-sky-900/40 bg-sky-950/10 p-3">
                      <span className="text-sky-400 block text-[11px]">Final Applied</span>
                      <span className="font-semibold text-sky-300">v{item.final_version}</span>
                    </div>
                  </div>

                  {/* Final Resolved Value Preview */}
                  <div className="rounded-xl border border-zinc-800 bg-zinc-950 p-3 text-xs space-y-1">
                    <span className="text-zinc-500 font-semibold block text-[11px] uppercase tracking-wider">
                      Applied Resolution Snapshot
                    </span>
                    <div className="flex flex-wrap gap-x-6 gap-y-1 text-zinc-300 pt-1">
                      <span><strong>Title:</strong> {item.resolved_value.title}</span>
                      <span><strong>Value:</strong> <span className="font-mono text-emerald-400">{item.resolved_value.value || "(empty)"}</span></span>
                      {item.resolved_value.description && (
                        <span><strong>Description:</strong> {item.resolved_value.description}</span>
                      )}
                    </div>
                  </div>
                </div>
              ))}

              {/* Local-only resolved items (if any not yet pushed to server history) */}
              {localResolved
                .filter((lr) => !serverHistory.some((sh) => sh.conflict_id === lr.id))
                .map((localItem) => (
                  <div
                    key={localItem.id}
                    className="rounded-2xl border border-zinc-800 bg-zinc-900 p-6 space-y-4 hover:border-zinc-700 transition-colors"
                  >
                    <div className="flex items-center gap-2">
                      <span className="rounded bg-zinc-800 text-zinc-300 border border-zinc-700 px-2 py-0.5 text-xs font-mono">
                        Conflict #{localItem.id.slice(0, 8)}
                      </span>
                      <span className="rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-800 px-2.5 py-0.5 text-xs font-medium">
                        Resolved Locally: {localItem.resolution?.type.replace("_", " ").toUpperCase()}
                      </span>
                      <span className="rounded-full bg-sky-500/10 text-sky-400 border border-sky-800 px-2.5 py-0.5 text-xs font-semibold font-mono">
                        Final Version: v{localItem.resolution?.final_version}
                      </span>
                    </div>

                    <h3 className="text-lg font-medium text-zinc-100">
                      Record: {localItem.resolution?.resolved_value.title || localItem.record_id}
                    </h3>
                  </div>
                ))}
            </div>
          )}
        </section>

      </div>
    </main>
  );
}
