"use client";

import { useState, type FormEvent } from "react";
import { isExpired, messageOf } from "@/lib/api";
import { changePassword, deleteAccount, type SessionUser } from "@/lib/account-api";

type AccountSettingsProps = {
  user: SessionUser;
  onSessionExpired: () => void;
  onDeleted: () => void;
};

const inputClass =
  "mt-1 w-full rounded-xl border border-[var(--stroke)] px-3 py-2 text-sm font-normal outline-none focus:border-[var(--primary-blue)]";
const cardClass = "rounded-[28px] border border-[var(--stroke)] bg-white p-6 shadow-[var(--shadow)]";

export const AccountSettings = ({ user, onSessionExpired, onDeleted }: AccountSettingsProps) => {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const run = async (action: () => Promise<void>, fallback: string) => {
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
  };

  const submitPassword = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    void run(async () => {
      await changePassword(current, next);
      setCurrent("");
      setNext("");
      setStatus("Password updated. Other sessions were signed out.");
    }, "Unable to change password.");
  };

  const submitDelete = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!window.confirm("Permanently delete your account and all of your boards?")) return;
    void run(async () => {
      await deleteAccount(confirmPassword);
      onDeleted();
    }, "Unable to delete account.");
  };

  return (
    <section aria-label="Account settings" className="mx-auto flex w-full max-w-2xl flex-col gap-6">
      <div className={cardClass}>
        <h2 className="font-display text-2xl font-semibold text-[var(--navy-dark)]">Account</h2>
        <p className="mt-1 text-sm text-[var(--gray-text)]">
          {user.username} &middot; {user.isAdmin ? "Administrator" : "Member"}
        </p>
        {status && <p role="status" className="mt-3 text-sm text-[var(--primary-blue)]">{status}</p>}
        {error && <p role="alert" className="mt-3 text-sm text-red-700">{error}</p>}
      </div>
      <form onSubmit={submitPassword} className={cardClass}>
        <h3 className="font-display text-lg font-semibold text-[var(--navy-dark)]">Change password</h3>
        <label className="mt-4 block text-sm font-semibold text-[var(--navy-dark)]">
          Current password
          <input type="password" value={current} onChange={(e) => setCurrent(e.target.value)}
            autoComplete="current-password" required className={inputClass} />
        </label>
        <label className="mt-3 block text-sm font-semibold text-[var(--navy-dark)]">
          New password
          <input type="password" value={next} onChange={(e) => setNext(e.target.value)}
            autoComplete="new-password" minLength={8} required className={inputClass} />
        </label>
        <button type="submit" disabled={busy}
          className="mt-4 rounded-full bg-[var(--secondary-purple)] px-4 py-2 text-sm font-semibold text-white disabled:opacity-60">
          Update password
        </button>
      </form>
      <form onSubmit={submitDelete} className={cardClass}>
        <h3 className="font-display text-lg font-semibold text-red-800">Delete account</h3>
        <p className="mt-1 text-sm text-[var(--gray-text)]">This removes your account and every board you own.</p>
        <label className="mt-4 block text-sm font-semibold text-[var(--navy-dark)]">
          Confirm with your password
          <input type="password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)}
            autoComplete="current-password" required className={inputClass} />
        </label>
        <button type="submit" disabled={busy}
          className="mt-4 rounded-full border border-red-700 px-4 py-2 text-sm font-semibold text-red-700 disabled:opacity-60">
          Delete my account
        </button>
      </form>
    </section>
  );
};
