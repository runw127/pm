"use client";

import { useEffect, useState } from "react";
import clsx from "clsx";
import { isExpired, messageOf } from "@/lib/api";
import { groupWork, listMyWork, type WorkItem } from "@/lib/work-api";

type MyWorkProps = {
  onOpen: (boardId: string, cardId: string) => void;
  onSessionExpired: () => void;
};

const priorityClass = {
  high: "bg-[var(--secondary-purple)] text-white",
  medium: "bg-[var(--primary-blue)]/15 text-[var(--navy-dark)]",
  low: "bg-[var(--surface)] text-[var(--gray-text)]",
};

export const MyWork = ({ onOpen, onSessionExpired }: MyWorkProps) => {
  const [items, setItems] = useState<WorkItem[] | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    listMyWork()
      .then((work) => active && setItems(work))
      .catch((cause) => {
        if (!active) return;
        if (isExpired(cause)) return onSessionExpired();
        setError(messageOf(cause, "Unable to load your work."));
      });
    return () => {
      active = false;
    };
  }, [onSessionExpired]);

  return (
    <section aria-label="My work" className="mx-auto flex w-full max-w-3xl flex-col gap-5 rounded-[32px] border border-[var(--stroke)] bg-white/90 p-6 shadow-[var(--shadow)]">
      <div>
        <h2 className="font-display text-2xl font-semibold text-[var(--navy-dark)]">My work</h2>
        <p className="mt-1 text-sm text-[var(--gray-text)]">
          Open cards assigned to you on every board, soonest due first. Cards in a board&apos;s last column count as done.
        </p>
      </div>
      {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
      {!items && !error && <p className="text-sm text-[var(--gray-text)]">Loading your work...</p>}
      {items?.length === 0 && <p className="text-sm text-[var(--gray-text)]">Nothing is assigned to you right now.</p>}
      {items && groupWork(items).map((group) => (
        <section key={group.label} aria-label={group.label} className="flex flex-col gap-2">
          <h3 className={clsx(
            "text-xs font-semibold uppercase tracking-[0.2em]",
            group.label === "Overdue" ? "text-red-700" : "text-[var(--gray-text)]"
          )}>
            {group.label} ({group.items.length})
          </h3>
          <ul className="flex flex-col gap-2">
            {group.items.map((item) => (
              <li key={item.cardId}>
                <button
                  type="button"
                  onClick={() => onOpen(item.boardId, item.cardId)}
                  className="flex w-full flex-wrap items-center justify-between gap-3 rounded-2xl border border-[var(--stroke)] px-4 py-3 text-left hover:border-[var(--primary-blue)]"
                >
                  <span className="min-w-0">
                    <span className="block font-semibold text-[var(--navy-dark)]">{item.title}</span>
                    <span className="block text-xs text-[var(--gray-text)]">{item.boardName} &middot; {item.column}</span>
                  </span>
                  <span className="flex flex-wrap items-center gap-1.5 text-[11px] font-semibold">
                    <span className={clsx("rounded-full px-2 py-0.5 capitalize", priorityClass[item.priority])}>{item.priority}</span>
                    {item.dueDate && <span className="rounded-full bg-[var(--surface)] px-2 py-0.5 text-[var(--navy-dark)]">{item.dueDate}</span>}
                    {item.checklistTotal > 0 && (
                      <span className="text-[var(--gray-text)]">{item.checklistDone}/{item.checklistTotal}</span>
                    )}
                    {item.labels.map((label) => (
                      <span key={label} className="rounded-full border border-[var(--stroke)] px-2 py-0.5 text-[var(--gray-text)]">#{label}</span>
                    ))}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </section>
  );
};
