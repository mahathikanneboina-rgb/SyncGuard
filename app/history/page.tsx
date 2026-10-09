"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { getAllRecords } from "../../lib/db";
import { fetchRecordVersions } from "../../lib/api";
import { getDeviceId } from "../../lib/device";
import { getSyncEngine } from "../../lib/syncEngine";
import type { SyncRecord, RecordVersion } from "../../lib/types";
import OnlineStatus from "../../components/OnlineStatus";

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

export default function HistoryPage() {
  const [records, setRecords] = useState<SyncRecord[]>([]);
  const [selectedRecordId, setSelectedRecordId] = useState<string>("");
  const [versions, setVersions] = useState<RecordVersion[]>([]);
  const [selectedVersion, setSelectedVersion] = useState<RecordVersion | null>(null);
  const [restoreModalVersion, setRestoreModalVersion] = useState<RecordVersion | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isRestoring, setIsRestoring] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadRecords = useCallback(async () => {
    try {
      const recs = await getAllRecords();
      setRecords(recs);
      if (recs.length > 0 && !selectedRecordId) {
        setSelectedRecordId(recs[0].id);
      }
    } catch {
      // ignore
    } finally {
      setIsLoading(false);
    }
  }, [selectedRecordId]);

  const loadVersions = useCallback(async (recordId: string) => {
    if (!recordId) return;
    setIsLoading(true);
    setError(null);
    const res = await fetchRecordVersions(recordId);
    if (res.error) {
      setError(res.error);
      setVersions([]);
    } else {
      setVersions(res.versions);
      if (res.versions.length > 0) {
        setSelectedVersion(res.versions[0]);
      }
    }
    setIsLoading(false);
  }, []);

  useEffect(() => {
    loadRecords();
  }, [loadRecords]);

  useEffect(() => {
    if (selectedRecordId) {
      loadVersions(selectedRecordId);
    }
  }, [selectedRecordId, loadVersions]);

  const currentRecord = records.find((r) => r.id === selectedRecordId);
  const currentVersionNumber = currentRecord?.version || (versions[0]?.version ?? 1);

  async function handleConfirmRestore() {
    if (!restoreModalVersion || !selectedRecordId) return;
    setIsRestoring(true);
    setError(null);
    setNotice(null);

    const deviceId = getDeviceId();

    try {
      const res = await fetch(`/api/records/${selectedRecordId}/restore`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          versionToRestore: restoreModalVersion.version,
          deviceId,
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.error || "Failed to restore version");
      } else {
        setNotice(
          `✓ Successfully restored Version ${restoreModalVersion.version} as new Version ${data.newVersion}. Previous versions preserved.`
        );
        setRestoreModalVersion(null);
        await loadVersions(selectedRecordId);
        getSyncEngine().runSync();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error during restore");
    } finally {
      setIsRestoring(false);
    }
  }

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
              <span className="text-zinc-300">Version History & Recovery</span>
            </div>
            <h1 className="text-3xl font-semibold tracking-tight">Record Lineage & Recovery</h1>
            <p className="mt-1 text-sm text-zinc-400">
              Inspect historical states and safely restore any prior version without deleting history
            </p>
          </div>

          <div className="flex items-center gap-3">
            <Link
              href="/records"
              className="rounded-lg border border-zinc-700 px-3.5 py-1.5 text-xs text-zinc-300 hover:bg-zinc-800 transition-colors"
            >
              ← Records
            </Link>
            <OnlineStatus />
          </div>
        </header>

        {/* Alerts */}
        {error && (
          <div className="mt-6 rounded-xl border border-red-800 bg-red-950/30 p-4 text-sm text-red-400 flex items-center justify-between">
            <span>{error}</span>
            <button onClick={() => setError(null)} className="text-xs hover:text-white">✕</button>
          </div>
        )}

        {notice && (
          <div className="mt-6 rounded-xl border border-emerald-800 bg-emerald-950/30 p-4 text-sm text-emerald-400 flex items-center justify-between">
            <span>{notice}</span>
            <button onClick={() => setNotice(null)} className="text-xs hover:text-white">✕</button>
          </div>
        )}

        {/* Record Selection Dropdown / Pills */}
        <section className="mt-8">
          <div className="flex flex-wrap items-center justify-between gap-4 mb-4">
            <label htmlFor="select-record" className="text-xs uppercase font-semibold text-zinc-400 tracking-wider">
              Select Record to Inspect:
            </label>
            {records.length > 0 && (
              <select
                id="select-record"
                value={selectedRecordId}
                onChange={(e) => setSelectedRecordId(e.target.value)}
                className="rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-1.5 text-xs text-zinc-100 focus:outline-none focus:border-zinc-500"
              >
                {records.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.title} (Current: v{r.version})
                  </option>
                ))}
              </select>
            )}
          </div>

          {records.length === 0 ? (
            <div className="rounded-2xl border border-zinc-800 bg-zinc-900 p-12 text-center space-y-3">
              <p className="text-zinc-400 font-medium">No Records Found</p>
              <p className="text-xs text-zinc-600">
                Create a record and synchronize it to view historical version lineage.
              </p>
              <Link
                href="/records"
                className="inline-block rounded-lg bg-zinc-100 px-4 py-2 text-xs font-semibold text-zinc-900 hover:bg-white transition-colors"
              >
                Go to Records
              </Link>
            </div>
          ) : (
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">

              {/* Version List Sidebar */}
              <div className="rounded-2xl border border-zinc-800 bg-zinc-900 p-5 space-y-3">
                <div className="flex items-center justify-between border-b border-zinc-800 pb-3">
                  <h3 className="text-sm font-semibold text-zinc-200">Version History</h3>
                  <span className="text-xs text-zinc-500">{versions.length} versions</span>
                </div>

                {isLoading ? (
                  <p className="text-xs text-zinc-500 py-4 text-center">Loading versions...</p>
                ) : versions.length === 0 ? (
                  <p className="text-xs text-zinc-500 py-4 text-center">
                    No server version snapshots recorded yet.
                  </p>
                ) : (
                  <div className="space-y-2 max-h-[500px] overflow-y-auto pr-1">
                    {versions.map((ver, idx) => {
                      const isLatest = idx === 0;
                      const isSelected = selectedVersion?.version === ver.version;

                      return (
                        <div
                          key={ver.id}
                          onClick={() => setSelectedVersion(ver)}
                          className={
                            "rounded-xl border p-3 cursor-pointer transition-all " +
                            (isSelected
                              ? "border-sky-500 bg-sky-950/20 text-sky-100 ring-1 ring-sky-500"
                              : "border-zinc-800 bg-zinc-950/60 text-zinc-400 hover:border-zinc-700")
                          }
                        >
                          <div className="flex items-center justify-between">
                            <span className="font-semibold text-xs text-emerald-400">
                              Version {ver.version}
                            </span>
                            {isLatest && (
                              <span className="rounded bg-emerald-950 text-emerald-300 border border-emerald-800 px-1.5 py-0.5 text-[10px] font-medium">
                                Current
                              </span>
                            )}
                          </div>
                          <p className="text-xs font-medium text-zinc-200 truncate mt-1">
                            {ver.title}
                          </p>
                          <p className="text-[11px] text-zinc-500 mt-0.5">
                            {formatDate(ver.created_at)}
                          </p>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* Version State Details & Recovery Inspector */}
              <div className="lg:col-span-2 rounded-2xl border border-zinc-800 bg-zinc-900 p-6 space-y-6">
                {selectedVersion ? (
                  <>
                    <div className="flex flex-wrap items-start justify-between gap-4 border-b border-zinc-800 pb-4">
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="rounded bg-emerald-950 text-emerald-300 border border-emerald-800 px-2 py-0.5 text-xs font-mono font-semibold">
                            Snapshot: Version {selectedVersion.version}
                          </span>
                          <span className="text-xs text-zinc-500 font-mono">
                            ID: {selectedVersion.id.slice(0, 8)}...
                          </span>
                        </div>
                        <h2 className="text-xl font-bold text-zinc-100 mt-2">
                          {selectedVersion.title}
                        </h2>
                        <p className="text-xs text-zinc-400 mt-0.5">
                          Created at: {formatDate(selectedVersion.created_at)}
                        </p>
                      </div>

                      {/* Restore Button (disabled if already current version) */}
                      {selectedVersion.version !== currentVersionNumber && (
                        <button
                          onClick={() => setRestoreModalVersion(selectedVersion)}
                          className="rounded-xl bg-amber-400 hover:bg-amber-300 px-4 py-2 text-xs font-semibold text-zinc-950 transition-colors shadow-md"
                        >
                          Restore this Version →
                        </button>
                      )}
                    </div>

                    {/* Field Snapshot View */}
                    <div className="space-y-4 text-xs">
                      <div>
                        <span className="text-zinc-500 block uppercase tracking-wider font-semibold text-[11px]">
                          Title
                        </span>
                        <div className="mt-1 rounded-lg border border-zinc-800 bg-zinc-950 p-3 text-zinc-200 font-medium">
                          {selectedVersion.title}
                        </div>
                      </div>

                      <div>
                        <span className="text-zinc-500 block uppercase tracking-wider font-semibold text-[11px]">
                          Value / Stock Content
                        </span>
                        <div className="mt-1 rounded-lg border border-zinc-800 bg-zinc-950 p-3 font-mono text-emerald-400 text-sm">
                          {selectedVersion.value || "(empty)"}
                        </div>
                      </div>

                      <div>
                        <span className="text-zinc-500 block uppercase tracking-wider font-semibold text-[11px]">
                          Description
                        </span>
                        <div className="mt-1 rounded-lg border border-zinc-800 bg-zinc-950 p-3 text-zinc-300">
                          {selectedVersion.description || "(empty)"}
                        </div>
                      </div>
                    </div>

                    {/* Lineage explanation note */}
                    <div className="rounded-xl border border-zinc-800 bg-zinc-950 p-4 text-xs text-zinc-400 space-y-1">
                      <p className="font-semibold text-zinc-300">Non-Destructive Recovery Guarantee</p>
                      <p>
                        Restoring historical version v{selectedVersion.version} will copy its exact state and create a new version (v{currentVersionNumber + 1}). All intermediate versions remain intact and verifiable.
                      </p>
                    </div>
                  </>
                ) : (
                  <p className="text-sm text-zinc-500 text-center py-12">
                    Select a version snapshot on the left to inspect its state.
                  </p>
                )}
              </div>

            </div>
          )}
        </section>

        {/* Confirmation Modal for Version Recovery */}
        {restoreModalVersion && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
            <div className="w-full max-w-md rounded-2xl border border-zinc-800 bg-zinc-900 p-6 space-y-5 shadow-2xl text-zinc-100">
              <div className="flex items-center gap-3">
                <span className="flex h-10 w-10 items-center justify-center rounded-full bg-amber-400/10 text-amber-400 text-lg">
                  ↺
                </span>
                <div>
                  <h3 className="font-semibold text-base">Restore Version {restoreModalVersion.version}?</h3>
                  <p className="text-xs text-zinc-400">Current version is v{currentVersionNumber}</p>
                </div>
              </div>

              <div className="rounded-xl border border-zinc-800 bg-zinc-950 p-3.5 text-xs text-zinc-300 space-y-1.5">
                <p>
                  Restoring this version will create <strong>Version {currentVersionNumber + 1}</strong> with the content:
                </p>
                <div className="font-mono text-zinc-400 bg-zinc-900 p-2 rounded">
                  Title: {restoreModalVersion.title}<br />
                  Value: {restoreModalVersion.value || "(empty)"}
                </div>
                <p className="text-emerald-400 text-[11px] pt-1">
                  ✓ Previous versions (1 to {currentVersionNumber}) will not be deleted or modified.
                </p>
              </div>

              <div className="flex justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setRestoreModalVersion(null)}
                  disabled={isRestoring}
                  className="rounded-xl border border-zinc-700 px-4 py-2 text-xs text-zinc-300 hover:bg-zinc-800 transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleConfirmRestore}
                  disabled={isRestoring}
                  className="rounded-xl bg-amber-400 hover:bg-amber-300 px-5 py-2 text-xs font-semibold text-zinc-950 disabled:opacity-50 transition-colors shadow-md"
                >
                  {isRestoring ? "Restoring..." : `Restore as Version ${currentVersionNumber + 1}`}
                </button>
              </div>
            </div>
          </div>
        )}

      </div>
    </main>
  );
}
