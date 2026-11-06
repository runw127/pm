"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Workspace } from "@/components/Workspace";
import { clearChats } from "@/lib/ai-api";
import { ApiError, messageOf } from "@/lib/api";
import { getSession, login, logout, register, type SessionUser } from "@/lib/account-api";

type Mode = "sign-in" | "register";

const inputClass =
  "mt-2 w-full rounded-xl border border-[var(--stroke)] px-4 py-3 font-normal outline-none focus:border-[var(--primary-blue)]";

export const AuthGate = () => {
  const [loading, setLoading] = useState(true);
  const [user, setUser] = useState<SessionUser | null>(null);
  const [mode, setMode] = useState<Mode>("sign-in");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    getSession()
      .then((session) => active && setUser(session))
      .catch((cause) => {
        if (active && !(cause instanceof ApiError)) setError("Unable to check your session.");
      })
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
  }, []);

  const signOut = useCallback((message = "") => {
    clearChats();
    setMode("sign-in");
    setPassword("");
    setError(message);
    setUser(null);
  }, []);

  const handleSessionExpired = useCallback(
    () => signOut("Your session has expired. Please sign in again."),
    [signOut]
  );

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      setUser(await (mode === "sign-in" ? login : register)(username, password));
      setPassword("");
    } catch (cause) {
      if (mode === "sign-in" && cause instanceof ApiError && cause.status === 401) {
        setError("Incorrect username or password.");
      } else if (cause instanceof ApiError && cause.status < 500) {
        setError(cause.message);
      } else {
        setError(`Unable to ${mode === "sign-in" ? "sign in" : "create your account"}. Please try again.`);
      }
    } finally {
      setBusy(false);
    }
  };

  const handleLogout = async () => {
    setError("");
    try {
      await logout();
      setUsername("");
      signOut();
    } catch (cause) {
      setError(messageOf(cause, "Unable to log out. Please try again."));
    }
  };

  if (loading) {
    return (
      <main className="flex min-h-screen items-center justify-center text-sm text-[var(--gray-text)]">
        Checking your session...
      </main>
    );
  }

  if (user) {
    return (
      <>
        {error && <p role="alert" className="mx-auto max-w-[1800px] px-6 pt-3 text-right text-sm text-red-700">{error}</p>}
        <Workspace
          user={user}
          onLogout={handleLogout}
          onSessionExpired={handleSessionExpired}
          onAccountDeleted={() => signOut("Your account has been deleted.")}
        />
      </>
    );
  }

  const signingIn = mode === "sign-in";
  return (
    <main className="flex min-h-screen items-center justify-center px-6 py-12">
      <form
        onSubmit={submit}
        className="w-full max-w-md rounded-[32px] border border-[var(--stroke)] bg-white p-8 shadow-[var(--shadow)]"
      >
        <div className="mb-6 h-2 w-16 rounded-full bg-[var(--accent-yellow)]" />
        <h1 className="font-display text-3xl font-semibold text-[var(--navy-dark)]">
          {signingIn ? "Sign in" : "Create account"}
        </h1>
        <p className="mt-2 text-sm text-[var(--gray-text)]">
          {signingIn ? "Access your project boards." : "Start organizing your projects."}
        </p>
        <label className="mt-8 block text-sm font-semibold text-[var(--navy-dark)]">
          Username
          <input
            value={username}
            onChange={(event) => setUsername(event.target.value)}
            autoComplete="username"
            required
            className={inputClass}
          />
        </label>
        <label className="mt-5 block text-sm font-semibold text-[var(--navy-dark)]">
          Password
          <input
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            autoComplete={signingIn ? "current-password" : "new-password"}
            minLength={signingIn ? undefined : 8}
            required
            className={inputClass}
          />
        </label>
        {!signingIn && (
          <p className="mt-2 text-xs text-[var(--gray-text)]">
            3-32 letters, numbers, dots, dashes, or underscores; password of at least 8 characters.
          </p>
        )}
        {error && <p role="alert" className="mt-4 text-sm text-red-700">{error}</p>}
        <button
          type="submit"
          disabled={busy}
          className="mt-8 w-full rounded-full bg-[var(--secondary-purple)] px-4 py-3 text-sm font-semibold text-white disabled:opacity-60"
        >
          {busy ? "Please wait..." : signingIn ? "Sign in" : "Create account"}
        </button>
        <button
          type="button"
          onClick={() => {
            setMode(signingIn ? "register" : "sign-in");
            setError("");
          }}
          className="mt-4 w-full text-sm font-semibold text-[var(--primary-blue)]"
        >
          {signingIn ? "Need an account? Create one" : "Already have an account? Sign in"}
        </button>
      </form>
    </main>
  );
};
