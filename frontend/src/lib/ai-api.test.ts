import { afterEach, describe, expect, it, vi } from "vitest";
import { chatKey, clearChats, sendChat } from "@/lib/ai-api";

afterEach(() => vi.unstubAllGlobals());

describe("AI API", () => {
  it("posts to the board chat route with bounded history", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ text: "Hi" }) });
    vi.stubGlobal("fetch", fetchMock);
    const history = Array.from({ length: 12 }, (_, index) => ({
      role: "user" as const, content: `${index}`.padEnd(1200, "x"),
    }));
    await sendChat("board-1", "Hello", history);
    const [path, init] = fetchMock.mock.calls[0];
    expect(path).toBe("/api/boards/board-1/ai/chat");
    const body = JSON.parse(init.body);
    expect(body.message).toBe("Hello");
    expect(body.history).toHaveLength(10);
    expect(body.history[0].content).toHaveLength(1000);
  });

  it("clears every board conversation", () => {
    sessionStorage.setItem(chatKey("a"), "[]");
    sessionStorage.setItem(chatKey("b"), "[]");
    sessionStorage.setItem("other", "keep");
    clearChats();
    expect(sessionStorage.getItem(chatKey("a"))).toBeNull();
    expect(sessionStorage.getItem(chatKey("b"))).toBeNull();
    expect(sessionStorage.getItem("other")).toBe("keep");
  });
});
