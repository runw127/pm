"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useSensor,
  useSensors,
  closestCorners,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { KanbanColumn } from "@/components/KanbanColumn";
import { KanbanCardPreview } from "@/components/KanbanCardPreview";
import { AIChatSidebar } from "@/components/AIChatSidebar";
import { sendChat } from "@/lib/ai-api";
import {
  addCard,
  deleteCard,
  editCard,
  getBoard,
  moveCardOnServer,
  renameColumn,
} from "@/lib/board-api";
import { moveCard, type BoardData } from "@/lib/kanban";

export const KanbanBoard = () => {
  const [board, setBoard] = useState<BoardData | null>(null);
  const [activeCardId, setActiveCardId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [chatBusy, setChatBusy] = useState(false);
  const [error, setError] = useState("");
  const savingRef = useRef(false);
  const chatBusyRef = useRef(false);

  const refreshBoard = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      setBoard(await getBoard());
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to load board.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refreshBoard();
  }, [refreshBoard]);

  const save = async (change: () => Promise<BoardData>): Promise<boolean> => {
    if (savingRef.current || chatBusyRef.current) return false;
    savingRef.current = true;
    setSaving(true);
    setError("");
    try {
      setBoard(await change());
      return true;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to save board.");
      return false;
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  };

  const chat = async (message: string, history: Parameters<typeof sendChat>[1]): Promise<string> => {
    if (savingRef.current || chatBusyRef.current) throw new Error("Wait for the current change to finish.");
    chatBusyRef.current = true;
    setChatBusy(true);
    try {
      const reply = await sendChat(message, history);
      setBoard(reply.board);
      return reply.text;
    } finally {
      chatBusyRef.current = false;
      setChatBusy(false);
    }
  };

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 6 },
    })
  );

  const handleDragStart = (event: DragStartEvent) => {
    if (!savingRef.current && !chatBusyRef.current) setActiveCardId(event.active.id as string);
  };

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    setActiveCardId(null);

    if (!board || savingRef.current || chatBusyRef.current || !over || active.id === over.id) {
      return;
    }
    const nextColumns = moveCard(board.columns, String(active.id), String(over.id));
    if (JSON.stringify(nextColumns) === JSON.stringify(board.columns)) return;
    const target = nextColumns.find((column) => column.cardIds.includes(String(active.id)));
    if (target) {
      void save(() =>
        moveCardOnServer(String(active.id), target.id, target.cardIds.indexOf(String(active.id)))
      );
    }
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

  const activeCard = activeCardId ? board.cards[activeCardId] : null;

  return (
    <div className="relative overflow-hidden">
      <div className="pointer-events-none absolute left-0 top-0 h-[420px] w-[420px] -translate-x-1/3 -translate-y-1/3 rounded-full bg-[radial-gradient(circle,_rgba(32,157,215,0.25)_0%,_rgba(32,157,215,0.05)_55%,_transparent_70%)]" />
      <div className="pointer-events-none absolute bottom-0 right-0 h-[520px] w-[520px] translate-x-1/4 translate-y-1/4 rounded-full bg-[radial-gradient(circle,_rgba(117,57,145,0.18)_0%,_rgba(117,57,145,0.05)_55%,_transparent_75%)]" />

      <div className="relative mx-auto flex max-w-[1800px] flex-col gap-6 px-6 pb-16 pt-8 2xl:flex-row 2xl:items-start">
      <main className="flex min-w-0 flex-1 flex-col gap-10">
        <div aria-live="polite" className="text-sm text-[var(--gray-text)]">
          {saving ? "Saving..." : error ? <span role="alert" className="text-red-700">{error}</span> : null}
        </div>
        <header className="flex flex-col gap-6 rounded-[32px] border border-[var(--stroke)] bg-white/80 p-8 shadow-[var(--shadow)] backdrop-blur">
          <div className="flex flex-wrap items-start justify-between gap-6">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.35em] text-[var(--gray-text)]">
                Single Board Kanban
              </p>
              <h1 className="mt-3 font-display text-4xl font-semibold text-[var(--navy-dark)]">
                Kanban Studio
              </h1>
              <p className="mt-3 max-w-xl text-sm leading-6 text-[var(--gray-text)]">
                Keep momentum visible. Rename columns, drag cards between stages,
                and capture quick notes without getting buried in settings.
              </p>
            </div>
            <div className="rounded-2xl border border-[var(--stroke)] bg-[var(--surface)] px-5 py-4">
              <p className="text-xs font-semibold uppercase tracking-[0.25em] text-[var(--gray-text)]">
                Focus
              </p>
              <p className="mt-2 text-lg font-semibold text-[var(--primary-blue)]">
                One board. Five columns. Zero clutter.
              </p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-4">
            {board.columns.map((column) => (
              <div
                key={column.id}
                className="flex items-center gap-2 rounded-full border border-[var(--stroke)] px-4 py-2 text-xs font-semibold uppercase tracking-[0.2em] text-[var(--navy-dark)]"
              >
                <span className="h-2 w-2 rounded-full bg-[var(--accent-yellow)]" />
                {column.title}
              </div>
            ))}
          </div>
        </header>

        <DndContext
          sensors={sensors}
          collisionDetection={closestCorners}
          onDragStart={handleDragStart}
          onDragEnd={handleDragEnd}
        >
          <section className="grid gap-6 sm:grid-cols-2 lg:grid-cols-5">
            {board.columns.map((column) => (
              <KanbanColumn
                key={`${column.id}:${column.title}`}
                column={column}
                cards={column.cardIds.map((cardId) => board.cards[cardId])}
                disabled={saving || chatBusy}
                onRename={(columnId, title) => save(() => renameColumn(columnId, title))}
                onAddCard={(columnId, title, details) => save(() => addCard(columnId, title, details))}
                onEditCard={(cardId, title, details) => save(() => editCard(cardId, title, details))}
                onDeleteCard={(cardId) => save(() => deleteCard(cardId))}
              />
            ))}
          </section>
          <DragOverlay>
            {activeCard ? (
              <div className="w-[260px]">
                <KanbanCardPreview card={activeCard} />
              </div>
            ) : null}
          </DragOverlay>
        </DndContext>
      </main>
      <AIChatSidebar disabled={saving} onSend={chat} />
      </div>
    </div>
  );
};
