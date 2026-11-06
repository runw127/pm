"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { CardMeta } from "@/components/CardMeta";
import { Checklist } from "@/components/Checklist";
import { isExpired, messageOf } from "@/lib/api";
import {
  addComment,
  deleteComment,
  describe,
  formatTime,
  listActivity,
  listComments,
  type ActivityEntry,
  type Comment,
} from "@/lib/activity-api";
import { canEdit, memberName, type BoardData } from "@/lib/kanban";

type CardDetailProps = {
  board: BoardData;
  cardId: string;
  currentUserId: string;
  /** Error from the last board save, shown here because the dialog covers the board. */
  saveError?: string;
  onClose: () => void;
  onCommentCount: (cardId: string, count: number) => void;
  onSave: (change: () => Promise<BoardData>) => Promise<boolean>;
  onSessionExpired: () => void;
};

export const COMMENT_MAX_LENGTH = 2000;

export const CardDetail = ({
  board,
  cardId,
  currentUserId,
  saveError = "",
  onClose,
  onCommentCount,
  onSave,
  onSessionExpired,
}: CardDetailProps) => {
  const card = board.cards[cardId];
  const column = board.columns.find((item) => item.cardIds.includes(cardId));
  const [comments, setComments] = useState<Comment[] | null>(null);
  const [history, setHistory] = useState<ActivityEntry[]>([]);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const fail = (cause: unknown, fallback: string) => {
    if (isExpired(cause)) return onSessionExpired();
    setError(messageOf(cause, fallback));
  };

  const load = useCallback(
    <T,>(fetch: () => Promise<T>, apply: (value: T) => void) => {
      let active = true;
      fetch()
        .then((value) => active && apply(value))
        .catch((cause) => {
          if (!active) return;
          if (isExpired(cause)) return onSessionExpired();
          setError(messageOf(cause, "Unable to load card details."));
        });
      return () => {
        active = false;
      };
    },
    [onSessionExpired]
  );

  useEffect(() => load(() => listComments(board.id, cardId), setComments), [load, board.id, cardId]);
  // History reloads whenever the card's snapshot changes (edits, checklist, comment count).
  useEffect(() => load(() => listActivity(board.id, cardId), setHistory), [load, board.id, cardId, card]);

  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => event.key === "Escape" && onClose();
    document.addEventListener("keydown", closeOnEscape);
    return () => document.removeEventListener("keydown", closeOnEscape);
  }, [onClose]);

  const update = async (change: () => Promise<Comment[]>, fallback: string) => {
    setBusy(true);
    setError("");
    try {
      const thread = await change();
      setComments(thread);
      onCommentCount(cardId, thread.length);
      return true;
    } catch (cause) {
      fail(cause, fallback);
      return false;
    } finally {
      setBusy(false);
    }
  };

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const body = draft.trim();
    if (body && (await update(() => addComment(board.id, cardId, body), "Unable to add comment."))) {
      setDraft("");
    }
  };

  if (!card) return null;

  return (
    <div className="fixed inset-0 z-40 flex justify-end bg-[var(--navy-dark)]/30" onClick={onClose}>
      <aside
        role="dialog"
        aria-modal="true"
        aria-label={`Card ${card.title}`}
        onClick={(event) => event.stopPropagation()}
        className="flex h-full w-full max-w-lg flex-col gap-5 overflow-y-auto bg-white p-6 shadow-[var(--shadow)]"
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.25em] text-[var(--gray-text)]">{column?.title}</p>
            <h2 className="mt-2 font-display text-2xl font-semibold text-[var(--navy-dark)]">{card.title}</h2>
          </div>
          <button type="button" onClick={onClose} autoFocus
            className="rounded-full border border-[var(--stroke)] px-3 py-1 text-sm font-semibold text-[var(--navy-dark)]">
            Close
          </button>
        </div>
        {card.details && <p className="whitespace-pre-wrap text-sm leading-6 text-[var(--gray-text)]">{card.details}</p>}
        <CardMeta card={card} assignee={memberName(board.members, card.assigneeId)} />
        {(error || saveError) && <p role="alert" className="text-sm text-red-700">{error || saveError}</p>}

        <Checklist boardId={board.id} card={card} readOnly={!canEdit(board.role)} onSave={onSave} />

        <section aria-label="Comments" className="flex flex-col gap-3">
          <h3 className="text-xs font-semibold uppercase tracking-[0.2em] text-[var(--gray-text)]">Comments</h3>
          {!comments && <p className="text-sm text-[var(--gray-text)]">Loading comments...</p>}
          {comments?.length === 0 && <p className="text-sm text-[var(--gray-text)]">No comments yet.</p>}
          {comments?.map((comment) => (
            <article key={comment.id} className="rounded-2xl bg-[var(--surface)] p-3 text-sm">
              <div className="flex items-center justify-between gap-2 text-xs text-[var(--gray-text)]">
                <span>
                  <span className="font-semibold text-[var(--navy-dark)]">{comment.username ?? "Deleted user"}</span>
                  {" "}&middot; {formatTime(comment.createdAt)}
                </span>
                {(comment.userId === currentUserId || board.role === "owner") && (
                  <button type="button" disabled={busy} className="font-semibold hover:text-red-700"
                    aria-label={`Delete comment ${comment.body.slice(0, 30)}`}
                    onClick={() => void update(() => deleteComment(board.id, cardId, comment.id), "Unable to delete comment.")}>
                    Delete
                  </button>
                )}
              </div>
              <p className="mt-1 whitespace-pre-wrap break-words text-[var(--navy-dark)]">{comment.body}</p>
            </article>
          ))}
          <form onSubmit={submit} className="flex flex-col gap-2">
            <textarea
              aria-label="New comment"
              placeholder="Write a comment"
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              maxLength={COMMENT_MAX_LENGTH}
              rows={3}
              className="w-full rounded-xl border border-[var(--stroke)] p-3 text-sm outline-none focus:border-[var(--primary-blue)]"
            />
            <button type="submit" disabled={busy || !draft.trim()}
              className="self-start rounded-full bg-[var(--secondary-purple)] px-4 py-2 text-xs font-semibold uppercase tracking-wide text-white disabled:opacity-50">
              Add comment
            </button>
          </form>
        </section>

        <section aria-label="Card history" className="flex flex-col gap-2">
          <h3 className="text-xs font-semibold uppercase tracking-[0.2em] text-[var(--gray-text)]">History</h3>
          <ul className="flex flex-col gap-1 text-xs text-[var(--gray-text)]">
            {history.map((entry) => (
              <li key={entry.id}>{describe(entry)} &middot; {formatTime(entry.createdAt)}</li>
            ))}
          </ul>
        </section>
      </aside>
    </div>
  );
};
