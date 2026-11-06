"use client";

import { useEffect, useState } from "react";
import { isExpired, messageOf } from "@/lib/api";
import { describe, formatTime, listActivity, type ActivityEntry } from "@/lib/activity-api";

type ActivityPanelProps = {
  boardId: string;
  /** Changes whenever the board changes, so the feed refreshes. */
  version: unknown;
  onSessionExpired: () => void;
};

export const ActivityPanel = ({ boardId, version, onSessionExpired }: ActivityPanelProps) => {
  const [entries, setEntries] = useState<ActivityEntry[] | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    listActivity(boardId)
      .then((list) => {
        if (!active) return;
        setEntries(list);
        setError("");
      })
      .catch((cause) => {
        if (!active) return;
        if (isExpired(cause)) return onSessionExpired();
        setError(messageOf(cause, "Unable to load activity."));
      });
    return () => {
      active = false;
    };
  }, [boardId, version, onSessionExpired]);

  return (
    <section aria-label="Board activity" className="rounded-2xl border border-[var(--stroke)] bg-[var(--surface)] p-4">
      <h3 className="text-xs font-semibold uppercase tracking-[0.2em] text-[var(--gray-text)]">Recent activity</h3>
      {error && <p role="alert" className="mt-2 text-sm text-red-700">{error}</p>}
      {!entries && !error && <p className="mt-2 text-sm text-[var(--gray-text)]">Loading activity...</p>}
      {entries?.length === 0 && <p className="mt-2 text-sm text-[var(--gray-text)]">No activity yet.</p>}
      <ul className="mt-3 flex max-h-64 flex-col gap-2 overflow-y-auto text-sm">
        {entries?.map((entry) => (
          <li key={entry.id} className="flex flex-wrap justify-between gap-2">
            <span className="text-[var(--navy-dark)]">{describe(entry)}</span>
            <span className="text-xs text-[var(--gray-text)]">{formatTime(entry.createdAt)}</span>
          </li>
        ))}
      </ul>
    </section>
  );
};
