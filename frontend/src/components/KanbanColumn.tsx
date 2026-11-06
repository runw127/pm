import { useState } from "react";
import clsx from "clsx";
import { useDroppable } from "@dnd-kit/core";
import { SortableContext, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { TITLE_MAX_LENGTH, type Card, type CardFields, type Column, type Member } from "@/lib/kanban";
import { KanbanCard } from "@/components/KanbanCard";
import { NewCardForm } from "@/components/NewCardForm";

type KanbanColumnProps = {
  column: Column;
  cards: Card[];
  members: Member[];
  totalCards: number;
  index: number;
  columnCount: number;
  disabled: boolean;
  readOnly: boolean;
  onRename: (columnId: string, title: string) => Promise<boolean>;
  onMove: (columnId: string, toIndex: number) => Promise<boolean>;
  onDelete: (columnId: string) => Promise<boolean>;
  onAddCard: (columnId: string, fields: CardFields) => Promise<boolean>;
  onEditCard: (cardId: string, fields: CardFields) => Promise<boolean>;
  onArchiveCard: (cardId: string) => Promise<boolean>;
  onOpenCard: (cardId: string) => void;
};

const iconButton =
  "rounded-full border border-[var(--stroke)] px-1.5 py-0.5 text-xs font-semibold text-[var(--gray-text)] transition hover:text-[var(--navy-dark)] disabled:opacity-40";

export const KanbanColumn = ({
  column,
  cards,
  members,
  totalCards,
  index,
  columnCount,
  disabled,
  readOnly,
  onRename,
  onMove,
  onDelete,
  onAddCard,
  onEditCard,
  onArchiveCard,
  onOpenCard,
}: KanbanColumnProps) => {
  const { setNodeRef, isOver } = useDroppable({ id: column.id });
  const [title, setTitle] = useState(column.title);

  const saveTitle = async () => {
    if (title === column.title) return;
    if (!(await onRename(column.id, title))) setTitle(column.title);
  };

  const remove = () => {
    const warning = totalCards
      ? `Delete "${column.title}" and its ${totalCards} card(s)?`
      : `Delete "${column.title}"?`;
    if (window.confirm(warning)) void onDelete(column.id);
  };

  return (
    <section
      ref={setNodeRef}
      className={clsx(
        "flex min-h-[520px] min-w-[200px] max-w-[360px] flex-1 flex-col rounded-3xl border border-[var(--stroke)] bg-[var(--surface-strong)] p-3 shadow-[var(--shadow)] transition",
        isOver && "ring-2 ring-[var(--accent-yellow)]"
      )}
      data-testid={`column-${column.id}`}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <div className="h-2 w-4 shrink-0 rounded-full bg-[var(--accent-yellow)]" />
          <span className="truncate text-xs font-semibold uppercase text-[var(--gray-text)]">
            {cards.length === totalCards ? `${totalCards} ${totalCards === 1 ? "card" : "cards"}` : `${cards.length} of ${totalCards}`}
          </span>
        </div>
        {!readOnly && <div className="flex shrink-0 gap-1">
          <button type="button" className={iconButton} disabled={disabled || index === 0}
            onClick={() => void onMove(column.id, index - 1)} aria-label={`Move ${column.title} left`}>
            &larr;
          </button>
          <button type="button" className={iconButton} disabled={disabled || index === columnCount - 1}
            onClick={() => void onMove(column.id, index + 1)} aria-label={`Move ${column.title} right`}>
            &rarr;
          </button>
          <button type="button" className={iconButton} disabled={disabled || columnCount === 1}
            onClick={remove} aria-label={`Delete column ${column.title}`}>
            &times;
          </button>
        </div>}
      </div>
      <input
        value={title}
        onChange={(event) => setTitle(event.target.value)}
        onBlur={() => void saveTitle()}
        onKeyDown={(event) => {
          if (event.key === "Enter") event.currentTarget.blur();
        }}
        disabled={disabled}
        readOnly={readOnly}
        maxLength={TITLE_MAX_LENGTH}
        className="mt-3 w-full bg-transparent font-display text-lg font-semibold text-[var(--navy-dark)] outline-none"
        aria-label="Column title"
      />
      <div className="mt-4 flex flex-1 flex-col gap-3">
        <SortableContext items={cards.map((card) => card.id)} strategy={verticalListSortingStrategy}>
          {cards.map((card) => (
            <KanbanCard key={card.id} card={card} members={members} disabled={disabled} readOnly={readOnly} onEdit={onEditCard} onArchive={onArchiveCard} onOpen={onOpenCard} />
          ))}
        </SortableContext>
        {cards.length === 0 && (
          <div className="flex flex-1 items-center justify-center rounded-2xl border border-dashed border-[var(--stroke)] px-3 py-6 text-center text-xs font-semibold uppercase tracking-[0.2em] text-[var(--gray-text)]">
            {totalCards ? "No matching cards" : "Drop a card here"}
          </div>
        )}
      </div>
      {!readOnly && <NewCardForm members={members} disabled={disabled} onAdd={(fields) => onAddCard(column.id, fields)} />}
    </section>
  );
};
