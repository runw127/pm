"use client";

import { useEffect, useState, type FormEvent } from "react";
import { KanbanBoard } from "@/components/KanbanBoard";
import { CHAT_SESSION_KEY } from "@/lib/ai-api";

type Status = "loading" | "signed-out" | "signed-in";

export const AuthGate = () => {
  const [status, setStatus] = useState<Status>("loading");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    fetch("/api/session")
      .then((response) => {
        if (active) setStatus(response.ok ? "signed-in" : "signed-out");
      })
      .catch(() => {
        if (active) {
          setError("Unable to check your session.");
          setStatus("signed-out");
        }
      });
    return () => {
      active = false;
    };
  }, []);

  const handleLogin = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
      });
      if (!response.ok) {
        setError(
          response.status === 401
            ? "Incorrect username or password."
            : "Unable to sign in. Please try again."
        );
        return;
      }
      setPassword("");
      setStatus("signed-in");
    } catch {
      setError("Unable to sign in. Please try again.");
    } finally {
      setBusy(false);
    }
  };

  const handleLogout = async () => {
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/logout", { method: "POST" });
      if (!response.ok) {
        setError("Unable to log out. Please try again.");
        return;
      }
      setUsername("");
      setPassword("");
      sessionStorage.removeItem(CHAT_SESSION_KEY);
      setStatus("signed-out");
    } catch {
      setError("Unable to log out. Please try again.");
    } finally {
      setBusy(false);
    }
  };

  if (status === "loading") {
    return (
      <main className="flex min-h-screen items-center justify-center text-sm text-[var(--gray-text)]">
        Checking your session...
      </main>
    );
  }

  if (status === "signed-in") {
    return (
      <div>
        <div className="mx-auto flex max-w-[1500px] items-center justify-end gap-4 px-6 pt-5 text-sm text-[var(--navy-dark)]">
          <span>Signed in as user</span>
          <button
            type="button"
            onClick={handleLogout}
            disabled={busy}
            className="rounded-full bg-[var(--secondary-purple)] px-4 py-2 font-semibold text-white disabled:opacity-60"
          >
            Log out
          </button>
        </div>
        {error && <p role="alert" className="mx-auto max-w-[1500px] px-6 text-right text-sm text-red-700">{error}</p>}
        <KanbanBoard />
      </div>
    );
  }

  return (
    <main className="flex min-h-screen items-center justify-center px-6 py-12">
      <form
        onSubmit={handleLogin}
        className="w-full max-w-md rounded-[32px] border border-[var(--stroke)] bg-white p-8 shadow-[var(--shadow)]"
      >
        <div className="mb-6 h-2 w-16 rounded-full bg-[var(--accent-yellow)]" />
        <h1 className="font-display text-3xl font-semibold text-[var(--navy-dark)]">
          Sign in
        </h1>
        <p className="mt-2 text-sm text-[var(--gray-text)]">
          Access your Kanban board.
        </p>
        <label className="mt-8 block text-sm font-semibold text-[var(--navy-dark)]">
          Username
          <input
            value={username}
            onChange={(event) => setUsername(event.target.value)}
            autoComplete="username"
            required
            className="mt-2 w-full rounded-xl border border-[var(--stroke)] px-4 py-3 font-normal outline-none focus:border-[var(--primary-blue)]"
          />
        </label>
        <label className="mt-5 block text-sm font-semibold text-[var(--navy-dark)]">
          Password
          <input
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            autoComplete="current-password"
            required
            className="mt-2 w-full rounded-xl border border-[var(--stroke)] px-4 py-3 font-normal outline-none focus:border-[var(--primary-blue)]"
          />
        </label>
        {error && <p role="alert" className="mt-4 text-sm text-red-700">{error}</p>}
        <button
          type="submit"
          disabled={busy}
          className="mt-8 w-full rounded-full bg-[var(--secondary-purple)] px-4 py-3 text-sm font-semibold text-white disabled:opacity-60"
        >
          {busy ? "Signing in..." : "Sign in"}
        </button>
      </form>
    </main>
  );
};
