"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import clsx from "clsx";
import { KanbanBoard } from "@/components/KanbanBoard";
import { AccountSettings } from "@/components/AccountSettings";
import { AdminPanel } from "@/components/AdminPanel";
import { MyWork } from "@/components/MyWork";
import { isExpired, messageOf } from "@/lib/api";
import type { SessionUser } from "@/lib/account-api";
import { createBoard, deleteBoard, listBoards } from "@/lib/board-api";
import { BOARD_NAME_MAX_LENGTH, type BoardData, type BoardSummary } from "@/lib/kanban";

export const ACTIVE_BOARD_KEY = "pm-active-board";

type View = "boards" | "work" | "account" | "admin";

type WorkspaceProps = {
  user: SessionUser;
  onLogout: () => Promise<void>;
  onSessionExpired: () => void;
  onAccountDeleted: () => void;
};

const fieldClass =
  "rounded-xl border border-[var(--stroke)] bg-white px-3 py-2 text-sm text-[var(--navy-dark)] outline-none focus:border-[var(--primary-blue)]";

const navClass = (active: boolean) =>
  clsx(
    "rounded-full px-4 py-2 text-sm font-semibold transition",
    active ? "bg-[var(--navy-dark)] text-white" : "text-[var(--navy-dark)] hover:bg-white"
  );

const boardOption = (board: BoardSummary) =>
  board.role === "owner"
    ? `${board.name} (${board.cardCount})`
    : `${board.name} - ${board.owner}, ${board.role} (${board.cardCount})`;

export const Workspace = ({ user, onLogout, onSessionExpired, onAccountDeleted }: WorkspaceProps) => {
  const [boards, setBoards] = useState<BoardSummary[] | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [view, setView] = useState<View>("boards");
  const [newName, setNewName] = useState("");
  // Card to open when a board loads; `n` remounts the board so the same card can be reopened.
  const [focus, setFocus] = useState<{ cardId: string; n: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const select = (boardId: string) => {
    setActiveId(boardId);
    setView("boards");
    localStorage.setItem(ACTIVE_BOARD_KEY, boardId);
  };

  const fail = useCallback(
    (cause: unknown, fallback: string) => {
      if (isExpired(cause)) return onSessionExpired();
      setError(messageOf(cause, fallback));
    },
    [onSessionExpired]
  );

  const load = useCallback(async () => {
    setError("");
    try {
      const list = await listBoards();
      const remembered = localStorage.getItem(ACTIVE_BOARD_KEY);
      setBoards(list);
      setActiveId(list.some((board) => board.id === remembered) ? remembered : list[0].id);
    } catch (cause) {
      fail(cause, "Unable to load boards.");
    }
  }, [fail]);

  useEffect(() => {
    void load();
  }, [load]);

  const run = async (action: () => Promise<void>, fallback: string) => {
    setBusy(true);
    setError("");
    try {
      await action();
    } catch (cause) {
      fail(cause, fallback);
    } finally {
      setBusy(false);
    }
  };

  const create = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const name = newName.trim();
    if (!name) return;
    void run(async () => {
      const board = await createBoard(name);
      const summary = { id: board.id, name: board.name, createdAt: "", cardCount: 0, role: board.role, owner: user.username };
      setBoards((current) => {
        const list = current ?? [];
        const owned = list.filter((item) => item.role === "owner");
        return [...owned, summary, ...list.filter((item) => item.role !== "owner")];
      });
      setNewName("");
      select(board.id);
    }, "Unable to create board.");
  };

  const remove = (board: BoardSummary) => {
    if (!window.confirm(`Delete board "${board.name}" and all of its cards?`)) return;
    void run(async () => {
      const list = await deleteBoard(board.id);
      setBoards(list);
      if (activeId === board.id) select(list[0].id);
    }, "Unable to delete board.");
  };

  const left = (list: BoardSummary[]) => {
    setBoards(list);
    select(list[0].id);
  };

  const boardChanged = useCallback((board: BoardData) => {
    setBoards((current) =>
      current?.map((item) =>
        item.id === board.id ? { ...item, name: board.name, cardCount: Object.keys(board.cards).length } : item
      ) ?? current
    );
  }, []);

  const owned = boards?.filter((board) => board.role === "owner") ?? [];
  const shared = boards?.filter((board) => board.role !== "owner") ?? [];
  const activeBoard = boards?.find((board) => board.id === activeId);

  return (
    <div className="relative min-h-screen overflow-hidden">
      <div className="pointer-events-none absolute left-0 top-0 h-[420px] w-[420px] -translate-x-1/3 -translate-y-1/3 rounded-full bg-[radial-gradient(circle,_rgba(32,157,215,0.25)_0%,_rgba(32,157,215,0.05)_55%,_transparent_70%)]" />
      <div className="relative mx-auto flex max-w-[1800px] flex-col gap-5 px-6 pb-6 pt-5">
        <nav className="flex flex-wrap items-center gap-x-4 gap-y-3" aria-label="Main">
          <div className="flex items-center gap-3">
            <span className="h-3 w-3 rounded-full bg-[var(--accent-yellow)]" />
            <h1 className="font-display text-2xl font-semibold text-[var(--navy-dark)]">Kanban Studio</h1>
          </div>
          <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Boards">
            {!boards && <span className="text-sm text-[var(--gray-text)]">Loading boards...</span>}
            {boards && activeId && (
              <select
                aria-label="Board"
                value={activeId}
                onChange={(event) => select(event.target.value)}
                className={clsx(fieldClass, "max-w-[260px] font-semibold")}
              >
                <optgroup label="Your boards">
                  {owned.map((board) => <option key={board.id} value={board.id}>{boardOption(board)}</option>)}
                </optgroup>
                {shared.length > 0 && (
                  <optgroup label="Shared with you">
                    {shared.map((board) => <option key={board.id} value={board.id}>{boardOption(board)}</option>)}
                  </optgroup>
                )}
              </select>
            )}
            {activeBoard?.role === "owner" && owned.length > 1 && (
              <button
                type="button"
                disabled={busy}
                onClick={() => remove(activeBoard)}
                aria-label={`Delete board ${activeBoard.name}`}
                className="rounded-full px-3 py-2 text-xs font-semibold text-[var(--gray-text)] hover:text-red-700 disabled:opacity-50"
              >
                Delete
              </button>
            )}
            <form onSubmit={create} className="flex items-center gap-2">
              <input
                aria-label="New board name"
                placeholder="New board name"
                value={newName}
                onChange={(event) => setNewName(event.target.value)}
                maxLength={BOARD_NAME_MAX_LENGTH}
                className={clsx(fieldClass, "w-44")}
              />
              <button
                type="submit"
                disabled={busy || !newName.trim()}
                className="rounded-full border border-[var(--secondary-purple)] px-4 py-2 text-sm font-semibold text-[var(--secondary-purple)] disabled:opacity-50"
              >
                Create board
              </button>
            </form>
          </div>
          <div className="ml-auto flex flex-wrap items-center gap-2">
            <button type="button" className={navClass(view === "boards")} onClick={() => setView("boards")}>Boards</button>
            <button type="button" className={navClass(view === "work")} onClick={() => setView("work")}>My work</button>
            <button type="button" className={navClass(view === "account")} onClick={() => setView("account")}>Account</button>
            {user.isAdmin && (
              <button type="button" className={navClass(view === "admin")} onClick={() => setView("admin")}>Users</button>
            )}
            <span className="px-2 text-sm text-[var(--gray-text)]">Signed in as {user.username}</span>
            <button
              type="button"
              onClick={() => void onLogout()}
              className="rounded-full bg-[var(--secondary-purple)] px-4 py-2 text-sm font-semibold text-white"
            >
              Log out
            </button>
          </div>
        </nav>
        {error && <p role="alert" className="text-sm text-red-700">{error}</p>}

        {view === "work" && (
          <MyWork
            onSessionExpired={onSessionExpired}
            onOpen={(boardId, cardId) => {
              setFocus((current) => ({ cardId, n: (current?.n ?? 0) + 1 }));
              select(boardId);
            }}
          />
        )}
        {view === "account" && (
          <AccountSettings user={user} onSessionExpired={onSessionExpired} onDeleted={onAccountDeleted} />
        )}
        {view === "admin" && user.isAdmin && <AdminPanel currentUserId={user.id} onSessionExpired={onSessionExpired} />}
        {view === "boards" && activeId && (
          <KanbanBoard
            key={`${activeId}:${focus?.n ?? 0}`}
            boardId={activeId}
            initialCardId={focus?.cardId}
            currentUserId={user.id}
            onSessionExpired={onSessionExpired}
            onBoardChanged={boardChanged}
            onLeft={left}
          />
        )}
      </div>
    </div>
  );
};
