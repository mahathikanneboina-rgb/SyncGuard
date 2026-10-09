"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { getAllRecords, getRecentActivity, getUnresolvedConflicts } from "../lib/db";
import { getSyncEngine } from "../lib/syncEngine";
import { getRealtimeClient } from "../lib/realtime";
import { checkServerHealth } from "../lib/api";
import type {
  SyncActivityItem,
  SyncEngineStatus,
  ConflictDetail,
  IntegrityVerificationResult,
} from "../lib/types";
import OnlineStatus from "../components/OnlineStatus";

function formatTime(iso: string | null): string {
  if (!iso) return "Never";
  try {
    return new Date(iso).toLocaleTimeString(undefined, {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
  } catch {
    return iso;
  }
}

export default function Home() {
  const [syncState, setSyncState] = useState<{
    status: SyncEngineStatus;
    isOnline: boolean;
    pendingCount: number;
    conflictCount: number;
    failedCount: number;
    lastSyncTime: string | null;
  }>({
    status: "synced",
    isOnline: true,
    pendingCount: 0,
    conflictCount: 0,
    failedCount: 0,
    lastSyncTime: null,
  });

  const [totalRecords, setTotalRecords] = useState<number>(0);
  const [activeConflicts, setActiveConflicts] = useState<ConflictDetail[]>([]);
  const [activities, setActivities] = useState<SyncActivityItem[]>([]);
  const [realtimeEvents, setRealtimeEvents] = useState<SyncActivityItem[]>([]);
  const [serverHealth, setServerHealth] = useState<{
    connected: boolean;
    isConfigured: boolean;
    message?: string;
  }>({ connected: false, isConfigured: false });
  const [isSyncing, setIsSyncing] = useState(false);

  // Integrity State
  const [integrityResult, setIntegrityResult] = useState<IntegrityVerificationResult | null>(null);
  const [isVerifyingIntegrity, setIsVerifyingIntegrity] = useState(false);

  const refreshData = useCallback(async () => {
    try {
      const [recs, acts, confs, health] = await Promise.all([
        getAllRecords(),
        getRecentActivity(10),
        getUnresolvedConflicts(),
        checkServerHealth(),
      ]);
      setTotalRecords(recs.length);
      setActivities(acts);
      setActiveConflicts(confs);
      setServerHealth(health);

      const rtClient = getRealtimeClient();
      setRealtimeEvents(rtClient.getRecentEvents());
    } catch {
      // ignore
    }
  }, []);

  const runIntegrityCheck = useCallback(async () => {
    setIsVerifyingIntegrity(true);
    try {
      const res = await fetch("/api/integrity/verify");
      const data: IntegrityVerificationResult = await res.json();
      setIntegrityResult(data);
    } catch {
      // ignore
    } finally {
      setIsVerifyingIntegrity(false);
    }
  }, []);

  useEffect(() => {
    refreshData();
    runIntegrityCheck();

    const engine = getSyncEngine();
    const rtClient = getRealtimeClient();

    const unsubEngine = engine.subscribe((state) => {
      setSyncState(state);
      refreshData();
    });

    const unsubRtEvents = rtClient.subscribeEvents(() => {
      refreshData();
    });

    return () => {
      unsubEngine();
      unsubRtEvents();
    };
  }, [refreshData, runIntegrityCheck]);

  async function handleSyncNow() {
    setIsSyncing(true);
    const engine = getSyncEngine();
    await engine.runSync();
    await refreshData();
    await runIntegrityCheck();
    setIsSyncing(false);
  }

  const isSynchronizing = syncState.status === "synchronizing" || isSyncing;
  const conflictCount = activeConflicts.length;
  const integrityStatus = integrityResult?.status ?? "valid";

  return (
    <main className="min-h-screen bg-zinc-950 text-zinc-100">
      <div className="mx-auto max-w-6xl px-6 py-8">

        {/* Header */}
        <header className="flex flex-wrap items-center justify-between gap-4 border-b border-zinc-800 pb-6">
          <div>
            <h1 className="text-3xl font-semibold tracking-tight">SyncGuard</h1>
            <p className="mt-1 text-sm text-zinc-400">
              Real-time synchronization, optimistic conflict resolution & SHA-256 integrity verification
            </p>
          </div>
          <div className="flex items-center gap-3">
            <OnlineStatus />
            <button
              id="btn-sync-now-header"
              onClick={handleSyncNow}
              disabled={isSynchronizing || !syncState.isOnline}
              className="flex items-center gap-2 rounded-lg bg-zinc-100 px-4 py-1.5 text-xs font-semibold text-zinc-900 hover:bg-white disabled:opacity-40 transition-colors"
            >
              <span className={isSynchronizing ? "animate-spin" : ""}>🔄</span>
              {isSynchronizing ? "Syncing..." : "Sync Now"}
            </button>
          </div>
        </header>

        {/* Synchronization & Real-time Status Banner */}
        <section className="mt-8">
          <div className="rounded-2xl border border-zinc-800 bg-zinc-900 p-6 flex flex-wrap items-center justify-between gap-4">
            <div className="flex items-center gap-4">
              <span
                className={
                  "flex h-12 w-12 items-center justify-center rounded-2xl text-xl font-bold border " +
                  (integrityStatus === "invalid"
                    ? "bg-rose-500/10 text-rose-400 border-rose-800/80 animate-pulse"
                    : conflictCount > 0
                    ? "bg-red-500/10 text-red-400 border-red-800/60 animate-pulse"
                    : syncState.status === "synced"
                    ? "bg-emerald-500/10 text-emerald-400 border-emerald-800/60"
                    : syncState.status === "synchronizing"
                    ? "bg-sky-500/10 text-sky-400 border-sky-800/60 animate-pulse"
                    : syncState.status === "failed"
                    ? "bg-rose-500/10 text-rose-400 border-rose-800/60"
                    : syncState.status === "offline"
                    ? "bg-zinc-800 text-zinc-400 border-zinc-700"
                    : "bg-amber-500/10 text-amber-400 border-amber-800/60")
                }
              >
                {integrityStatus === "invalid" && "🛡️"}
                {integrityStatus === "valid" && conflictCount > 0 && "⚠️"}
                {integrityStatus === "valid" && conflictCount === 0 && syncState.status === "synced" && "✓"}
                {integrityStatus === "valid" && conflictCount === 0 && syncState.status === "synchronizing" && "⚡"}
                {integrityStatus === "valid" && conflictCount === 0 && syncState.status === "failed" && "✕"}
                {integrityStatus === "valid" && conflictCount === 0 && syncState.status === "pending" && "⏱"}
                {integrityStatus === "valid" && conflictCount === 0 && syncState.status === "offline" && "⊘"}
              </span>

              <div>
                <h2 className="text-lg font-semibold capitalize">
                  {integrityStatus === "invalid" && "Integrity Warning: Tampered Operation Detected"}
                  {integrityStatus === "valid" && conflictCount > 0 && `${conflictCount} Version Conflict(s) Require Resolution`}
                  {integrityStatus === "valid" && conflictCount === 0 && syncState.status === "synced" && "All Data Synchronized & Verified"}
                  {integrityStatus === "valid" && conflictCount === 0 && syncState.status === "synchronizing" && "Synchronizing Data..."}
                  {integrityStatus === "valid" && conflictCount === 0 && syncState.status === "failed" && "Synchronization Errors Encountered"}
                  {integrityStatus === "valid" && conflictCount === 0 && syncState.status === "pending" && "Changes Pending Synchronization"}
                  {integrityStatus === "valid" && conflictCount === 0 && syncState.status === "offline" && "Offline Mode Active"}
                </h2>
                <p className="text-sm text-zinc-400 mt-0.5">
                  {integrityStatus === "invalid"
                    ? "The operation history contains an unexpected modification. See Integrity section below."
                    : conflictCount > 0
                    ? "Concurrent offline modifications detected. Review three-way comparison to resolve."
                    : syncState.status === "synced"
                    ? "Real-time WebSocket active. Local IndexedDB and PostgreSQL server are synchronized."
                    : syncState.status === "synchronizing"
                    ? "Sending operations and pulling latest changes..."
                    : syncState.status === "pending"
                    ? `${syncState.pendingCount} local mutation(s) queued for upload.`
                    : "CRUD mutations will be stored in IndexedDB queue until reconnected."}
                </p>
              </div>
            </div>

            <div className="flex items-center gap-3">
              {conflictCount > 0 ? (
                <Link
                  href="/conflicts"
                  id="btn-goto-conflicts"
                  className="rounded-xl bg-red-500 px-5 py-2.5 text-sm font-semibold text-zinc-950 hover:bg-red-400 transition-colors shadow-sm"
                >
                  Review Conflicts ({conflictCount}) →
                </Link>
              ) : (
                <button
                  id="btn-sync-now-banner"
                  onClick={handleSyncNow}
                  disabled={isSynchronizing || !syncState.isOnline}
                  className="rounded-xl bg-zinc-100 px-5 py-2.5 text-sm font-semibold text-zinc-950 hover:bg-white disabled:opacity-40 transition-colors shadow-sm"
                >
                  {isSynchronizing ? "Synchronizing..." : "Sync Now"}
                </button>
              )}
            </div>
          </div>
        </section>

        {/* Real-time Statistics Cards (5 Core Metrics) */}
        <section className="mt-6 grid gap-4 grid-cols-2 lg:grid-cols-5">
          <Link
            href="/records"
            className="rounded-2xl border border-zinc-800 bg-zinc-900 p-5 hover:border-zinc-700 transition-colors block group"
          >
            <p className="text-xs font-medium text-zinc-500 uppercase tracking-wider group-hover:text-zinc-400">
              Pending Changes
            </p>
            <p className="mt-2 text-3xl font-semibold text-amber-400">
              {syncState.pendingCount}
            </p>
            <p className="mt-1 text-[11px] text-zinc-500">In local queue</p>
          </Link>

          <Link
            href="/conflicts"
            id="stat-conflicts-link"
            className={
              "rounded-2xl border p-5 transition-colors block group " +
              (conflictCount > 0
                ? "border-red-800/80 bg-red-950/20 hover:border-red-600"
                : "border-zinc-800 bg-zinc-900 hover:border-zinc-700")
            }
          >
            <p className="text-xs font-medium text-zinc-500 uppercase tracking-wider group-hover:text-zinc-400 flex items-center justify-between">
              <span>Conflicts</span>
              {conflictCount > 0 && <span className="h-2 w-2 rounded-full bg-red-400 animate-ping" />}
            </p>
            <p className="mt-2 text-3xl font-semibold text-red-400">
              {conflictCount}
            </p>
            <p className="mt-1 text-[11px] text-zinc-500">Click to resolve →</p>
          </Link>

          {/* Integrity Metric */}
          <div className="rounded-2xl border border-zinc-800 bg-zinc-900 p-5">
            <p className="text-xs font-medium text-zinc-500 uppercase tracking-wider">
              Data Integrity
            </p>
            <p
              className={
                "mt-2 text-3xl font-semibold " +
                (integrityStatus === "valid" ? "text-emerald-400" : "text-rose-400")
              }
            >
              {integrityStatus === "valid" ? "Verified" : "Warning"}
            </p>
            <p className="mt-1 text-[11px] text-zinc-500">
              {integrityResult ? `${integrityResult.operationsChecked} ops chained` : "SHA-256 chain"}
            </p>
          </div>

          <Link
            href="/records"
            className="rounded-2xl border border-zinc-800 bg-zinc-900 p-5 hover:border-zinc-700 transition-colors block group"
          >
            <p className="text-xs font-medium text-zinc-500 uppercase tracking-wider group-hover:text-zinc-400">
              Total Records
            </p>
            <p className="mt-2 text-3xl font-semibold text-zinc-100">
              {totalRecords}
            </p>
            <p className="mt-1 text-[11px] text-zinc-500">IndexedDB storage</p>
          </Link>

          <div className="rounded-2xl border border-zinc-800 bg-zinc-900 p-5 col-span-2 lg:col-span-1">
            <p className="text-xs font-medium text-zinc-500 uppercase tracking-wider">
              Last Sync
            </p>
            <p className="mt-2 text-xl font-semibold text-zinc-300 truncate">
              {formatTime(syncState.lastSyncTime)}
            </p>
            <p className="mt-1 text-[11px] text-zinc-500">Engine timestamp</p>
          </div>
        </section>

        {/* Navigation cards: Records, Conflict Center, Lineage & Recovery */}
        <section className="mt-6 grid gap-4 md:grid-cols-3">
          <Link
            href="/records"
            id="nav-goto-records"
            className="block rounded-2xl border border-zinc-800 bg-zinc-900 p-6 hover:border-zinc-700 transition-colors group"
          >
            <div className="flex items-center justify-between">
              <h2 className="text-base font-medium group-hover:text-white transition-colors">
                Records Management →
              </h2>
              <span className="text-zinc-600 group-hover:text-zinc-300 text-xl transition-colors">→</span>
            </div>
            <p className="mt-1 text-xs text-zinc-400">
              Offline CRUD mutations with automatic IndexedDB queueing
            </p>
          </Link>

          <Link
            href="/conflicts"
            id="nav-goto-conflicts-card"
            className="block rounded-2xl border border-zinc-800 bg-zinc-900 p-6 hover:border-zinc-700 transition-colors group"
          >
            <div className="flex items-center justify-between">
              <h2 className="text-base font-medium group-hover:text-white transition-colors">
                Conflict Resolution Center →
              </h2>
              <span className="text-zinc-600 group-hover:text-zinc-300 text-xl transition-colors">→</span>
            </div>
            <p className="mt-1 text-xs text-zinc-400">
              Three-way comparison & manual merge without data loss
            </p>
          </Link>

          <Link
            href="/history"
            id="nav-goto-history"
            className="block rounded-2xl border border-zinc-800 bg-zinc-900 p-6 hover:border-zinc-700 transition-colors group"
          >
            <div className="flex items-center justify-between">
              <h2 className="text-base font-medium group-hover:text-white transition-colors">
                Lineage & Recovery →
              </h2>
              <span className="text-zinc-600 group-hover:text-zinc-300 text-xl transition-colors">→</span>
            </div>
            <p className="mt-1 text-xs text-zinc-400">
              Inspect historical states and safely restore past versions
            </p>
          </Link>
        </section>

        {/* Phase 7: Real-Time Activity Log (In-Memory Broadcast Events) */}
        {realtimeEvents.length > 0 && (
          <section className="mt-8">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h2 className="text-xl font-medium">Real-Time WebSocket Activity</h2>
                <p className="text-xs text-zinc-400">
                  Live multi-device events broadcast across connected clients
                </p>
              </div>
              <span className="flex items-center gap-1.5 text-xs text-emerald-400">
                <span className="h-2 w-2 rounded-full bg-emerald-400 animate-ping" />
                Live Feed
              </span>
            </div>

            <div className="rounded-2xl border border-emerald-950 bg-zinc-900 p-5 divide-y divide-zinc-800/80">
              {realtimeEvents.slice(0, 6).map((ev) => (
                <div key={ev.id} className="py-2.5 flex items-start justify-between gap-4 first:pt-0 last:pb-0">
                  <div className="space-y-0.5">
                    <div className="flex items-center gap-2">
                      <span className="h-2 w-2 rounded-full bg-emerald-400" />
                      <span className="text-xs font-semibold text-emerald-300">{ev.title}</span>
                    </div>
                    <p className="text-xs text-zinc-400 pl-4">{ev.description}</p>
                  </div>
                  <time className="text-[11px] text-zinc-500 whitespace-nowrap font-mono">
                    {formatTime(ev.timestamp)}
                  </time>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* Operation Chain Integrity Verification Section */}
        <section className="mt-8">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="text-xl font-medium">Operation Chain Integrity</h2>
              <p className="text-xs text-zinc-400">
                SHA-256 cryptographic hash chain verifying tamper-evident audit history
              </p>
            </div>
            <button
              id="btn-verify-integrity"
              onClick={runIntegrityCheck}
              disabled={isVerifyingIntegrity}
              className="flex items-center gap-2 rounded-lg border border-zinc-700 bg-zinc-900 px-3.5 py-1.5 text-xs font-semibold text-zinc-200 hover:bg-zinc-800 disabled:opacity-50 transition-colors"
            >
              <span className={isVerifyingIntegrity ? "animate-spin" : ""}>🛡️</span>
              {isVerifyingIntegrity ? "Verifying..." : "Verify Integrity"}
            </button>
          </div>

          <div className="rounded-2xl border border-zinc-800 bg-zinc-900 p-6 space-y-4">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-xs">
              <div className="rounded-xl border border-zinc-800 bg-zinc-950 p-4">
                <span className="text-zinc-500 block text-[11px] uppercase font-semibold">
                  Chain Status
                </span>
                <span
                  className={
                    "text-base font-bold mt-1 block " +
                    (integrityStatus === "valid" ? "text-emerald-400" : "text-rose-400")
                  }
                >
                  {integrityStatus === "valid" ? "✓ Verified" : "⚠️ Tampered"}
                </span>
              </div>

              <div className="rounded-xl border border-zinc-800 bg-zinc-950 p-4">
                <span className="text-zinc-500 block text-[11px] uppercase font-semibold">
                  Last Verification
                </span>
                <span className="text-sm font-semibold text-zinc-200 mt-1 block truncate">
                  {formatTime(integrityResult?.verifiedAt ?? null)}
                </span>
              </div>

              <div className="rounded-xl border border-zinc-800 bg-zinc-950 p-4">
                <span className="text-zinc-500 block text-[11px] uppercase font-semibold">
                  Operations Checked
                </span>
                <span className="text-base font-semibold text-zinc-200 mt-1 block">
                  {integrityResult?.operationsChecked ?? 0}
                </span>
              </div>

              <div className="rounded-xl border border-zinc-800 bg-zinc-950 p-4">
                <span className="text-zinc-500 block text-[11px] uppercase font-semibold">
                  Integrity Errors
                </span>
                <span
                  className={
                    "text-base font-semibold mt-1 block " +
                    ((integrityResult?.errors?.length ?? 0) === 0
                      ? "text-emerald-400"
                      : "text-rose-400")
                  }
                >
                  {integrityResult?.errors?.length ?? 0}
                </span>
              </div>
            </div>

            {integrityResult?.errors && integrityResult.errors.length > 0 && (
              <div className="rounded-xl border border-rose-800/80 bg-rose-950/20 p-4 space-y-3 text-xs">
                <div className="flex items-center gap-2 text-rose-400 font-semibold text-sm">
                  <span>⚠️ Integrity Warning</span>
                </div>
                <p className="text-zinc-300">
                  The operation history contains an unexpected change. Stored data does not match the computed cryptographic hash.
                </p>
                <div className="space-y-2">
                  {integrityResult.errors.map((err, idx) => (
                    <div
                      key={idx}
                      className="rounded-lg border border-rose-900/60 bg-zinc-950 p-3 space-y-1 font-mono text-[11px]"
                    >
                      <p className="text-rose-300 font-semibold">
                        Affected Operation: {err.operationId} (Record: {err.recordId})
                      </p>
                      <p className="text-zinc-400">Reason: {err.reason}</p>
                      <p className="text-zinc-500 truncate">Expected Hash: {err.expectedHash}</p>
                      <p className="text-zinc-500 truncate">Stored Hash: {err.storedHash}</p>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </section>

        {/* Sync Activity Log */}
        <section className="mt-8">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-xl font-medium">Synchronization Activity History</h2>
            <button
              onClick={refreshData}
              className="text-xs text-zinc-400 hover:text-zinc-200 transition-colors"
            >
              Refresh Log
            </button>
          </div>

          <div className="rounded-2xl border border-zinc-800 bg-zinc-900 p-5">
            {activities.length === 0 ? (
              <p className="text-sm text-zinc-500 text-center py-6">
                No synchronization activity recorded yet. Perform a change or click &quot;Sync Now&quot;.
              </p>
            ) : (
              <div className="divide-y divide-zinc-800/80">
                {activities.map((act) => (
                  <div key={act.id} className="py-3 flex items-start justify-between gap-4 first:pt-0 last:pb-0">
                    <div className="space-y-0.5">
                      <div className="flex items-center gap-2">
                        <span
                          className={
                            "h-2 w-2 rounded-full " +
                            (act.type === "sync_success"
                              ? "bg-emerald-400"
                              : act.type === "resolved"
                              ? "bg-sky-400"
                              : act.type === "restore"
                              ? "bg-amber-400"
                              : act.type === "conflict"
                              ? "bg-red-400 animate-pulse"
                              : act.type === "failed"
                              ? "bg-rose-400"
                              : act.type === "change_queued"
                              ? "bg-amber-400"
                              : "bg-sky-400")
                          }
                        />
                        <span className="text-sm font-medium text-zinc-200">{act.title}</span>
                      </div>
                      <p className="text-xs text-zinc-400 pl-4">{act.description}</p>
                    </div>
                    <time className="text-xs text-zinc-500 whitespace-nowrap shrink-0">
                      {formatTime(act.timestamp)}
                    </time>
                  </div>
                ))}
              </div>
            )}
          </div>
        </section>

      </div>
    </main>
  );
}