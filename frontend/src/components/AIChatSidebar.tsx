"use client";

import { useEffect, useState, type FormEvent } from "react";
import { CHAT_SESSION_KEY, type ChatMessage } from "@/lib/ai-api";

type Props = {
  disabled: boolean;
  onSend: (message: string, history: ChatMessage[]) => Promise<string>;
};

const readHistory = (): ChatMessage[] => {
  try {
    const value: unknown = JSON.parse(sessionStorage.getItem(CHAT_SESSION_KEY) ?? "[]");
    if (!Array.isArray(value)) return [];
    return value.filter((item): item is ChatMessage =>
      typeof item === "object" && item !== null &&
      (item.role === "user" || item.role === "assistant") && typeof item.content === "string"
    ).slice(-20);
  } catch {
    return [];
  }
};

export const AIChatSidebar = ({ disabled, onSend }: Props) => {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [hydrated, setHydrated] = useState(false);
  const [draft, setDraft] = useState("");
  const [pending, setPending] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    setMessages(readHistory());
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (hydrated) sessionStorage.setItem(CHAT_SESSION_KEY, JSON.stringify(messages));
  }, [messages, hydrated]);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const message = draft.trim();
    if (!message || pending || disabled) return;
    setError("");
    setPending(message);
    try {
      const reply = await onSend(message, messages.slice(-10));
      setMessages((current) => [...current, { role: "user" as const, content: message }, { role: "assistant" as const, content: reply }].slice(-20));
      setDraft("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to send message.");
    } finally {
      setPending("");
    }
  };

  const newConversation = () => {
    setMessages([]);
    setDraft("");
    setError("");
    sessionStorage.removeItem(CHAT_SESSION_KEY);
  };

  return (
    <aside aria-label="AI chat" className="order-first flex w-full flex-col rounded-[32px] border border-[var(--stroke)] bg-white/90 p-5 shadow-[var(--shadow)] 2xl:order-last 2xl:sticky 2xl:top-5 2xl:h-[calc(100vh-2.5rem)] 2xl:w-[340px] 2xl:shrink-0">
      <div className="flex items-start justify-between gap-3 border-b border-[var(--stroke)] pb-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.25em] text-[var(--primary-blue)]">AI assistant</p>
          <h2 className="mt-2 font-display text-xl font-semibold text-[var(--navy-dark)]">Board chat</h2>
        </div>
        <button type="button" onClick={newConversation} disabled={Boolean(pending)} className="rounded-full border border-[var(--stroke)] px-3 py-2 text-xs font-semibold text-[var(--navy-dark)] disabled:opacity-50">New conversation</button>
      </div>
      <div aria-label="Conversation" aria-live="polite" className="mt-4 flex min-h-48 max-h-96 flex-1 flex-col gap-3 overflow-y-auto 2xl:max-h-none">
        {messages.length === 0 && !pending && <p className="text-sm leading-6 text-[var(--gray-text)]">Ask about your board or request card changes.</p>}
        {messages.map((item, index) => (
          <div key={index} className={`rounded-2xl p-3 text-sm leading-6 ${item.role === "user" ? "ml-5 bg-[var(--navy-dark)] text-white" : "mr-5 bg-[var(--surface)] text-[var(--navy-dark)]"}`}>
            <p className="mb-1 text-xs font-semibold uppercase tracking-[0.15em]">{item.role === "user" ? "You" : "AI assistant"}</p>
            <p className="whitespace-pre-wrap break-words">{item.content}</p>
          </div>
        ))}
        {pending && <div className="ml-5 rounded-2xl bg-[var(--navy-dark)] p-3 text-sm text-white"><p className="mb-1 text-xs font-semibold uppercase tracking-[0.15em]">You</p><p className="whitespace-pre-wrap break-words">{pending}</p></div>}
        {pending && <p role="status" className="text-sm text-[var(--gray-text)]">AI assistant is thinking...</p>}
      </div>
      <form onSubmit={submit} className="mt-4 border-t border-[var(--stroke)] pt-4">
        {error && <p role="alert" className="mb-3 text-sm text-red-700">{error}</p>}
        <label htmlFor="chat-message" className="text-sm font-semibold text-[var(--navy-dark)]">Message</label>
        <textarea id="chat-message" value={draft} onChange={(event) => setDraft(event.target.value)} maxLength={2000} rows={3} placeholder="Ask the AI assistant..." className="mt-2 w-full resize-y rounded-xl border border-[var(--stroke)] p-3 text-sm outline-none focus:border-[var(--primary-blue)]" />
        <button type="submit" disabled={!draft.trim() || Boolean(pending) || disabled} className="mt-3 w-full rounded-full bg-[var(--secondary-purple)] px-4 py-3 text-sm font-semibold text-white disabled:opacity-50">{pending ? "Sending..." : "Send message"}</button>
      </form>
    </aside>
  );
};
