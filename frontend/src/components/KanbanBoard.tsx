"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  closestCorners,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { sortableKeyboardCoordinates } from "@dnd-kit/sortable";
import { KanbanColumn } from "@/components/KanbanColumn";
import { KanbanCardPreview } from "@/components/KanbanCardPreview";
import { AIChatSidebar } from "@/components/AIChatSidebar";
import { BoardToolbar } from "@/components/BoardToolbar";
import { MembersPanel } from "@/components/MembersPanel";
import { ActivityPanel } from "@/components/ActivityPanel";
import { ArchivePanel } from "@/components/ArchivePanel";
import { CardDetail } from "@/components/CardDetail";
import { sendChat, type ChatMessage } from "@/lib/ai-api";
import { isExpired, messageOf } from "@/lib/api";
import {
  addCard,
  addColumn,
  archiveCard,
  deleteColumn,
  editCard,
  getBoard,
  leaveBoard,
  moveCardOnServer,
  moveColumn,
  renameBoard,
  removeMember,
  renameColumn,
  shareBoard,
} from "@/lib/board-api";
import {
  TITLE_MAX_LENGTH,
  canEdit,
  emptyFilter,
  memberName,
  matchesFilter,
  moveCard,
  type BoardData,
  type BoardSummary,
} from "@/lib/kanban";

type KanbanBoardProps = {
  boardId: string;
  /** Card whose detail dialog opens once the board loads (from My work). */
  initialCardId?: string;
  currentUserId: string;
  onSessionExpired: () => void;
  onBoardChanged: (board: BoardData) => void;
  onLeft: (boards: BoardSummary[]) => void;
};

export const KanbanBoard = ({ boardId, initialCardId, currentUserId, onSessionExpired, onBoardChanged, onLeft }: KanbanBoardProps) => {
  const [board, setBoard] = useState<BoardData | null>(null);
  const [activeCardId, setActiveCardId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [chatBusy, setChatBusy] = useState(false);
  const [error, setError] = useState("");
  const [filter, setFilter] = useState(emptyFilter);
  const [newColumn, setNewColumn] = useState("");
  const [membersOpen, setMembersOpen] = useState(false);
  const [activityOpen, setActivityOpen] = useState(false);
  const [archiveOpen, setArchiveOpen] = useState(false);
  const [chatOpen, setChatOpen] = useState(false);
  const [openCardId, setOpenCardId] = useState<string | null>(initialCardId ?? null);
  const savingRef = useRef(false);
  const chatBusyRef = useRef(false);

  const refreshBoard = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      setBoard(await getBoard(boardId));
    } catch (cause) {
      if (isExpired(cause)) return onSessionExpired();
      setError(messageOf(cause, "Unable to load board."));
    } finally {
      setLoading(false);
    }
  }, [boardId, onSessionExpired]);

  useEffect(() => {
    void refreshBoard();
  }, [refreshBoard]);

  const apply = (next: BoardData) => {
    setBoard(next);
    onBoardChanged(next);
  };

  const save = async (change: () => Promise<BoardData>): Promise<boolean> => {
    if (savingRef.current || chatBusyRef.current) return false;
    savingRef.current = true;
    setSaving(true);
    setError("");
    try {
      apply(await change());
      return true;
    } catch (cause) {
      if (isExpired(cause)) onSessionExpired();
      setError(messageOf(cause, "Unable to save board."));
      return false;
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  };

  const chat = async (message: string, history: ChatMessage[]): Promise<string> => {
    if (savingRef.current || chatBusyRef.current) throw new Error("Wait for the current change to finish.");
    chatBusyRef.current = true;
    setChatBusy(true);
    try {
      const reply = await sendChat(boardId, message, history);
      apply(reply.board);
      return reply.text;
    } catch (cause) {
      if (isExpired(cause)) onSessionExpired();
      throw cause;
    } finally {
      chatBusyRef.current = false;
      setChatBusy(false);
    }
  };

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  const handleDragStart = (event: DragStartEvent) => {
    if (!savingRef.current && !chatBusyRef.current) setActiveCardId(String(event.active.id));
  };

  const handleDragEnd = ({ active, over }: DragEndEvent) => {
    setActiveCardId(null);
    if (!board || savingRef.current || chatBusyRef.current || !over || active.id === over.id) return;
    const cardId = String(active.id);
    const nextColumns = moveCard(board.columns, cardId, String(over.id));
    if (JSON.stringify(nextColumns) === JSON.stringify(board.columns)) return;
    const target = nextColumns.find((column) => column.cardIds.includes(cardId));
    if (target) {
      void save(() => moveCardOnServer(boardId, cardId, target.id, target.cardIds.indexOf(cardId)));
    }
  };

  const setCommentCount = (cardId: string, count: number) =>
    setBoard((current) =>
      current && { ...current, cards: { ...current.cards, [cardId]: { ...current.cards[cardId], commentCount: count } } }
    );

  const leave = async () => {
    if (!window.confirm("Leave this board? You will lose access until the owner shares it again.")) return;
    setError("");
    try {
      onLeft(await leaveBoard(boardId));
    } catch (cause) {
      if (isExpired(cause)) return onSessionExpired();
      setError(messageOf(cause, "Unable to leave board."));
    }
  };

  const submitColumn = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (newColumn.trim() && (await save(() => addColumn(boardId, newColumn.trim())))) setNewColumn("");
  };

  if (loading) {
    return <main className="mx-auto max-w-[1500px] px-6 py-12">Loading board...</main>;
  }
  if (!board) {
    return (
      <main className="mx-auto max-w-[1500px] px-6 py-12">
        <p role="alert">{error}</p>
        <button type="button" onClick={() => void refreshBoard()}>Retry</button>
      </main>
    );
  }

  const busy = saving || chatBusy;
  const readOnly = !canEdit(board.role);
  const activeCard = activeCardId ? board.cards[activeCardId] : null;

  return (
    <>
      <main className="flex min-w-0 flex-col gap-5">
        <div aria-live="polite" className="min-h-5 text-sm text-[var(--gray-text)]">
          {saving ? "Saving..." : error ? <span role="alert" className="text-red-700">{error}</span> : null}
        </div>
        <BoardToolbar
          key={`${board.id}:${board.name}`}
          board={board}
          filter={filter}
          disabled={busy}
          membersOpen={membersOpen}
          activityOpen={activityOpen}
          archiveOpen={archiveOpen}
          chatOpen={chatOpen}
          onFilterChange={setFilter}
          onRename={(name) => save(() => renameBoard(boardId, name))}
          onToggleMembers={() => setMembersOpen((open) => !open)}
          onToggleActivity={() => setActivityOpen((open) => !open)}
          onToggleArchive={() => setArchiveOpen((open) => !open)}
          onToggleChat={() => setChatOpen((open) => !open)}
        />
        {activityOpen && <ActivityPanel boardId={boardId} version={board} onSessionExpired={onSessionExpired} />}
        {archiveOpen && (
          <ArchivePanel boardId={boardId} version={board} readOnly={readOnly} disabled={busy}
            onSave={save} onSessionExpired={onSessionExpired} />
        )}
        {membersOpen && (
          <MembersPanel
            board={board}
            disabled={busy}
            onShare={(username, role) => save(() => shareBoard(boardId, username, role))}
            onRemove={(memberId) => save(() => removeMember(boardId, memberId))}
            onLeave={() => void leave()}
          />
        )}

        <DndContext
          sensors={sensors}
          collisionDetection={closestCorners}
          onDragStart={handleDragStart}
          onDragEnd={handleDragEnd}
          onDragCancel={() => setActiveCardId(null)}
        >
          <section className="flex gap-3 overflow-x-auto pb-4" aria-label="Board columns">
            {board.columns.map((column, index) => (
              <KanbanColumn
                key={`${column.id}:${column.title}`}
                column={column}
                cards={column.cardIds.map((id) => board.cards[id]).filter((card) => matchesFilter(card, filter))}
                members={board.members}
                totalCards={column.cardIds.length}
                index={index}
                columnCount={board.columns.length}
                disabled={busy}
                readOnly={readOnly}
                onRename={(columnId, title) => save(() => renameColumn(boardId, columnId, title))}
                onMove={(columnId, toIndex) => save(() => moveColumn(boardId, columnId, toIndex))}
                onDelete={(columnId) => save(() => deleteColumn(boardId, columnId))}
                onAddCard={(columnId, fields) => save(() => addCard(boardId, columnId, fields))}
                onEditCard={(cardId, fields) => save(() => editCard(boardId, cardId, fields))}
                onArchiveCard={(cardId) => save(() => archiveCard(boardId, cardId))}
                onOpenCard={setOpenCardId}
              />
            ))}
            {!readOnly && <form
              onSubmit={submitColumn}
              className="flex h-fit w-[160px] shrink-0 flex-col gap-2 rounded-3xl border border-dashed border-[var(--stroke)] p-4"
            >
              <input
                aria-label="New column title"
                placeholder="New column"
                value={newColumn}
                onChange={(event) => setNewColumn(event.target.value)}
                maxLength={TITLE_MAX_LENGTH}
                disabled={busy}
                className="w-full rounded-xl border border-[var(--stroke)] bg-white px-3 py-2 text-sm outline-none focus:border-[var(--primary-blue)]"
              />
              <button
                type="submit"
                disabled={busy || !newColumn.trim()}
                className="rounded-full border border-[var(--primary-blue)] px-3 py-2 text-xs font-semibold uppercase tracking-wide text-[var(--primary-blue)] disabled:opacity-50"
              >
                Add column
              </button>
            </form>}
          </section>
          <DragOverlay>
            {activeCard ? (
              <div className="w-[260px]">
                <KanbanCardPreview card={activeCard} assignee={memberName(board.members, activeCard.assigneeId)} />
              </div>
            ) : null}
          </DragOverlay>
        </DndContext>
      </main>
      {openCardId && board.cards[openCardId] && (
        <CardDetail
          board={board}
          cardId={openCardId}
          currentUserId={currentUserId}
          saveError={error}
          onClose={() => setOpenCardId(null)}
          onCommentCount={setCommentCount}
          onSave={save}
          onSessionExpired={onSessionExpired}
        />
      )}
      <AIChatSidebar key={boardId} boardId={boardId} disabled={saving} open={chatOpen}
        onClose={() => setChatOpen(false)} onSend={chat} />
    </>
  );
};
