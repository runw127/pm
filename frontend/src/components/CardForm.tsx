import { useState, type FormEvent } from "react";
import {
  DETAILS_MAX_LENGTH,
  PRIORITIES,
  TITLE_MAX_LENGTH,
  parseLabels,
  type CardFields,
  type Member,
  type Priority,
} from "@/lib/kanban";

type CardFormProps = {
  initial?: CardFields;
  members: Member[];
  submitLabel: string;
  disabled: boolean;
  onSubmit: (fields: CardFields) => Promise<boolean>;
  onCancel: () => void;
};

const blank: CardFields = {
  title: "", details: "", priority: "medium", dueDate: null, labels: [], assigneeId: null,
};
const inputClass =
  "w-full rounded-xl border border-[var(--stroke)] bg-white px-3 py-2 text-sm text-[var(--navy-dark)] outline-none transition focus:border-[var(--primary-blue)]";

export const CardForm = ({ initial = blank, members, submitLabel, disabled, onSubmit, onCancel }: CardFormProps) => {
  const [title, setTitle] = useState(initial.title);
  const [details, setDetails] = useState(initial.details);
  const [priority, setPriority] = useState<Priority>(initial.priority);
  const [dueDate, setDueDate] = useState(initial.dueDate ?? "");
  const [labels, setLabels] = useState(initial.labels.join(", "));
  const [assigneeId, setAssigneeId] = useState(initial.assigneeId ?? "");

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!title.trim()) return;
    await onSubmit({
      title: title.trim(),
      details: details.trim(),
      priority,
      dueDate: dueDate || null,
      labels: parseLabels(labels),
      assigneeId: assigneeId || null,
    });
  };

  return (
    <form onSubmit={submit} className="space-y-2">
      <input
        aria-label="Card title"
        placeholder="Card title"
        value={title}
        onChange={(event) => setTitle(event.target.value)}
        disabled={disabled}
        maxLength={TITLE_MAX_LENGTH}
        required
        className={`${inputClass} font-medium`}
      />
      <textarea
        aria-label="Card details"
        placeholder="Details"
        value={details}
        onChange={(event) => setDetails(event.target.value)}
        disabled={disabled}
        maxLength={DETAILS_MAX_LENGTH}
        rows={3}
        className={`${inputClass} resize-y`}
      />
      <div className="grid grid-cols-2 gap-2">
        <label className="text-xs font-semibold text-[var(--gray-text)]">
          Priority
          <select
            value={priority}
            onChange={(event) => setPriority(event.target.value as Priority)}
            disabled={disabled}
            className={`${inputClass} mt-1 capitalize`}
          >
            {PRIORITIES.map((value) => (
              <option key={value} value={value}>{value}</option>
            ))}
          </select>
        </label>
        <label className="text-xs font-semibold text-[var(--gray-text)]">
          Due date
          <input
            type="date"
            value={dueDate}
            onChange={(event) => setDueDate(event.target.value)}
            disabled={disabled}
            className={`${inputClass} mt-1`}
          />
        </label>
      </div>
      <label className="block text-xs font-semibold text-[var(--gray-text)]">
        Assignee
        <select
          value={assigneeId}
          onChange={(event) => setAssigneeId(event.target.value)}
          disabled={disabled}
          className={`${inputClass} mt-1`}
        >
          <option value="">Unassigned</option>
          {members.map((member) => (
            <option key={member.id} value={member.id}>{member.username}</option>
          ))}
        </select>
      </label>
      <label className="block text-xs font-semibold text-[var(--gray-text)]">
        Labels
        <input
          value={labels}
          onChange={(event) => setLabels(event.target.value)}
          disabled={disabled}
          placeholder="design, urgent"
          className={`${inputClass} mt-1`}
        />
      </label>
      <div className="flex items-center gap-2 pt-1">
        <button
          type="submit"
          disabled={disabled}
          className="rounded-full bg-[var(--secondary-purple)] px-4 py-2 text-xs font-semibold uppercase tracking-wide text-white transition hover:brightness-110 disabled:opacity-60"
        >
          {submitLabel}
        </button>
        <button
          type="button"
          disabled={disabled}
          onClick={onCancel}
          className="rounded-full border border-[var(--stroke)] px-3 py-2 text-xs font-semibold uppercase tracking-wide text-[var(--gray-text)] transition hover:text-[var(--navy-dark)]"
        >
          Cancel
        </button>
      </div>
    </form>
  );
};
