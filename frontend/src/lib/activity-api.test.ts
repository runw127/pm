import { afterEach, describe as group, expect, it, vi } from "vitest";
import * as api from "@/lib/activity-api";

afterEach(() => vi.unstubAllGlobals());

const entry: api.ActivityEntry = {
  id: 1, cardId: null, username: "bob", action: "add_card", summary: 'added card "X" to Backlog',
  source: "user", createdAt: "2026-11-05T14:03:00+00:00",
};

group("activity API", () => {
  it("sends activity and comment requests", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => [] });
    vi.stubGlobal("fetch", fetchMock);
    const calls: [() => Promise<unknown>, string, string, object?][] = [
      [() => api.listActivity("b1"), "/api/boards/b1/activity", "GET"],
      [() => api.listActivity("b1", "c 1"), "/api/boards/b1/activity?card_id=c%201", "GET"],
      [() => api.listComments("b1", "c1"), "/api/boards/b1/cards/c1/comments", "GET"],
      [() => api.addComment("b1", "c1", "Hi"), "/api/boards/b1/cards/c1/comments", "POST", { body: "Hi" }],
      [() => api.deleteComment("b1", "c1", "m1"), "/api/boards/b1/cards/c1/comments/m1", "DELETE"],
    ];
    for (const [call, path, method, body] of calls) {
      await call();
      expect(fetchMock).toHaveBeenLastCalledWith(path, expect.objectContaining({
        method, body: body ? JSON.stringify(body) : undefined,
      }));
    }
  });

  it("describes entries and formats times", () => {
    expect(api.describe(entry)).toBe('bob added card "X" to Backlog');
    expect(api.describe({ ...entry, username: null, source: "ai" })).toBe('Deleted user added card "X" to Backlog (via AI)');
    expect(api.formatTime(entry.createdAt)).toMatch(/Nov/);
  });
});
