"use client";

import { useState } from "react";
import type { SyncRecord } from "../lib/types";

interface RecordFormProps {
  initialData?: SyncRecord;
  onSubmit: (data: { title: string; description: string; value: string }) => Promise<void>;
  onCancel: () => void;
}

export default function RecordForm({ initialData, onSubmit, onCancel }: RecordFormProps) {
  const [title, setTitle] = useState(initialData?.title ?? "");
  const [description, setDescription] = useState(initialData?.description ?? "");
  const [value, setValue] = useState(initialData?.value ?? "");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isEditing = Boolean(initialData);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (!title.trim()) {
      setError("Title is required.");
      return;
    }

    setIsSubmitting(true);
    try {
      await onSubmit({
        title: title.trim(),
        description: description.trim(),
        value: value.trim(),
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setIsSubmitting(false);
    }
  }

  const inputClass =
    "w-full rounded-lg border border-zinc-700 bg-zinc-800 px-4 py-2.5 text-sm text-zinc-100 " +
    "placeholder-zinc-500 focus:border-zinc-500 focus:outline-none focus:ring-1 focus:ring-zinc-500 transition-colors";

  return (
    <form onSubmit={handleSubmit} className="space-y-4" noValidate>
      <div>
        <label htmlFor="record-title" className="mb-1.5 block text-sm font-medium text-zinc-300">
          Title <span className="text-red-400">*</span>
        </label>
        <input
          id="record-title"
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Enter a title..."
          className={inputClass}
          maxLength={200}
          required
          aria-required="true"
        />
      </div>

      <div>
        <label htmlFor="record-description" className="mb-1.5 block text-sm font-medium text-zinc-300">
          Description
        </label>
        <textarea
          id="record-description"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Optional description..."
          rows={3}
          className={inputClass + " resize-none"}
          maxLength={1000}
        />
      </div>

      <div>
        <label htmlFor="record-value" className="mb-1.5 block text-sm font-medium text-zinc-300">
          Value
        </label>
        <input
          id="record-value"
          type="text"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="Any text value..."
          className={inputClass}
          maxLength={500}
        />
      </div>

      {error && (
        <p role="alert" className="rounded-lg border border-red-800 bg-red-950/30 px-4 py-2.5 text-sm text-red-400">
          {error}
        </p>
      )}

      <div className="flex gap-3 pt-1">
        <button
          type="submit"
          id="record-form-submit"
          disabled={isSubmitting}
          className="flex-1 rounded-lg bg-zinc-100 px-4 py-2.5 text-sm font-medium text-zinc-900 hover:bg-white disabled:opacity-50 transition-colors"
        >
          {isSubmitting ? "Saving..." : isEditing ? "Save Changes" : "Create Record"}
        </button>
        <button
          type="button"
          id="record-form-cancel"
          onClick={onCancel}
          disabled={isSubmitting}
          className="rounded-lg border border-zinc-700 px-4 py-2.5 text-sm text-zinc-300 hover:bg-zinc-800 disabled:opacity-50 transition-colors"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}