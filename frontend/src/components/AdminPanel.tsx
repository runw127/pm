"use client";

import { useCallback, useEffect, useState } from "react";
import { isExpired, messageOf } from "@/lib/api";
import { listUsers, removeUser, resetPassword, setAdmin, type ManagedUser } from "@/lib/account-api";

type AdminPanelProps = {
  currentUserId: string;
  onSessionExpired: () => void;
};

const smallButton =
  "rounded-full border border-[var(--stroke)] px-3 py-1 text-xs font-semibold text-[var(--navy-dark)] hover:border-[var(--primary-blue)] disabled:opacity-50";

export const AdminPanel = ({ currentUserId, onSessionExpired }: AdminPanelProps) => {
  const [users, setUsers] = useState<ManagedUser[] | null>(null);
  const [resetting, setResetting] = useState<string | null>(null);
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");

  const run = useCallback(
    async (action: () => Promise<void>, fallback: string) => {
      setBusy(true);
      setError("");
      setStatus("");
      try {
        await action();
      } catch (cause) {
        if (isExpired(cause)) return onSessionExpired();
        setError(messageOf(cause, fallback));
      } finally {
        setBusy(false);
      }
    },
    [onSessionExpired]
  );

  useEffect(() => {
    void run(async () => setUsers(await listUsers()), "Unable to load users.");
  }, [run]);

  const remove = (user: ManagedUser) => {
    if (!window.confirm(`Delete ${user.username} and all of their boards?`)) return;
    void run(async () => setUsers(await removeUser(user.id)), "Unable to delete user.");
  };

  const submitReset = (user: ManagedUser) =>
    void run(async () => {
      await resetPassword(user.id, password);
      setResetting(null);
      setPassword("");
      setStatus(`Password reset for ${user.username}.`);
    }, "Unable to reset password.");

  return (
    <section aria-label="User management" className="rounded-[28px] border border-[var(--stroke)] bg-white p-6 shadow-[var(--shadow)]">
      <h2 className="font-display text-2xl font-semibold text-[var(--navy-dark)]">Users</h2>
      <p className="mt-1 text-sm text-[var(--gray-text)]">Manage accounts and administrator access.</p>
      {status && <p role="status" className="mt-3 text-sm text-[var(--primary-blue)]">{status}</p>}
      {error && <p role="alert" className="mt-3 text-sm text-red-700">{error}</p>}
      {!users ? (
        <p className="mt-6 text-sm text-[var(--gray-text)]">Loading users...</p>
      ) : (
        <div className="mt-6 overflow-x-auto">
          <table className="w-full min-w-[640px] text-left text-sm">
            <thead className="text-xs uppercase tracking-[0.15em] text-[var(--gray-text)]">
              <tr>
                <th className="py-2">Username</th>
                <th>Role</th>
                <th>Boards</th>
                <th>Joined</th>
                <th className="text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {users.map((user) => (
                <tr key={user.id} className="border-t border-[var(--stroke)] align-top">
                  <td className="py-3 font-semibold text-[var(--navy-dark)]">
                    {user.username}
                    {user.id === currentUserId && <span className="ml-2 text-xs text-[var(--gray-text)]">(you)</span>}
                  </td>
                  <td className="py-3">{user.isAdmin ? "Admin" : "Member"}</td>
                  <td className="py-3">{user.boardCount}</td>
                  <td className="py-3 text-[var(--gray-text)]">{user.createdAt.slice(0, 10)}</td>
                  <td className="py-3">
                    <div className="flex flex-wrap justify-end gap-2">
                      <button
                        type="button"
                        className={smallButton}
                        disabled={busy}
                        onClick={() => void run(async () => setUsers(await setAdmin(user.id, !user.isAdmin)), "Unable to change role.")}
                      >
                        {user.isAdmin ? `Revoke admin for ${user.username}` : `Make ${user.username} admin`}
                      </button>
                      {user.id !== currentUserId && (
                        <>
                          <button type="button" className={smallButton} disabled={busy}
                            onClick={() => { setResetting(user.id); setPassword(""); }}>
                            Reset password for {user.username}
                          </button>
                          <button type="button" className={`${smallButton} text-red-700`} disabled={busy}
                            onClick={() => remove(user)}>
                            Delete {user.username}
                          </button>
                        </>
                      )}
                    </div>
                    {resetting === user.id && (
                      <form
                        className="mt-2 flex justify-end gap-2"
                        onSubmit={(event) => {
                          event.preventDefault();
                          submitReset(user);
                        }}
                      >
                        <input
                          type="password"
                          aria-label={`New password for ${user.username}`}
                          value={password}
                          onChange={(event) => setPassword(event.target.value)}
                          minLength={8}
                          required
                          className="rounded-xl border border-[var(--stroke)] px-3 py-1 text-sm"
                        />
                        <button type="submit" className={smallButton} disabled={busy}>Save password</button>
                        <button type="button" className={smallButton} onClick={() => setResetting(null)}>Cancel</button>
                      </form>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
};
