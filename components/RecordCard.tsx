"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import type { SyncRecord, SyncStatus, RecordVersion, ConflictDetail } from "../lib/types";
import { fetchRecordVersions } from "../lib/api";
import { getConflictForRecord } from "../lib/db";
import ConflictResolutionModal from "./ConflictResolutionModal";

interface RecordCardProps {
  record: SyncRecord;
  onEdit: (record: SyncRecord) => void;
  onDelete: (id: string) => void;
  onSync?: () => void;
  onConflictResolved?: () => void;
}

const STATUS_CONFIG: { [K in SyncStatus]: { label: string; className: string } } = {
  synced:        { label: "Synced",        className: "bg-emerald-400/10 text-emerald-400 border-emerald-800" },
  pending:       { label: "Pending",       className: "bg-amber-400/10  text-amber-400  border-amber-800"   },
  synchronizing: { label: "Syncing...",    className: "bg-sky-400/10    text-sky-400    border-sky-800"     },
  conflict:      { label: "Conflict",      className: "bg-red-400/10    text-red-400    border-red-800"     },
  failed:        { label: "Failed",        className: "bg-rose-400/10   text-rose-400   border-rose-800"    },
};

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

export default function RecordCard({
  record,
  onEdit,
  onDelete,
  onSync,
  onConflictResolved,
}: RecordCardProps) {
  const status = STATUS_CONFIG[record.syncStatus] || STATUS_CONFIG.pending;
  const [showVersions, setShowVersions] = useState(false);
  const [showConflictInfo, setShowConflictInfo] = useState(false);
  const [showResolveModal, setShowResolveModal] = useState(false);
  const [versions, setVersions] = useState<RecordVersion[]>([]);
  const [conflictDetail, setConflictDetail] = useState<ConflictDetail | null>(null);
  const [loadingVersions, setLoadingVersions] = useState(false);
  const [versionError, setVersionError] = useState<string | null>(null);

  useEffect(() => {
    if (record.syncStatus === "conflict") {
      getConflictForRecord(record.id).then((c) => {
        if (c) setConflictDetail(c);
      });
    }
  }, [record.id, record.syncStatus]);

  async function handleToggleVersions() {
    if (showVersions) {
      setShowVersions(false);
      return;
    }

    setShowVersions(true);
    setLoadingVersions(true);
    setVersionError(null);

    const res = await fetchRecordVersions(record.id);
    if (res.error) {
      setVersionError(res.error);
    } else {
      setVersions(res.versions);
    }
    setLoadingVersions(false);
  }

  return (
    <article
      className={
        "rounded-2xl border bg-zinc-900 p-5 space-y-3 transition-colors " +
        (record.syncStatus === "conflict"
          ? "border-red-800/80 bg-red-950/10"
          : "border-zinc-800 hover:border-zinc-700")
      }
    >
      <div className="flex items-start justify-between gap-3">
        <h3 className="font-medium text-zinc-100 truncate flex-1">{record.title}</h3>
        <span
          className={
            "shrink-0 rounded-full border px-2.5 py-0.5 text-xs font-medium " +
            status.className
          }
        >
          {status.label}
        </span>
      </div>

      {record.description && (
        <p className="text-sm text-zinc-400 line-clamp-2">{record.description}</p>
      )}

      {record.value && (
        <div className="rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm font-mono text-zinc-300 break-all">
          {record.value}
        </div>
      )}

      <dl className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-zinc-500">
        <div className="flex gap-1">
          <dt>ID:</dt>
          <dd className="font-mono text-zinc-600 truncate max-w-[120px]" title={record.id}>
            {record.id.split("-")[0]}...
          </dd>
        </div>
        <div className="flex gap-1 font-semibold text-zinc-400">
          <dt>Version:</dt>
          <dd>v{record.version}</dd>
        </div>
        <div className="flex gap-1">
          <dt>Updated:</dt>
          <dd>{formatDate(record.updatedAt)}</dd>
        </div>
      </dl>

      {/* Conflict Details & Resolve CTA */}
      {record.syncStatus === "conflict" && (
        <div className="rounded-xl border border-red-800/80 bg-red-950/30 p-3 text-xs space-y-2">
          <div className="flex items-center justify-between text-red-400 font-medium">
            <span className="flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-full bg-red-400 animate-pulse" />
              Version Conflict
            </span>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setShowConflictInfo(!showConflictInfo)}
                className="text-[11px] underline text-red-300 hover:text-white"
              >
                {showConflictInfo ? "Hide" : "Compare"}
              </button>
              {conflictDetail && (
                <button
                  onClick={() => setShowResolveModal(true)}
                  className="rounded bg-red-500 hover:bg-red-400 px-2 py-0.5 text-[11px] font-semibold text-zinc-950"
                >
                  Resolve →
                </button>
              )}
            </div>
          </div>

          {showConflictInfo && conflictDetail && (
            <div className="mt-2 space-y-2 border-t border-red-900/60 pt-2 text-zinc-300">
              <p className="text-zinc-400 italic text-[11px]">{conflictDetail.reason}</p>
              <div className="grid grid-cols-2 gap-2 text-[11px]">
                <div className="rounded bg-zinc-900 p-2 border border-zinc-800">
                  <p className="font-semibold text-amber-400">Local (v{conflictDetail.local_version})</p>
                  <p className="truncate">Title: {conflictDetail.local_changes.title}</p>
                  <p className="truncate font-mono text-zinc-400">
                    Val: {conflictDetail.local_changes.value || "empty"}
                  </p>
                </div>
                <div className="rounded bg-zinc-900 p-2 border border-zinc-800">
                  <p className="font-semibold text-emerald-400">Server (v{conflictDetail.server_version})</p>
                  <p className="truncate">Title: {conflictDetail.server_changes.title}</p>
                  <p className="truncate font-mono text-zinc-400">
                    Val: {conflictDetail.server_changes.value || "empty"}
                  </p>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Action Buttons */}
      <div className="flex flex-wrap gap-2 pt-2 border-t border-zinc-800/80">
        <button
          id={"edit-record-" + record.id}
          onClick={() => onEdit(record)}
          className="flex-1 rounded-lg border border-zinc-700 px-3 py-1.5 text-xs text-zinc-300 hover:bg-zinc-800 transition-colors"
        >
          Edit
        </button>

        <button
          id={"history-record-" + record.id}
          onClick={handleToggleVersions}
          className="rounded-lg border border-zinc-700 px-3 py-1.5 text-xs text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800 transition-colors"
        >
          {showVersions ? "Hide History" : "History"}
        </button>

        <button
          id={"delete-record-" + record.id}
          onClick={() => onDelete(record.id)}
          className="rounded-lg border border-zinc-800 px-3 py-1.5 text-xs text-zinc-500 hover:border-red-800 hover:text-red-400 transition-colors"
        >
          Delete
        </button>
      </div>

      {/* Version History Accordion */}
      {showVersions && (
        <div className="mt-3 rounded-xl border border-zinc-800 bg-zinc-950 p-3 space-y-2 text-xs">
          <div className="font-medium text-zinc-300 border-b border-zinc-800 pb-1 flex justify-between">
            <span>Server Version History</span>
            {versions.length > 0 && <span>{versions.length} versions</span>}
          </div>

          {loadingVersions ? (
            <p className="text-zinc-500 py-1">Loading version history...</p>
          ) : versionError ? (
            <p className="text-zinc-500 py-1 italic">
              {versionError.includes("PostgreSQL is not configured")
                ? "PostgreSQL server not configured"
                : versionError}
            </p>
          ) : versions.length === 0 ? (
            <p className="text-zinc-500 py-1">No prior versions recorded on server yet.</p>
          ) : (
            <div className="space-y-2 max-h-48 overflow-y-auto pr-1">
              {versions.map((ver) => (
                <div
                  key={ver.id}
                  className="rounded border border-zinc-800/80 bg-zinc-900/60 p-2 space-y-1"
                >
                  <div className="flex justify-between items-center text-zinc-400">
                    <span className="font-semibold text-emerald-400">v{ver.version}</span>
                    <span className="text-[10px] text-zinc-500">
                      {formatDate(ver.created_at)}
                    </span>
                  </div>
                  <div className="font-medium text-zinc-200 truncate">{ver.title}</div>
                  {ver.value && (
                    <div className="font-mono text-[11px] text-zinc-400 truncate">
                      value: {ver.value}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Modal for resolution */}
      {showResolveModal && conflictDetail && (
        <ConflictResolutionModal
          conflict={conflictDetail}
          onClose={() => setShowResolveModal(false)}
          onResolved={() => {
            setShowResolveModal(false);
            if (onConflictResolved) onConflictResolved();
          }}
        />
      )}
    </article>
  );
}