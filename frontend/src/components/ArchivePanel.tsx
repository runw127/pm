"use client";

import { useEffect, useState } from "react";
import { isExpired, messageOf } from "@/lib/api";
import { formatTime } from "@/lib/activity-api";
import { deleteCard, listArchived, restoreCard, type ArchivedCard } from "@/lib/board-api";
import type { BoardData } from "@/lib/kanban";

type ArchivePanelProps = {
  boardId: string;
  /** Changes whenever the board changes, so the list refreshes. */
  version: unknown;
  readOnly: boolean;
  disabled: boolean;
  onSave: (change: () => Promise<BoardData>) => Promise<boolean>;
  onSessionExpired: () => void;
};

const buttonClass =
  "rounded-full border border-[var(--stroke)] px-3 py-1 text-xs font-semibold text-[var(--navy-dark)] disabled:opacity-50";

export const ArchivePanel = ({ boardId, version, readOnly, disabled, onSave, onSessionExpired }: ArchivePanelProps) => {
  const [cards, setCards] = useState<ArchivedCard[] | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    listArchived(boardId)
      .then((list) => {
        if (!active) return;
        setCards(list);
        setError("");
      })
      .catch((cause) => {
        if (!active) return;
        if (isExpired(cause)) return onSessionExpired();
        setError(messageOf(cause, "Unable to load archived cards."));
      });
    return () => {
      active = false;
    };
  }, [boardId, version, onSessionExpired]);

  const remove = (card: ArchivedCard) => {
    if (window.confirm(`Delete "${card.title}" permanently? This cannot be undone.`)) {
      void onSave(() => deleteCard(boardId, card.id));
    }
  };

  return (
    <section aria-label="Archived cards" className="rounded-2xl border border-[var(--stroke)] bg-[var(--surface)] p-4">
      <h3 className="text-xs font-semibold uppercase tracking-[0.2em] text-[var(--gray-text)]">Archived cards</h3>
      {error && <p role="alert" className="mt-2 text-sm text-red-700">{error}</p>}
      {!cards && !error && <p className="mt-2 text-sm text-[var(--gray-text)]">Loading archived cards...</p>}
      {cards?.length === 0 && <p className="mt-2 text-sm text-[var(--gray-text)]">No archived cards.</p>}
      <ul className="mt-3 flex max-h-64 flex-col gap-2 overflow-y-auto text-sm">
        {cards?.map((card) => (
          <li key={card.id} className="flex flex-wrap items-center justify-between gap-2">
            <span>
              <span className="font-semibold text-[var(--navy-dark)]">{card.title}</span>
              <span className="text-xs text-[var(--gray-text)]"> &middot; {card.column} &middot; archived {formatTime(card.archivedAt)}</span>
            </span>
            {!readOnly && (
              <span className="flex gap-2">
                <button type="button" disabled={disabled} aria-label={`Restore ${card.title}`} className={buttonClass}
                  onClick={() => void onSave(() => restoreCard(boardId, card.id))}>
                  Restore
                </button>
                <button type="button" disabled={disabled} aria-label={`Delete ${card.title} permanently`}
                  className={`${buttonClass} hover:text-red-700`} onClick={() => remove(card)}>
                  Delete
                </button>
              </span>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
};
