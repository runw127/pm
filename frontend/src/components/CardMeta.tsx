import clsx from "clsx";
import { checklistProgress, dueStatus, type Card } from "@/lib/kanban";

const priorityClass = {
  high: "bg-[var(--secondary-purple)] text-white",
  medium: "bg-[var(--primary-blue)]/15 text-[var(--navy-dark)]",
  low: "bg-[var(--surface)] text-[var(--gray-text)]",
};

const dueLabel = { overdue: "Overdue", today: "Due today", upcoming: "Due" };

export const CardMeta = ({ card, assignee }: { card: Card; assignee: string | null }) => {
  const status = dueStatus(card.dueDate);
  const checklist = checklistProgress(card);
  return (
    <div className="mt-3 flex flex-wrap items-center gap-1.5 text-[11px] font-semibold">
      <span className={clsx("rounded-full px-2 py-0.5 capitalize", priorityClass[card.priority])}>
        {card.priority}
      </span>
      {status && (
        <span
          className={clsx(
            "rounded-full px-2 py-0.5",
            status === "overdue" ? "bg-red-100 text-red-800" : "bg-[var(--accent-yellow)]/20 text-[var(--navy-dark)]"
          )}
        >
          {dueLabel[status]} {card.dueDate}
        </span>
      )}
      {assignee && (
        <span className="rounded-full bg-[var(--navy-dark)] px-2 py-0.5 text-white">@{assignee}</span>
      )}
      {card.commentCount > 0 && (
        <span className="rounded-full px-2 py-0.5 text-[var(--gray-text)]">
          {card.commentCount} {card.commentCount === 1 ? "comment" : "comments"}
        </span>
      )}
      {checklist.total > 0 && (
        <span
          aria-label={`Checklist ${checklist.done} of ${checklist.total} done`}
          className={clsx(
            "rounded-full px-2 py-0.5",
            checklist.done === checklist.total ? "bg-[var(--primary-blue)]/15 text-[var(--navy-dark)]" : "text-[var(--gray-text)]"
          )}
        >
          {checklist.done}/{checklist.total}
        </span>
      )}
      {card.labels.map((label) => (
        <span key={label} className="rounded-full border border-[var(--stroke)] px-2 py-0.5 text-[var(--gray-text)]">
          #{label}
        </span>
      ))}
    </div>
  );
};
