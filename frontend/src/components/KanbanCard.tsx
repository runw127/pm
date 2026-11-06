import { useState } from "react";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import clsx from "clsx";
import { CardForm } from "@/components/CardForm";
import { CardMeta } from "@/components/CardMeta";
import { memberName, type Card, type CardFields, type Member } from "@/lib/kanban";

type KanbanCardProps = {
  card: Card;
  members: Member[];
  disabled: boolean;
  readOnly: boolean;
  onEdit: (cardId: string, fields: CardFields) => Promise<boolean>;
  onArchive: (cardId: string) => Promise<boolean>;
  onOpen: (cardId: string) => void;
};

const actionClass = "rounded-full px-1.5 py-1 hover:text-[var(--navy-dark)]";

export const KanbanCard = ({ card, members, disabled, readOnly, onEdit, onArchive, onOpen }: KanbanCardProps) => {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: card.id });
  const [isEditing, setIsEditing] = useState(false);

  return (
    <article
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={clsx(
        "rounded-2xl border border-transparent bg-white px-3 py-3 shadow-[0_12px_24px_rgba(3,33,71,0.08)]",
        "transition-all duration-150",
        isDragging && "opacity-60 shadow-[0_18px_32px_rgba(3,33,71,0.16)]"
      )}
      data-testid={`card-${card.id}`}
    >
      {!readOnly && <div className="mb-2 flex items-center justify-between gap-1 text-xs font-semibold text-[var(--gray-text)]">
        <button
          type="button"
          {...attributes}
          {...listeners}
          disabled={disabled || isEditing}
          aria-label={`Drag ${card.title}`}
          className={clsx(actionClass, "cursor-grab")}
        >
          Drag
        </button>
        <div className="flex gap-1">
          <button
            type="button"
            onClick={() => setIsEditing(true)}
            disabled={disabled}
            aria-label={`Edit ${card.title}`}
            className={actionClass}
          >
            Edit
          </button>
          <button
            type="button"
            onClick={() => void onArchive(card.id)}
            disabled={disabled}
            aria-label={`Archive ${card.title}`}
            className={actionClass}
          >
            Archive
          </button>
        </div>
      </div>}
      {isEditing ? (
        <CardForm
          initial={card}
          members={members}
          submitLabel="Save card"
          disabled={disabled}
          onSubmit={async (fields) => {
            const saved = await onEdit(card.id, fields);
            if (saved) setIsEditing(false);
            return saved;
          }}
          onCancel={() => setIsEditing(false)}
        />
      ) : (
        <div>
          <h4 className="font-display text-base font-semibold text-[var(--navy-dark)]">
            <button type="button" onClick={() => onOpen(card.id)} aria-label={`Open ${card.title}`}
              className="text-left hover:text-[var(--primary-blue)]">
              {card.title}
            </button>
          </h4>
          {card.details && (
            <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-[var(--gray-text)]">{card.details}</p>
          )}
          <CardMeta card={card} assignee={memberName(members, card.assigneeId)} />
        </div>
      )}
    </article>
  );
};
