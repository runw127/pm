import { afterEach, describe, expect, it, vi } from "vitest";
import { groupWork, listMyWork, type WorkItem } from "@/lib/work-api";

afterEach(() => vi.unstubAllGlobals());

const item = (title: string, dueDate: string | null): WorkItem => ({
  boardId: "b1", boardName: "Board", cardId: title, title, column: "Backlog", priority: "medium",
  dueDate, labels: [], checklistDone: 0, checklistTotal: 0,
});

describe("work API", () => {
  it("loads the signed-in user's work", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => [] });
    vi.stubGlobal("fetch", fetchMock);
    await expect(listMyWork()).resolves.toEqual([]);
    expect(fetchMock).toHaveBeenCalledWith("/api/my-work", expect.objectContaining({ method: "GET" }));
  });

  it("groups work by due status in order and drops empty groups", () => {
    const items = [item("Late", "2026-11-01"), item("Now", "2026-11-06"), item("Soon", "2026-11-09"),
      item("Later", "2026-12-01"), item("Whenever", null)];
    expect(groupWork(items, "2026-11-06").map((group) => [group.label, group.items.map((entry) => entry.title)])).toEqual([
      ["Overdue", ["Late"]],
      ["Due today", ["Now"]],
      ["Upcoming", ["Soon", "Later"]],
      ["No due date", ["Whenever"]],
    ]);
    expect(groupWork([item("Whenever", null)], "2026-11-06").map((group) => group.label)).toEqual(["No due date"]);
  });
});
