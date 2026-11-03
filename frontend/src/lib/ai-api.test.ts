import { afterEach, describe, expect, it, vi } from "vitest";
import { sendChat } from "@/lib/ai-api";
import { initialData } from "@/lib/kanban";

afterEach(() => vi.unstubAllGlobals());

describe("sendChat", () => {
  it("posts the message and bounded history and returns the board", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ text: "Done", board: initialData }) });
    vi.stubGlobal("fetch", fetchMock);
    const history = Array.from({ length: 12 }, (_, i) => ({ role: "user" as const, content: String(i) }));
    expect(await sendChat("Add a card", history)).toEqual({ text: "Done", board: initialData });
    expect(fetchMock).toHaveBeenCalledWith("/api/ai/chat", expect.objectContaining({
      method: "POST",
      body: JSON.stringify({ message: "Add a card", history: history.slice(-10) }),
    }));
  });

  it("surfaces backend errors", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, json: async () => ({ detail: "Missing API key" }) }));
    await expect(sendChat("Hello", [])).rejects.toThrow("Missing API key");
  });
});
