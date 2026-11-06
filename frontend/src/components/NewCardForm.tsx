import { useState } from "react";
import { CardForm } from "@/components/CardForm";
import type { CardFields, Member } from "@/lib/kanban";

type NewCardFormProps = {
  members: Member[];
  disabled: boolean;
  onAdd: (fields: CardFields) => Promise<boolean>;
};

export const NewCardForm = ({ members, disabled, onAdd }: NewCardFormProps) => {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <div className="mt-4">
      {isOpen ? (
        <CardForm
          members={members}
          submitLabel="Add card"
          disabled={disabled}
          onSubmit={async (fields) => {
            const saved = await onAdd(fields);
            if (saved) setIsOpen(false);
            return saved;
          }}
          onCancel={() => setIsOpen(false)}
        />
      ) : (
        <button
          type="button"
          disabled={disabled}
          onClick={() => setIsOpen(true)}
          className="w-full rounded-full border border-dashed border-[var(--stroke)] px-3 py-2 text-xs font-semibold uppercase tracking-wide text-[var(--primary-blue)] transition hover:border-[var(--primary-blue)]"
        >
          Add a card
        </button>
      )}
    </div>
  );
};
