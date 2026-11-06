"use client";

import { useState, type FormEvent } from "react";
import { addChecklistItem, deleteChecklistItem, editChecklistItem } from "@/lib/board-api";
import {
  CHECKLIST_MAX_ITEMS,
  TITLE_MAX_LENGTH,
  checklistProgress,
  type BoardData,
  type Card,
} from "@/lib/kanban";

type ChecklistProps = {
  boardId: string;
  card: Card;
  readOnly: boolean;
  onSave: (change: () => Promise<BoardData>) => Promise<boolean>;
};

export const Checklist = ({ boardId, card, readOnly, onSave }: ChecklistProps) => {
  const [draft, setDraft] = useState("");
  const { done, total } = checklistProgress(card);
  const full = total >= CHECKLIST_MAX_ITEMS;

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const text = draft.trim();
    if (text && (await onSave(() => addChecklistItem(boardId, card.id, text)))) setDraft("");
  };

  return (
    <section aria-label="Checklist" className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <h3 className="text-xs font-semibold uppercase tracking-[0.2em] text-[var(--gray-text)]">Checklist</h3>
        {total > 0 && <span className="text-xs font-semibold text-[var(--gray-text)]">{done}/{total} done</span>}
      </div>
      {total > 0 && (
        <div
          role="progressbar"
          aria-label="Checklist progress"
          aria-valuemin={0}
          aria-valuemax={total}
          aria-valuenow={done}
          className="h-1.5 overflow-hidden rounded-full bg-[var(--surface)]"
        >
          <div className="h-full bg-[var(--primary-blue)]" style={{ width: `${(done / total) * 100}%` }} />
        </div>
      )}
      {total === 0 && <p className="text-sm text-[var(--gray-text)]">No checklist items.</p>}
      <ul className="flex flex-col gap-1">
        {card.checklist.map((item) => (
          <li key={item.id} className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              aria-label={item.text}
              checked={item.done}
              disabled={readOnly}
              onChange={() => void onSave(() => editChecklistItem(boardId, card.id, item.id, { done: !item.done }))}
              className="h-4 w-4 accent-[var(--primary-blue)]"
            />
            <span className={item.done ? "flex-1 text-[var(--gray-text)] line-through" : "flex-1 text-[var(--navy-dark)]"}>
              {item.text}
            </span>
            {!readOnly && (
              <button
                type="button"
                aria-label={`Remove ${item.text}`}
                onClick={() => void onSave(() => deleteChecklistItem(boardId, card.id, item.id))}
                className="text-xs font-semibold text-[var(--gray-text)] hover:text-red-700"
              >
                Remove
              </button>
            )}
          </li>
        ))}
      </ul>
      {!readOnly && !full && (
        <form onSubmit={submit} className="flex gap-2">
          <input
            aria-label="New checklist item"
            placeholder="Add an item"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            maxLength={TITLE_MAX_LENGTH}
            className="min-w-0 flex-1 rounded-xl border border-[var(--stroke)] px-3 py-2 text-sm outline-none focus:border-[var(--primary-blue)]"
          />
          <button
            type="submit"
            disabled={!draft.trim()}
            className="rounded-full border border-[var(--primary-blue)] px-3 py-2 text-xs font-semibold uppercase tracking-wide text-[var(--primary-blue)] disabled:opacity-50"
          >
            Add item
          </button>
        </form>
      )}
    </section>
  );
};
