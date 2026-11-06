import { describe, expect, it } from "vitest";
import {
  boardLabels,
  boardStats,
  checklistProgress,
  canEdit,
  dueStatus,
  initialData,
  isFiltering,
  matchesFilter,
  memberName,
  moveCard,
  parseLabels,
  todayIso,
  type Column,
} from "@/lib/kanban";

describe("moveCard", () => {
  const baseColumns: Column[] = [
    { id: "col-a", title: "A", cardIds: ["card-1", "card-2"] },
    { id: "col-b", title: "B", cardIds: ["card-3"] },
  ];

  it("reorders cards in the same column", () => {
    const result = moveCard(baseColumns, "card-2", "card-1");
    expect(result[0].cardIds).toEqual(["card-2", "card-1"]);
  });

  it("moves cards to another column", () => {
    const result = moveCard(baseColumns, "card-2", "card-3");
    expect(result[0].cardIds).toEqual(["card-1"]);
    expect(result[1].cardIds).toEqual(["card-2", "card-3"]);
  });

  it("drops cards to the end of a column", () => {
    const result = moveCard(baseColumns, "card-1", "col-b");
    expect(result[0].cardIds).toEqual(["card-2"]);
    expect(result[1].cardIds).toEqual(["card-3", "card-1"]);
  });
});

describe("card helpers", () => {
  const card = initialData.cards["card-1"];

  it("filters by text, priority, and label", () => {
    expect(matchesFilter(card, { query: "", priority: "", label: "", assignee: "" })).toBe(true);
    expect(matchesFilter(card, { query: "ROADMAP", priority: "", label: "", assignee: "" })).toBe(true);
    expect(matchesFilter(card, { query: "impact", priority: "", label: "", assignee: "" })).toBe(true);
    expect(matchesFilter(card, { query: "planning", priority: "", label: "", assignee: "" })).toBe(true);
    expect(matchesFilter(card, { query: "missing", priority: "", label: "", assignee: "" })).toBe(false);
    expect(matchesFilter(card, { query: "", priority: "high", label: "", assignee: "" })).toBe(true);
    expect(matchesFilter(card, { query: "", priority: "low", label: "", assignee: "" })).toBe(false);
    expect(matchesFilter(card, { query: "", priority: "", label: "Planning", assignee: "" })).toBe(true);
    expect(matchesFilter(card, { query: "", priority: "", label: "qa", assignee: "" })).toBe(false);
    expect(isFiltering({ query: "  ", priority: "", label: "", assignee: "" })).toBe(false);
    expect(isFiltering({ query: "", priority: "", label: "", assignee: "none" })).toBe(true);
    expect(isFiltering({ query: "", priority: "low", label: "", assignee: "" })).toBe(true);
  });

  it("filters by assignee", () => {
    const assigned = initialData.cards["card-2"];
    const filter = { query: "", priority: "" as const, label: "" };
    expect(matchesFilter(assigned, { ...filter, assignee: "user-2" })).toBe(true);
    expect(matchesFilter(assigned, { ...filter, assignee: "user-1" })).toBe(false);
    expect(matchesFilter(assigned, { ...filter, assignee: "none" })).toBe(false);
    expect(matchesFilter(card, { ...filter, assignee: "none" })).toBe(true);
  });

  it("resolves member names and edit rights", () => {
    expect(memberName(initialData.members, "user-2")).toBe("bob");
    expect(memberName(initialData.members, null)).toBeNull();
    expect(memberName(initialData.members, "gone")).toBeNull();
    expect(canEdit("owner")).toBe(true);
    expect(canEdit("editor")).toBe(true);
    expect(canEdit("viewer")).toBe(false);
  });

  it("classifies due dates", () => {
    expect(dueStatus(null, "2026-06-01")).toBeNull();
    expect(dueStatus("2026-05-31", "2026-06-01")).toBe("overdue");
    expect(dueStatus("2026-06-01", "2026-06-01")).toBe("today");
    expect(dueStatus("2026-06-02", "2026-06-01")).toBe("upcoming");
    expect(todayIso()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("summarizes a board, treating the last column as done", () => {
    expect(boardStats(initialData, "2026-06-01")).toEqual({ total: 8, done: 2, overdue: 1, highPriority: 2 });
    expect(boardLabels(initialData)).toEqual(["design", "planning", "qa", "research"]);
  });

  it("counts checklist progress", () => {
    expect(checklistProgress(initialData.cards["card-3"])).toEqual({ done: 1, total: 2 });
    expect(checklistProgress(initialData.cards["card-1"])).toEqual({ done: 0, total: 0 });
  });

  it("parses comma-separated labels", () => {
    expect(parseLabels(" a, b ,, c ")).toEqual(["a", "b", "c"]);
    expect(parseLabels("")).toEqual([]);
  });
});
