import { afterEach, describe, expect, it, vi } from "vitest";
import * as api from "@/lib/board-api";
import { initialData } from "@/lib/kanban";

afterEach(() => vi.unstubAllGlobals());

const fields = { title: "First", details: "Notes", priority: "high" as const, dueDate: "2026-12-01", labels: ["qa"], assigneeId: null };

describe("board API", () => {
  it("sends each board request with the expected path, method, and payload", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => initialData });
    vi.stubGlobal("fetch", fetchMock);

    const calls: [() => Promise<unknown>, string, string, object?][] = [
      [() => api.listBoards(), "/api/boards", "GET"],
      [() => api.createBoard("Launch"), "/api/boards", "POST", { name: "Launch" }],
      [() => api.getBoard("b 1"), "/api/boards/b%201", "GET"],
      [() => api.renameBoard("b1", "New"), "/api/boards/b1", "PATCH", { name: "New" }],
      [() => api.deleteBoard("b1"), "/api/boards/b1", "DELETE"],
      [() => api.addColumn("b1", "Blocked"), "/api/boards/b1/columns", "POST", { title: "Blocked" }],
      [() => api.renameColumn("b1", "c1", "Ideas"), "/api/boards/b1/columns/c1", "PATCH", { title: "Ideas" }],
      [() => api.deleteColumn("b1", "c1"), "/api/boards/b1/columns/c1", "DELETE"],
      [() => api.moveColumn("b1", "c1", 2), "/api/boards/b1/columns/c1/move", "POST", { toIndex: 2 }],
      [() => api.addCard("b1", "c1", fields), "/api/boards/b1/cards", "POST", { columnId: "c1", ...fields }],
      [() => api.editCard("b1", "k1", { priority: "low" }), "/api/boards/b1/cards/k1", "PATCH", { priority: "low" }],
      [() => api.deleteCard("b1", "k1"), "/api/boards/b1/cards/k1", "DELETE"],
      [() => api.archiveCard("b1", "k1"), "/api/boards/b1/cards/k1/archive", "POST"],
      [() => api.restoreCard("b1", "k1"), "/api/boards/b1/cards/k1/restore", "POST"],
      [() => api.listArchived("b1"), "/api/boards/b1/archive", "GET"],
      [() => api.shareBoard("b1", "bob", "viewer"), "/api/boards/b1/members", "POST", { username: "bob", role: "viewer" }],
      [() => api.removeMember("b1", "u2"), "/api/boards/b1/members/u2", "DELETE"],
      [() => api.leaveBoard("b1"), "/api/boards/b1/leave", "POST"],
      [() => api.moveCardOnServer("b1", "k1", "c2", 0), "/api/boards/b1/cards/k1/move", "POST", { toColumnId: "c2", toIndex: 0 }],
      [() => api.addChecklistItem("b1", "k1", "Step"), "/api/boards/b1/cards/k1/checklist", "POST", { text: "Step" }],
      [() => api.editChecklistItem("b1", "k1", "i 1", { done: true }), "/api/boards/b1/cards/k1/checklist/i%201", "PATCH", { done: true }],
      [() => api.deleteChecklistItem("b1", "k1", "i1"), "/api/boards/b1/cards/k1/checklist/i1", "DELETE"],
    ];
    for (const [call, path, method, body] of calls) {
      await call();
      expect(fetchMock).toHaveBeenLastCalledWith(path, expect.objectContaining({
        method, body: body ? JSON.stringify(body) : undefined,
      }));
    }
  });
});
