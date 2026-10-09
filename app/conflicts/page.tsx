"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { getUnresolvedConflicts } from "../../lib/db";
import { getSyncEngine } from "../../lib/syncEngine";
import type { ConflictDetail } from "../../lib/types";
import OnlineStatus from "../../components/OnlineStatus";
import ConflictResolutionModal from "../../components/ConflictResolutionModal";

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

export default function ConflictsPage() {
  const [conflicts, setConflicts] = useState<ConflictDetail[]>([]);
  const [selectedConflict, setSelectedConflict] = useState<ConflictDetail | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const loadConflicts = useCallback(async () => {
    try {
      const active = await getUnresolvedConflicts();
      setConflicts(active);
    } catch {
      // ignore
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadConflicts();

    const engine = getSyncEngine();
    const unsubscribe = engine.subscribe(() => {
      loadConflicts();
    });

    return () => unsubscribe();
  }, [loadConflicts]);

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
              <span className="text-zinc-300">Conflicts</span>
            </div>
            <h1 className="text-3xl font-semibold tracking-tight">Version Conflicts</h1>
            <p className="mt-1 text-sm text-zinc-400">
              Review concurrent offline modifications and resolve without losing data
            </p>
          </div>

          <div className="flex items-center gap-3">
            <Link
              href="/conflicts/history"
              id="nav-conflict-history"
              className="rounded-lg border border-zinc-700 px-3.5 py-1.5 text-xs text-zinc-300 hover:bg-zinc-800 transition-colors"
            >
              Conflict History →
            </Link>
            <OnlineStatus />
          </div>
        </header>

        {/* Conflict List */}
        <section className="mt-8">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-xl font-medium">
              Unresolved Conflicts
              {!isLoading && (
                <span className="ml-2 text-sm font-normal text-zinc-500">
                  ({conflicts.length})
                </span>
              )}
            </h2>
          </div>

          {isLoading ? (
            <div className="rounded-2xl border border-zinc-800 bg-zinc-900 p-12 text-center text-zinc-500 text-sm">
              Loading active conflicts...
            </div>
          ) : conflicts.length === 0 ? (
            <div className="rounded-2xl border border-zinc-800 bg-zinc-900 p-12 text-center space-y-3">
              <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-emerald-500/10 text-emerald-400 text-xl">
                ✓
              </div>
              <p className="text-zinc-200 font-medium">No Active Version Conflicts</p>
              <p className="text-xs text-zinc-500 max-w-md mx-auto">
                All local offline changes are fully in sync with the central PostgreSQL server.
              </p>
              <div className="pt-2 flex justify-center gap-3">
                <Link
                  href="/records"
                  className="rounded-lg bg-zinc-100 px-4 py-2 text-xs font-semibold text-zinc-900 hover:bg-white transition-colors"
                >
                  Manage Records
                </Link>
                <Link
                  href="/conflicts/history"
                  className="rounded-lg border border-zinc-800 px-4 py-2 text-xs text-zinc-400 hover:text-zinc-200 transition-colors"
                >
                  View Resolved History
                </Link>
              </div>
            </div>
          ) : (
            <div className="grid gap-4">
              {conflicts.map((conflict) => (
                <div
                  key={conflict.id}
                  className="rounded-2xl border border-red-900/60 bg-zinc-900 p-6 space-y-4 hover:border-red-800 transition-colors"
                >
                  <div className="flex flex-wrap items-start justify-between gap-4">
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="rounded bg-red-950 text-red-400 border border-red-800 px-2 py-0.5 text-xs font-mono">
                          Conflict #{conflict.id.slice(0, 8)}
                        </span>
                        <span className="rounded-full bg-amber-400/10 text-amber-400 border border-amber-800 px-2.5 py-0.5 text-xs font-medium">
                          Status: Unresolved
                        </span>
                      </div>
                      <h3 className="text-lg font-medium text-zinc-100 mt-2">
                        Record: {conflict.local_changes.title || conflict.record_id}
                      </h3>
                      <p className="text-xs text-zinc-500 font-mono mt-0.5">
                        Record ID: {conflict.record_id} • Device: {conflict.device_id}
                      </p>
                    </div>

                    <button
                      id={`btn-resolve-${conflict.id}`}
                      onClick={() => setSelectedConflict(conflict)}
                      className="rounded-xl bg-red-500 hover:bg-red-400 px-5 py-2.5 text-xs font-semibold text-zinc-950 transition-colors shadow-lg"
                    >
                      Review & Resolve Conflict →
                    </button>
                  </div>

                  {/* Version breakdown pills */}
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs border-t border-zinc-800 pt-4">
                    <div className="rounded-lg border border-zinc-800 bg-zinc-950 p-3">
                      <span className="text-zinc-500 block text-[11px]">Original Base</span>
                      <span className="font-semibold text-zinc-300">Version {conflict.original_version}</span>
                    </div>

                    <div className="rounded-lg border border-amber-900/40 bg-amber-950/10 p-3">
                      <span className="text-amber-500/80 block text-[11px]">Local Change</span>
                      <span className="font-semibold text-amber-300">Version {conflict.local_version}</span>
                    </div>

                    <div className="rounded-lg border border-emerald-900/40 bg-emerald-950/10 p-3">
                      <span className="text-emerald-500/80 block text-[11px]">Server Accepted</span>
                      <span className="font-semibold text-emerald-300">Version {conflict.server_version}</span>
                    </div>

                    <div className="rounded-lg border border-zinc-800 bg-zinc-950 p-3">
                      <span className="text-zinc-500 block text-[11px]">Detected At</span>
                      <span className="text-zinc-400 truncate block">{formatDate(conflict.timestamp)}</span>
                    </div>
                  </div>

                  <p className="text-xs text-zinc-400 bg-zinc-950/60 p-3 rounded-lg border border-zinc-800/80">
                    <strong className="text-red-400">Reason:</strong> {conflict.reason}
                  </p>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* Resolution Modal */}
        {selectedConflict && (
          <ConflictResolutionModal
            conflict={selectedConflict}
            onClose={() => setSelectedConflict(null)}
            onResolved={() => {
              loadConflicts();
            }}
          />
        )}

      </div>
    </main>
  );
}
