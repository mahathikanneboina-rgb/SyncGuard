"use client";

import { useState } from "react";
import type { ConflictDetail, ConflictResolutionType } from "../lib/types";
import {
  computeFieldComparisons,
  generateConflictExplanation,
  executeConflictResolution,
} from "../lib/conflicts";

interface ConflictResolutionModalProps {
  conflict: ConflictDetail;
  onClose: () => void;
  onResolved: () => void;
}

export default function ConflictResolutionModal({
  conflict,
  onClose,
  onResolved,
}: ConflictResolutionModalProps) {
  const diffs = computeFieldComparisons(conflict);
  const explanation = generateConflictExplanation(conflict);

  const [resolutionMode, setResolutionMode] = useState<ConflictResolutionType>("keep_local");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Field-level manual merge choices ('original' | 'local' | 'server' | 'custom')
  const [selectedFields, setSelectedFields] = useState<{
    title: "original" | "local" | "server";
    description: "original" | "local" | "server";
    value: "original" | "local" | "server";
  }>({
    title: "local",
    description: "local",
    value: "local",
  });

  const [customOverrides, setCustomOverrides] = useState<{
    title: string;
    description: string;
    value: string;
  }>({
    title: conflict.local_changes.title || "",
    description: conflict.local_changes.description || "",
    value: conflict.local_changes.value || "",
  });

  // Calculate preview final values based on current mode
  function getFinalPreview() {
    if (resolutionMode === "keep_local") {
      return {
        title: conflict.local_changes.title || "",
        description: conflict.local_changes.description || "",
        value: conflict.local_changes.value || "",
      };
    }
    if (resolutionMode === "keep_server") {
      return {
        title: conflict.server_changes.title || "",
        description: conflict.server_changes.description || "",
        value: conflict.server_changes.value || "",
      };
    }

    // Manual merge
    const getVal = (key: "title" | "description" | "value") => {
      const choice = selectedFields[key];
      if (choice === "original") return conflict.original_record?.[key] ?? "";
      if (choice === "server") return conflict.server_changes?.[key] ?? "";
      return conflict.local_changes?.[key] ?? "";
    };

    return {
      title: customOverrides.title || getVal("title"),
      description: customOverrides.description || getVal("description"),
      value: customOverrides.value || getVal("value"),
    };
  }

  const finalPreview = getFinalPreview();

  async function handleApply() {
    setIsSubmitting(true);
    setError(null);

    const res = await executeConflictResolution({
      conflictId: conflict.id,
      recordId: conflict.record_id,
      resolutionType: resolutionMode,
      resolvedValue: finalPreview,
      originalVersion: conflict.original_version,
      localVersion: conflict.local_version,
      serverVersion: conflict.server_version,
    });

    if (res.success) {
      onResolved();
      onClose();
    } else {
      setError(res.error || "Failed to resolve conflict");
    }
    setIsSubmitting(false);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 overflow-y-auto">
      <div className="relative w-full max-w-4xl rounded-2xl border border-zinc-800 bg-zinc-900 p-6 md:p-8 space-y-6 shadow-2xl max-h-[90vh] overflow-y-auto text-zinc-100">
        
        {/* Header */}
        <div className="flex items-start justify-between border-b border-zinc-800 pb-4">
          <div>
            <div className="flex items-center gap-2 text-xs font-mono text-zinc-400">
              <span className="rounded bg-red-950/60 text-red-400 border border-red-800/80 px-2 py-0.5 font-sans font-semibold">
                Conflict ID: {conflict.id.slice(0, 8)}
              </span>
              <span>•</span>
              <span>Record ID: {conflict.record_id.slice(0, 8)}...</span>
            </div>
            <h2 className="text-2xl font-bold tracking-tight mt-1">
              Conflict Explanation & Resolution
            </h2>
          </div>
          <button
            onClick={onClose}
            className="rounded-lg p-2 text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800 transition-colors"
          >
            ✕
          </button>
        </div>

        {error && (
          <div className="rounded-xl border border-red-800 bg-red-950/30 p-4 text-sm text-red-400">
            {error}
          </div>
        )}

        {/* 1. Three-Way Comparison Cards */}
        <div>
          <h3 className="text-xs uppercase font-semibold text-zinc-400 tracking-wider mb-3">
            Three-Way Version Comparison
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-xs">
            {/* Original Card */}
            <div className="rounded-xl border border-zinc-800 bg-zinc-950 p-4 space-y-2">
              <div className="flex items-center justify-between border-b border-zinc-800 pb-2">
                <span className="font-semibold text-zinc-300">ORIGINAL</span>
                <span className="font-mono text-zinc-500">v{conflict.original_version}</span>
              </div>
              <p className="text-zinc-500 text-[11px]">Base before either device changed it</p>
              <div className="space-y-1.5 pt-1 text-zinc-300">
                <p><span className="text-zinc-500">Title:</span> {conflict.original_record?.title || "(empty)"}</p>
                <p><span className="text-zinc-500">Value:</span> {conflict.original_record?.value || "(empty)"}</p>
                <p><span className="text-zinc-500">Desc:</span> {conflict.original_record?.description || "(empty)"}</p>
              </div>
            </div>

            {/* Local Version Card */}
            <div className="rounded-xl border border-amber-800/60 bg-amber-950/10 p-4 space-y-2">
              <div className="flex items-center justify-between border-b border-amber-800/40 pb-2">
                <span className="font-semibold text-amber-400">LOCAL (Device A)</span>
                <span className="font-mono text-amber-300">v{conflict.local_version}</span>
              </div>
              <p className="text-amber-500/80 text-[11px]">Changes made by this device</p>
              <div className="space-y-1.5 pt-1 text-zinc-200">
                <p><span className="text-zinc-400">Title:</span> {conflict.local_changes.title || "(empty)"}</p>
                <p><span className="text-zinc-400">Value:</span> <strong className="text-amber-300">{conflict.local_changes.value || "(empty)"}</strong></p>
                <p><span className="text-zinc-400">Desc:</span> {conflict.local_changes.description || "(empty)"}</p>
              </div>
            </div>

            {/* Server Version Card */}
            <div className="rounded-xl border border-emerald-800/60 bg-emerald-950/10 p-4 space-y-2">
              <div className="flex items-center justify-between border-b border-emerald-800/40 pb-2">
                <span className="font-semibold text-emerald-400">SERVER (Device B)</span>
                <span className="font-mono text-emerald-300">v{conflict.server_version}</span>
              </div>
              <p className="text-emerald-500/80 text-[11px]">Changes already accepted by server</p>
              <div className="space-y-1.5 pt-1 text-zinc-200">
                <p><span className="text-zinc-400">Title:</span> {conflict.server_changes.title || "(empty)"}</p>
                <p><span className="text-zinc-400">Value:</span> <strong className="text-emerald-300">{conflict.server_changes.value || "(empty)"}</strong></p>
                <p><span className="text-zinc-400">Desc:</span> {conflict.server_changes.description || "(empty)"}</p>
              </div>
            </div>
          </div>
        </div>

        {/* 2. Human-Readable Dynamic Explanation */}
        <div className="rounded-xl border border-zinc-800 bg-zinc-950 p-4 space-y-2">
          <h3 className="text-xs uppercase font-semibold text-zinc-400 tracking-wider">
            Conflict Explanation
          </h3>
          <p className="text-xs text-zinc-300 whitespace-pre-line leading-relaxed font-mono bg-zinc-900/60 p-3 rounded-lg border border-zinc-800/80">
            {explanation}
          </p>
        </div>

        {/* 3. Field-Level Comparison Table */}
        <div>
          <h3 className="text-xs uppercase font-semibold text-zinc-400 tracking-wider mb-2">
            Field-Level Comparison
          </h3>
          <div className="overflow-x-auto rounded-xl border border-zinc-800">
            <table className="w-full text-left text-xs">
              <thead className="bg-zinc-950 text-zinc-400 border-b border-zinc-800">
                <tr>
                  <th className="p-3">Field</th>
                  <th className="p-3">Original (v{conflict.original_version})</th>
                  <th className="p-3">Local (v{conflict.local_version})</th>
                  <th className="p-3">Server (v{conflict.server_version})</th>
                  <th className="p-3">Difference Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-800/80 bg-zinc-900/40">
                {diffs.map((diff) => (
                  <tr key={diff.key} className={diff.status === "conflict" ? "bg-red-950/20" : ""}>
                    <td className="p-3 font-medium text-zinc-200">{diff.name}</td>
                    <td className="p-3 text-zinc-400">{diff.original}</td>
                    <td className="p-3 text-amber-300">{diff.local}</td>
                    <td className="p-3 text-emerald-300">{diff.server}</td>
                    <td className="p-3">
                      <span
                        className={
                          "inline-block px-2 py-0.5 rounded-full text-[10px] font-medium " +
                          (diff.status === "conflict"
                            ? "bg-red-950 text-red-300 border border-red-800"
                            : diff.status === "changed_locally"
                            ? "bg-amber-950 text-amber-300 border border-amber-800"
                            : diff.status === "changed_on_server"
                            ? "bg-emerald-950 text-emerald-300 border border-emerald-800"
                            : "bg-zinc-800 text-zinc-400")
                        }
                      >
                        {diff.status === "conflict" && "Changed on Both Sides"}
                        {diff.status === "changed_locally" && "Changed Locally"}
                        {diff.status === "changed_on_server" && "Changed on Server"}
                        {diff.status === "unchanged" && "Unchanged"}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* 4. Resolution Options */}
        <div className="space-y-4">
          <h3 className="text-xs uppercase font-semibold text-zinc-400 tracking-wider">
            Choose Resolution Strategy
          </h3>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <button
              type="button"
              onClick={() => setResolutionMode("keep_local")}
              className={
                "p-4 rounded-xl border text-left transition-all " +
                (resolutionMode === "keep_local"
                  ? "border-amber-500 bg-amber-950/30 text-amber-200 ring-1 ring-amber-500"
                  : "border-zinc-800 bg-zinc-950/60 text-zinc-400 hover:border-zinc-700")
              }
            >
              <div className="font-semibold text-sm">Keep Local</div>
              <p className="text-xs mt-1 opacity-80">
                Overwrites server with this device&apos;s changes as the next version.
              </p>
            </button>

            <button
              type="button"
              onClick={() => setResolutionMode("keep_server")}
              className={
                "p-4 rounded-xl border text-left transition-all " +
                (resolutionMode === "keep_server"
                  ? "border-emerald-500 bg-emerald-950/30 text-emerald-200 ring-1 ring-emerald-500"
                  : "border-zinc-800 bg-zinc-950/60 text-zinc-400 hover:border-zinc-700")
              }
            >
              <div className="font-semibold text-sm">Keep Server</div>
              <p className="text-xs mt-1 opacity-80">
                Accepts server version and archives local conflicting version.
              </p>
            </button>

            <button
              type="button"
              onClick={() => setResolutionMode("manual_merge")}
              className={
                "p-4 rounded-xl border text-left transition-all " +
                (resolutionMode === "manual_merge"
                  ? "border-sky-500 bg-sky-950/30 text-sky-200 ring-1 ring-sky-500"
                  : "border-zinc-800 bg-zinc-950/60 text-zinc-400 hover:border-zinc-700")
              }
            >
              <div className="font-semibold text-sm">Manual Merge</div>
              <p className="text-xs mt-1 opacity-80">
                Pick field values individually from Original, Local, or Server.
              </p>
            </button>
          </div>

          {/* Field-by-field Selector when Manual Merge is chosen */}
          {resolutionMode === "manual_merge" && (
            <div className="rounded-xl border border-sky-900/60 bg-sky-950/10 p-4 space-y-4 text-xs">
              <h4 className="font-semibold text-sky-300">Select Field Values</h4>

              {(["title", "description", "value"] as const).map((key) => (
                <div key={key} className="space-y-1.5 border-b border-zinc-800/80 pb-3 last:border-b-0">
                  <span className="font-medium text-zinc-300 uppercase text-[11px]">
                    {key === "value" ? "Value / Stock" : key}
                  </span>
                  <div className="grid grid-cols-3 gap-2">
                    <label className="flex items-center gap-2 p-2 rounded bg-zinc-900 border border-zinc-800 cursor-pointer">
                      <input
                        type="radio"
                        name={`merge-${key}`}
                        checked={selectedFields[key] === "original"}
                        onChange={() => {
                          setSelectedFields((prev) => ({ ...prev, [key]: "original" }));
                          setCustomOverrides((prev) => ({
                            ...prev,
                            [key]: conflict.original_record?.[key] ?? "",
                          }));
                        }}
                      />
                      <span className="truncate">Original: {conflict.original_record?.[key] || "(empty)"}</span>
                    </label>

                    <label className="flex items-center gap-2 p-2 rounded bg-zinc-900 border border-zinc-800 cursor-pointer">
                      <input
                        type="radio"
                        name={`merge-${key}`}
                        checked={selectedFields[key] === "local"}
                        onChange={() => {
                          setSelectedFields((prev) => ({ ...prev, [key]: "local" }));
                          setCustomOverrides((prev) => ({
                            ...prev,
                            [key]: conflict.local_changes[key] ?? "",
                          }));
                        }}
                      />
                      <span className="truncate text-amber-300">Local: {conflict.local_changes[key] || "(empty)"}</span>
                    </label>

                    <label className="flex items-center gap-2 p-2 rounded bg-zinc-900 border border-zinc-800 cursor-pointer">
                      <input
                        type="radio"
                        name={`merge-${key}`}
                        checked={selectedFields[key] === "server"}
                        onChange={() => {
                          setSelectedFields((prev) => ({ ...prev, [key]: "server" }));
                          setCustomOverrides((prev) => ({
                            ...prev,
                            [key]: conflict.server_changes[key] ?? "",
                          }));
                        }}
                      />
                      <span className="truncate text-emerald-300">Server: {conflict.server_changes[key] || "(empty)"}</span>
                    </label>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* 5. Preview Final Record Box */}
          <div className="rounded-xl border border-zinc-800 bg-zinc-950 p-4 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs uppercase font-semibold text-zinc-400 tracking-wider">
                Preview Final Record (New Version {Math.max(conflict.local_version, conflict.server_version) + 1})
              </span>
              <span className="text-[11px] text-zinc-500">No versions will be deleted</span>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-xs bg-zinc-900/60 p-3 rounded-lg border border-zinc-800">
              <div>
                <span className="text-zinc-500 block text-[11px]">Final Title</span>
                <span className="font-semibold text-zinc-100">{finalPreview.title || "(empty)"}</span>
              </div>
              <div>
                <span className="text-zinc-500 block text-[11px]">Final Value / Stock</span>
                <span className="font-mono font-semibold text-emerald-400">{finalPreview.value || "(empty)"}</span>
              </div>
              <div>
                <span className="text-zinc-500 block text-[11px]">Final Description</span>
                <span className="text-zinc-300">{finalPreview.description || "(empty)"}</span>
              </div>
            </div>
          </div>
        </div>

        {/* Footer Actions */}
        <div className="flex items-center justify-end gap-3 border-t border-zinc-800 pt-4">
          <button
            type="button"
            onClick={onClose}
            disabled={isSubmitting}
            className="rounded-xl border border-zinc-700 px-4 py-2.5 text-xs text-zinc-300 hover:bg-zinc-800 transition-colors"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleApply}
            disabled={isSubmitting}
            className="rounded-xl bg-zinc-100 px-5 py-2.5 text-xs font-semibold text-zinc-950 hover:bg-white disabled:opacity-50 transition-colors"
          >
            {isSubmitting ? "Applying Resolution..." : "Apply Resolution"}
          </button>
        </div>

      </div>
    </div>
  );
}
