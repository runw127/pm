import { useState, type FormEvent } from "react";
import type { BoardData, MemberRole } from "@/lib/kanban";

type MembersPanelProps = {
  board: BoardData;
  disabled: boolean;
  onShare: (username: string, role: MemberRole) => Promise<boolean>;
  onRemove: (memberId: string) => Promise<boolean>;
  onLeave: () => void;
};

const fieldClass =
  "rounded-xl border border-[var(--stroke)] bg-white px-3 py-2 text-sm text-[var(--navy-dark)] outline-none focus:border-[var(--primary-blue)]";
const smallButton =
  "rounded-full border border-[var(--stroke)] px-3 py-1 text-xs font-semibold text-[var(--navy-dark)] hover:border-[var(--primary-blue)] disabled:opacity-50";

export const MembersPanel = ({ board, disabled, onShare, onRemove, onLeave }: MembersPanelProps) => {
  const [username, setUsername] = useState("");
  const [role, setRole] = useState<MemberRole>("editor");
  const isOwner = board.role === "owner";

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (username.trim() && (await onShare(username.trim(), role))) setUsername("");
  };

  return (
    <section aria-label="Board members" className="rounded-2xl border border-[var(--stroke)] bg-[var(--surface)] p-4">
      <h3 className="text-xs font-semibold uppercase tracking-[0.2em] text-[var(--gray-text)]">Members</h3>
      <ul className="mt-3 flex flex-col gap-2">
        {board.members.map((member) => (
          <li key={member.id} className="flex flex-wrap items-center justify-between gap-2 text-sm">
            <span className="font-semibold text-[var(--navy-dark)]">{member.username}</span>
            {isOwner && member.role !== "owner" ? (
              <span className="flex items-center gap-2">
                <select
                  aria-label={`Role for ${member.username}`}
                  value={member.role}
                  disabled={disabled}
                  onChange={(event) => void onShare(member.username, event.target.value as MemberRole)}
                  className={`${fieldClass} py-1`}
                >
                  <option value="editor">Editor</option>
                  <option value="viewer">Viewer</option>
                </select>
                <button type="button" className={smallButton} disabled={disabled}
                  onClick={() => void onRemove(member.id)} aria-label={`Remove ${member.username}`}>
                  Remove
                </button>
              </span>
            ) : (
              <span className="text-xs font-semibold capitalize text-[var(--gray-text)]">{member.role}</span>
            )}
          </li>
        ))}
      </ul>
      {isOwner ? (
        <form onSubmit={submit} className="mt-4 flex flex-wrap gap-2">
          <input
            aria-label="Share with username"
            placeholder="Username"
            value={username}
            onChange={(event) => setUsername(event.target.value)}
            disabled={disabled}
            className={`${fieldClass} min-w-[160px] flex-1`}
          />
          <select aria-label="New member role" value={role} disabled={disabled}
            onChange={(event) => setRole(event.target.value as MemberRole)} className={fieldClass}>
            <option value="editor">Editor</option>
            <option value="viewer">Viewer</option>
          </select>
          <button type="submit" disabled={disabled || !username.trim()}
            className="rounded-full bg-[var(--secondary-purple)] px-4 py-2 text-xs font-semibold uppercase tracking-wide text-white disabled:opacity-50">
            Share
          </button>
        </form>
      ) : (
        <button type="button" className={`${smallButton} mt-4`} disabled={disabled} onClick={onLeave}>
          Leave board
        </button>
      )}
    </section>
  );
};
