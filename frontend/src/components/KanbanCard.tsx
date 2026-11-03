import { useState, type FormEvent } from "react";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import clsx from "clsx";
import type { Card } from "@/lib/kanban";

type KanbanCardProps = {
  card: Card;
  disabled: boolean;
  onEdit: (cardId: string, title: string, details: string) => Promise<boolean>;
  onDelete: (cardId: string) => Promise<boolean>;
};

export const KanbanCard = ({ card, disabled, onEdit, onDelete }: KanbanCardProps) => {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: card.id });
  const [isEditing, setIsEditing] = useState(false);
  const [title, setTitle] = useState(card.title);
  const [details, setDetails] = useState(card.details);

  const saveEdit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!title.trim()) return;
    if (await onEdit(card.id, title.trim(), details.trim())) setIsEditing(false);
  };

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  return (
    <article
      ref={setNodeRef}
      style={style}
      className={clsx(
        "rounded-2xl border border-transparent bg-white px-4 py-4 shadow-[0_12px_24px_rgba(3,33,71,0.08)]",
        "transition-all duration-150",
        isDragging && "opacity-60 shadow-[0_18px_32px_rgba(3,33,71,0.16)]"
      )}
      data-testid={`card-${card.id}`}
    >
      <div className="mb-2 flex items-center justify-between gap-2 text-xs font-semibold text-[var(--gray-text)]">
        <button
          type="button"
          {...attributes}
          {...listeners}
          disabled={disabled || isEditing}
          aria-label={`Drag ${card.title}`}
          className="cursor-grab rounded-full px-2 py-1 hover:text-[var(--navy-dark)]"
        >
          Drag
        </button>
        <div className="flex gap-1">
          <button
            type="button"
            onClick={() => {
              setTitle(card.title);
              setDetails(card.details);
              setIsEditing(true);
            }}
            disabled={disabled}
            aria-label={`Edit ${card.title}`}
            className="rounded-full px-2 py-1 hover:text-[var(--navy-dark)]"
          >
            Edit
          </button>
          <button
            type="button"
            onClick={() => void onDelete(card.id)}
            disabled={disabled}
            aria-label={`Delete ${card.title}`}
            className="rounded-full px-2 py-1 hover:text-[var(--navy-dark)]"
          >
            Remove
          </button>
        </div>
      </div>
      {isEditing ? (
        <form onSubmit={saveEdit} className="space-y-2">
          <input
            aria-label="Edit card title"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            disabled={disabled}
            required
            className="w-full rounded-xl border border-[var(--stroke)] px-3 py-2 text-sm"
          />
          <textarea
            aria-label="Edit card details"
            value={details}
            onChange={(event) => setDetails(event.target.value)}
            disabled={disabled}
            rows={3}
            className="w-full rounded-xl border border-[var(--stroke)] px-3 py-2 text-sm"
          />
          <div className="flex gap-2 text-xs font-semibold">
            <button type="submit" disabled={disabled} className="text-[var(--secondary-purple)]">Save card</button>
            <button
              type="button"
              disabled={disabled}
              onClick={() => {
                setTitle(card.title);
                setDetails(card.details);
                setIsEditing(false);
              }}
            >
              Cancel
            </button>
          </div>
        </form>
      ) : (
        <div>
          <h4 className="font-display text-base font-semibold text-[var(--navy-dark)]">
            {card.title}
          </h4>
          <p className="mt-2 text-sm leading-6 text-[var(--gray-text)]">
            {card.details}
          </p>
        </div>
      )}
    </article>
  );
};
