"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  getAllRecords,
  createRecord,
  updateRecord,
  deleteRecord,
  getUnresolvedConflicts,
} from "../../lib/db";
import { getSyncEngine } from "../../lib/syncEngine";
import { checkServerHealth } from "../../lib/api";
import { getDeviceId } from "../../lib/device";
import type { SyncRecord, SyncEngineStatus, ConflictDetail } from "../../lib/types";
import OnlineStatus from "../../components/OnlineStatus";
import RecordCard from "../../components/RecordCard";
import RecordForm from "../../components/RecordForm";

type View = "list" | "create" | "edit";

export default function RecordsPage() {
  const [records, setRecords] = useState<SyncRecord[]>([]);
  const [conflicts, setConflicts] = useState<ConflictDetail[]>([]);
  const [view, setView] = useState<View>("list");
  const [editingRecord, setEditingRecord] = useState<SyncRecord | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [globalError, setGlobalError] = useState<string | null>(null);
  const [syncNotice, setSyncNotice] = useState<string | null>(null);
  const [isSyncing, setIsSyncing] = useState(false);
  const [deviceId, setDeviceIdState] = useState<string>("");

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

  const [serverStatus, setServerStatus] = useState<{
    connected: boolean;
    isConfigured: boolean;
    message?: string;
  }>({ connected: false, isConfigured: false });

  const loadData = useCallback(async () => {
    try {
      setGlobalError(null);
      const [recs, confs, health] = await Promise.all([
        getAllRecords(),
        getUnresolvedConflicts(),
        checkServerHealth(),
      ]);
      recs.sort(
        (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
      );
      setRecords(recs);
      setConflicts(confs);
      setServerStatus(health);
    } catch (err) {
      setGlobalError(err instanceof Error ? err.message : "Failed to load records.");
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    setDeviceIdState(getDeviceId());
    loadData();

    const engine = getSyncEngine();
    const unsubscribe = engine.subscribe((state) => {
      setSyncState({
        status: state.status,
        isOnline: state.isOnline,
        pendingCount: state.pendingCount,
        conflictCount: state.conflictCount,
        failedCount: state.failedCount,
      });
      loadData();
    });

    return () => unsubscribe();
  }, [loadData]);

  async function handleCreate(data: { title: string; description: string; value: string }) {
    await createRecord(data);
    await loadData();
    setView("list");

    if (navigator.onLine) {
      getSyncEngine().runSync();
    }
  }

  async function handleUpdate(data: { title: string; description: string; value: string }) {
    if (!editingRecord) return;
    await updateRecord(editingRecord.id, data);
    await loadData();
    setView("list");
    setEditingRecord(null);

    if (navigator.onLine) {
      getSyncEngine().runSync();
    }
  }

  async function handleDelete(id: string) {
    if (!window.confirm("Delete this record? This change will be queued and synced.")) return;
    try {
      setGlobalError(null);
      await deleteRecord(id);
      await loadData();

      if (navigator.onLine) {
        getSyncEngine().runSync();
      }
    } catch (err) {
      setGlobalError(err instanceof Error ? err.message : "Failed to delete record.");
    }
  }

  async function handleSyncNow() {
    setIsSyncing(true);
    setSyncNotice(null);
    setGlobalError(null);

    const engine = getSyncEngine();
    const res = await engine.runSync();

    if (res.conflictCount > 0) {
      setGlobalError(
        `⚠️ Version Conflict: ${res.conflictCount} record(s) encountered conflict. Visit Conflicts Center to resolve.`
      );
    } else if (res.failedCount > 0) {
      setGlobalError(`Sync completed with ${res.failedCount} failed operation(s).`);
    } else if (res.appliedCount > 0 || res.pulledCount > 0) {
      setSyncNotice(`✓ Synchronized successfully: ${res.appliedCount} uploaded, ${res.pulledCount} downloaded.`);
    } else {
      setSyncNotice("✓ All records are synchronized with the server.");
    }

    await loadData();
    setIsSyncing(false);
  }

  function startEdit(record: SyncRecord) {
    setEditingRecord(record);
    setView("edit");
  }

  function cancelForm() {
    setView("list");
    setEditingRecord(null);
  }

  return (
    <main className="min-h-screen bg-zinc-950 text-zinc-100">
      <div className="mx-auto max-w-6xl px-6 py-8">
        <header className="flex flex-wrap items-center justify-between gap-4 border-b border-zinc-800 pb-6">
          <div>
            <div className="flex items-center gap-2 text-sm text-zinc-500 mb-1">
              <Link href="/" id="nav-back-dashboard" className="hover:text-zinc-300 transition-colors">
                SyncGuard
              </Link>
              <span>/</span>
              <span className="text-zinc-300">Records</span>
            </div>
            <h1 className="text-3xl font-semibold tracking-tight">Records</h1>
            <p className="mt-1 text-sm text-zinc-400">
              Offline-first data layer with automatic sync & conflict detection
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            {conflicts.length > 0 && (
              <Link
                href="/conflicts"
                className="rounded-lg bg-red-950 border border-red-800 text-red-300 px-3.5 py-1.5 text-xs font-medium hover:bg-red-900 transition-colors"
              >
                Resolve Conflicts ({conflicts.length}) →
              </Link>
            )}

            {deviceId && (
              <span className="rounded-full border border-zinc-800 bg-zinc-900 px-3 py-1 text-xs font-mono text-zinc-400">
                ID: {deviceId}
              </span>
            )}

            <OnlineStatus />

            <button
              id="btn-records-sync-now"
              onClick={handleSyncNow}
              disabled={isSyncing || !syncState.isOnline}
              className="flex items-center gap-2 rounded-lg bg-zinc-100 px-4 py-1.5 text-xs font-semibold text-zinc-900 hover:bg-white disabled:opacity-40 transition-colors"
            >
              <span className={isSyncing || syncState.status === "synchronizing" ? "animate-spin" : ""}>
                🔄
              </span>
              {isSyncing || syncState.status === "synchronizing" ? "Syncing..." : "Sync Now"}
            </button>
          </div>
        </header>

        {/* Global Errors or Conflict Alerts */}
        {globalError && (
          <div
            role="alert"
            className="mt-6 rounded-xl border border-red-800 bg-red-950/30 px-5 py-3 text-sm text-red-400 flex items-center justify-between"
          >
            <span>{globalError}</span>
            <button
              onClick={() => setGlobalError(null)}
              className="text-xs text-red-300 hover:text-white"
            >
              ✕
            </button>
          </div>
        )}

        {/* Sync Success Notification */}
        {syncNotice && (
          <div
            role="status"
            className="mt-6 rounded-xl border border-emerald-800 bg-emerald-950/30 px-5 py-3 text-sm text-emerald-400 flex items-center justify-between"
          >
            <span>{syncNotice}</span>
            <button
              onClick={() => setSyncNotice(null)}
              className="text-xs text-emerald-300 hover:text-white"
            >
              ✕
            </button>
          </div>
        )}

        {/* Active Conflicts Banner with link to /conflicts */}
        {conflicts.length > 0 && (
          <div className="mt-6 rounded-2xl border border-red-800 bg-red-950/20 p-5 space-y-3 flex flex-wrap items-center justify-between gap-4">
            <div>
              <div className="flex items-center gap-2 text-red-400 font-semibold">
                <span className="h-2.5 w-2.5 rounded-full bg-red-400 animate-pulse" />
                <span>{conflicts.length} Version Conflict(s) Preserved</span>
              </div>
              <p className="text-xs text-zinc-300 mt-1">
                The central server contains newer changes that conflict with local base versions.
              </p>
            </div>
            <Link
              href="/conflicts"
              className="rounded-xl bg-red-500 hover:bg-red-400 px-4 py-2 text-xs font-semibold text-zinc-950 transition-colors"
            >
              Open Conflicts Center →
            </Link>
          </div>
        )}

        {/* Pending Operations Queue Banner */}
        {syncState.pendingCount > 0 && (
          <div className="mt-4 rounded-xl border border-amber-800 bg-amber-950/20 px-5 py-3 text-sm text-amber-300 flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <span className="h-2 w-2 rounded-full bg-amber-400 animate-pulse" />
              <span>
                {syncState.pendingCount} mutation(s) waiting in local IndexedDB queue
              </span>
            </div>
            {syncState.isOnline && (
              <button
                id="btn-sync-pending"
                onClick={handleSyncNow}
                disabled={isSyncing}
                className="rounded-lg bg-amber-400 px-3.5 py-1 text-xs font-semibold text-zinc-950 hover:bg-amber-300 disabled:opacity-50 transition-colors"
              >
                {isSyncing ? "Pushing..." : "Sync Changes"}
              </button>
            )}
          </div>
        )}

        {view === "list" ? (
          <section className="mt-8">
            <div className="flex flex-wrap items-center justify-between gap-4 mb-6">
              <h2 className="text-xl font-medium">
                All Records
                {!isLoading && (
                  <span className="ml-2 text-sm font-normal text-zinc-500">({records.length})</span>
                )}
              </h2>
              <div className="flex items-center gap-3">
                <button
                  id="btn-create-record"
                  onClick={() => setView("create")}
                  className="rounded-lg bg-zinc-100 px-4 py-2 text-sm font-medium text-zinc-900 hover:bg-white transition-colors"
                >
                  + New Record
                </button>
              </div>
            </div>

            {isLoading ? (
              <div className="rounded-2xl border border-zinc-800 bg-zinc-900 p-12 text-center text-zinc-500 text-sm">
                Loading records from IndexedDB...
              </div>
            ) : records.length === 0 ? (
              <div className="rounded-2xl border border-zinc-800 bg-zinc-900 p-12 text-center">
                <p className="text-zinc-400 font-medium">No records yet</p>
                <p className="mt-1 text-sm text-zinc-600">
                  Click &quot;+ New Record&quot; to create your first offline-first record.
                </p>
              </div>
            ) : (
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {records.map((record) => (
                  <RecordCard
                    key={record.id}
                    record={record}
                    onEdit={startEdit}
                    onDelete={handleDelete}
                    onSync={handleSyncNow}
                    onConflictResolved={loadData}
                  />
                ))}
              </div>
            )}
          </section>
        ) : (
          <section className="mt-8">
            <div className="mx-auto max-w-lg rounded-2xl border border-zinc-800 bg-zinc-900 p-8">
              <h2 className="text-xl font-medium mb-6">
                {view === "create" ? "New Record" : "Edit Record"}
              </h2>
              <RecordForm
                initialData={view === "edit" ? editingRecord ?? undefined : undefined}
                onSubmit={view === "create" ? handleCreate : handleUpdate}
                onCancel={cancelForm}
              />
            </div>
          </section>
        )}
      </div>
    </main>
  );
}