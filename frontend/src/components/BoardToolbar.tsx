import { useState } from "react";
import {
  BOARD_NAME_MAX_LENGTH,
  PRIORITIES,
  boardLabels,
  boardStats,
  emptyFilter,
  isFiltering,
  type BoardData,
  type CardFilter,
  type Priority,
} from "@/lib/kanban";

type BoardToolbarProps = {
  board: BoardData;
  filter: CardFilter;
  disabled: boolean;
  membersOpen: boolean;
  activityOpen: boolean;
  archiveOpen: boolean;
  chatOpen: boolean;
  onFilterChange: (filter: CardFilter) => void;
  onRename: (name: string) => Promise<boolean>;
  onToggleMembers: () => void;
  onToggleActivity: () => void;
  onToggleArchive: () => void;
  onToggleChat: () => void;
};

const roleNote = { owner: "", editor: "Shared with you as editor", viewer: "View only" };

const fieldClass =
  "rounded-xl border border-[var(--stroke)] bg-white px-3 py-2 text-sm text-[var(--navy-dark)] outline-none focus:border-[var(--primary-blue)]";

const Stat = ({ label, value }: { label: string; value: number }) => (
  <div className="rounded-2xl border border-[var(--stroke)] bg-[var(--surface)] px-4 py-3">
    <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-[var(--gray-text)]">{label}</p>
    <p className="mt-1 text-xl font-semibold text-[var(--primary-blue)]">{value}</p>
  </div>
);

export const BoardToolbar = ({
  board,
  filter,
  disabled,
  membersOpen,
  activityOpen,
  archiveOpen,
  chatOpen,
  onFilterChange,
  onRename,
  onToggleMembers,
  onToggleActivity,
  onToggleArchive,
  onToggleChat,
}: BoardToolbarProps) => {
  const isOwner = board.role === "owner";
  const [name, setName] = useState(board.name);
  const stats = boardStats(board);
  const labels = boardLabels(board);

  const saveName = async () => {
    if (name.trim() === board.name) return setName(board.name);
    if (!name.trim() || !(await onRename(name.trim()))) setName(board.name);
  };

  return (
    <header className="flex flex-col gap-4 rounded-[32px] border border-[var(--stroke)] bg-white/80 px-6 py-5 shadow-[var(--shadow)] backdrop-blur">
      <div className="flex flex-wrap items-start justify-between gap-6">
        <div className="min-w-0 flex-1">
          <p className="flex flex-wrap items-center gap-3 text-xs font-semibold uppercase tracking-[0.35em] text-[var(--gray-text)]">
            Board
            {!isOwner && (
              <span className="rounded-full bg-[var(--accent-yellow)]/25 px-3 py-1 tracking-[0.1em] text-[var(--navy-dark)]">
                {roleNote[board.role]}
              </span>
            )}
          </p>
          <input
            aria-label="Board name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            onBlur={() => void saveName()}
            onKeyDown={(event) => {
              if (event.key === "Enter") event.currentTarget.blur();
            }}
            maxLength={BOARD_NAME_MAX_LENGTH}
            disabled={disabled}
            readOnly={!isOwner}
            className="mt-2 w-full bg-transparent font-display text-3xl font-semibold text-[var(--navy-dark)] outline-none"
          />
        </div>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4" aria-label="Board summary">
          <Stat label="Cards" value={stats.total} />
          <Stat label="Done" value={stats.done} />
          <Stat label="Overdue" value={stats.overdue} />
          <Stat label="High priority" value={stats.highPriority} />
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-3" role="search">
        <input
          type="search"
          aria-label="Search cards"
          placeholder="Search cards"
          value={filter.query}
          onChange={(event) => onFilterChange({ ...filter, query: event.target.value })}
          className={`${fieldClass} min-w-[220px] flex-1`}
        />
        <select
          aria-label="Filter by priority"
          value={filter.priority}
          onChange={(event) => onFilterChange({ ...filter, priority: event.target.value as Priority | "" })}
          className={`${fieldClass} capitalize`}
        >
          <option value="">All priorities</option>
          {PRIORITIES.map((value) => (
            <option key={value} value={value}>{value}</option>
          ))}
        </select>
        <select
          aria-label="Filter by label"
          value={filter.label}
          onChange={(event) => onFilterChange({ ...filter, label: event.target.value })}
          className={fieldClass}
        >
          <option value="">All labels</option>
          {labels.map((label) => (
            <option key={label} value={label}>{label}</option>
          ))}
        </select>
        <select
          aria-label="Filter by assignee"
          value={filter.assignee}
          onChange={(event) => onFilterChange({ ...filter, assignee: event.target.value })}
          className={fieldClass}
        >
          <option value="">Anyone</option>
          <option value="none">Unassigned</option>
          {board.members.map((member) => (
            <option key={member.id} value={member.id}>{member.username}</option>
          ))}
        </select>
        {isFiltering(filter) && (
          <button
            type="button"
            onClick={() => onFilterChange(emptyFilter)}
            className="rounded-full px-3 py-2 text-xs font-semibold text-[var(--primary-blue)]"
          >
            Clear filters
          </button>
        )}
        <button
          type="button"
          onClick={onToggleActivity}
          aria-expanded={activityOpen}
          className="ml-auto rounded-full border border-[var(--stroke)] px-4 py-2 text-xs font-semibold uppercase tracking-wide text-[var(--navy-dark)] hover:border-[var(--primary-blue)]"
        >
          Activity
        </button>
        <button
          type="button"
          onClick={onToggleArchive}
          aria-expanded={archiveOpen}
          className="rounded-full border border-[var(--stroke)] px-4 py-2 text-xs font-semibold uppercase tracking-wide text-[var(--navy-dark)] hover:border-[var(--primary-blue)]"
        >
          Archived
        </button>
        <button
          type="button"
          onClick={onToggleMembers}
          aria-expanded={membersOpen}
          className="rounded-full border border-[var(--stroke)] px-4 py-2 text-xs font-semibold uppercase tracking-wide text-[var(--navy-dark)] hover:border-[var(--primary-blue)]"
        >
          Members ({board.members.length})
        </button>
        <button
          type="button"
          onClick={onToggleChat}
          aria-expanded={chatOpen}
          className="rounded-full bg-[var(--primary-blue)] px-4 py-2 text-xs font-semibold uppercase tracking-wide text-white"
        >
          AI chat
        </button>
      </div>
    </header>
  );
};
