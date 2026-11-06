export const TITLE_MAX_LENGTH = 200;
export const DETAILS_MAX_LENGTH = 2000;
export const BOARD_NAME_MAX_LENGTH = 100;
export const LABEL_MAX_LENGTH = 30;
export const CHECKLIST_MAX_ITEMS = 30;
export const MAX_LABELS = 10;
export const PRIORITIES = ["low", "medium", "high"] as const;

export type Priority = (typeof PRIORITIES)[number];
export type Role = "owner" | "editor" | "viewer";
export type MemberRole = Exclude<Role, "owner">;

export type Member = { id: string; username: string; role: Role };

export type CardFields = {
  title: string;
  details: string;
  priority: Priority;
  dueDate: string | null;
  labels: string[];
  assigneeId: string | null;
};

export type ChecklistItem = { id: string; text: string; done: boolean };

export type Card = CardFields & { id: string; commentCount: number; checklist: ChecklistItem[] };

export type Column = {
  id: string;
  title: string;
  cardIds: string[];
};

export type BoardData = {
  id: string;
  name: string;
  role: Role;
  members: Member[];
  columns: Column[];
  cards: Record<string, Card>;
};

export type BoardSummary = {
  id: string;
  name: string;
  createdAt: string;
  cardCount: number;
  role: Role;
  owner: string;
};

/** `assignee` is "" (anyone), "none" (unassigned), or a member id. */
export type CardFilter = {
  query: string;
  priority: Priority | "";
  label: string;
  assignee: string;
};

export const emptyFilter: CardFilter = { query: "", priority: "", label: "", assignee: "" };

export const isFiltering = (filter: CardFilter) =>
  Boolean(filter.query.trim() || filter.priority || filter.label || filter.assignee);

const matchesAssignee = (card: Card, assignee: string) =>
  !assignee || (assignee === "none" ? card.assigneeId === null : card.assigneeId === assignee);

export const matchesFilter = (card: Card, filter: CardFilter) => {
  const query = filter.query.trim().toLowerCase();
  const text = [card.title, card.details, ...card.labels].join(" ").toLowerCase();
  return (
    (!query || text.includes(query)) &&
    (!filter.priority || card.priority === filter.priority) &&
    (!filter.label || card.labels.some((label) => label.toLowerCase() === filter.label.toLowerCase())) &&
    matchesAssignee(card, filter.assignee)
  );
};

export const boardLabels = (board: BoardData) =>
  [...new Set(Object.values(board.cards).flatMap((card) => card.labels))].sort((a, b) =>
    a.localeCompare(b)
  );

export const todayIso = () => {
  const now = new Date();
  return new Date(now.getTime() - now.getTimezoneOffset() * 60_000).toISOString().slice(0, 10);
};

export type DueStatus = "overdue" | "today" | "upcoming" | null;

export const dueStatus = (dueDate: string | null, today = todayIso()): DueStatus => {
  if (!dueDate) return null;
  if (dueDate < today) return "overdue";
  return dueDate === today ? "today" : "upcoming";
};

/** Counts for the board header; cards in the last column count as done. */
export const boardStats = (board: BoardData, today = todayIso()) => {
  const doneIds = new Set(board.columns.at(-1)?.cardIds ?? []);
  const open = Object.values(board.cards).filter((card) => !doneIds.has(card.id));
  return {
    total: Object.keys(board.cards).length,
    done: doneIds.size,
    overdue: open.filter((card) => dueStatus(card.dueDate, today) === "overdue").length,
    highPriority: open.filter((card) => card.priority === "high").length,
  };
};

export const parseLabels = (value: string) =>
  value.split(",").map((label) => label.trim()).filter(Boolean);

export const checklistProgress = (card: Card) => ({
  done: card.checklist.filter((item) => item.done).length,
  total: card.checklist.length,
});

export const canEdit = (role: Role) => role !== "viewer";

export const memberName = (members: Member[], id: string | null) =>
  members.find((member) => member.id === id)?.username ?? null;

export const initialData: BoardData = {
  id: "board-1",
  name: "Product launch",
  role: "owner",
  members: [
    { id: "user-1", username: "user", role: "owner" },
    { id: "user-2", username: "bob", role: "editor" },
  ],
  columns: [
    { id: "col-backlog", title: "Backlog", cardIds: ["card-1", "card-2"] },
    { id: "col-discovery", title: "Discovery", cardIds: ["card-3"] },
    { id: "col-progress", title: "In Progress", cardIds: ["card-4", "card-5"] },
    { id: "col-review", title: "Review", cardIds: ["card-6"] },
    { id: "col-done", title: "Done", cardIds: ["card-7", "card-8"] },
  ],
  cards: {
    "card-1": { id: "card-1", title: "Align roadmap themes", details: "Draft quarterly themes with impact statements and metrics.", priority: "high", dueDate: "2026-01-15", labels: ["planning"], assigneeId: null, commentCount: 0, checklist: [] },
    "card-2": { id: "card-2", title: "Gather customer signals", details: "Review support tags, sales notes, and churn feedback.", priority: "medium", dueDate: null, labels: ["research"], assigneeId: "user-2", commentCount: 0, checklist: [] },
    "card-3": { id: "card-3", title: "Prototype analytics view", details: "Sketch initial dashboard layout and key drill-downs.", priority: "medium", dueDate: null, labels: ["design"], assigneeId: null, commentCount: 2, checklist: [
      { id: "item-1", text: "Pick metrics", done: true },
      { id: "item-2", text: "Sketch layout", done: false },
    ] },
    "card-4": { id: "card-4", title: "Refine status language", details: "Standardize column labels and tone across the board.", priority: "low", dueDate: null, labels: [], assigneeId: null, commentCount: 0, checklist: [] },
    "card-5": { id: "card-5", title: "Design card layout", details: "Add hierarchy and spacing for scanning dense lists.", priority: "medium", dueDate: null, labels: ["design"], assigneeId: null, commentCount: 0, checklist: [] },
    "card-6": { id: "card-6", title: "QA micro-interactions", details: "Verify hover, focus, and loading states.", priority: "high", dueDate: "2099-03-01", labels: ["qa"], assigneeId: null, commentCount: 0, checklist: [] },
    "card-7": { id: "card-7", title: "Ship marketing page", details: "Final copy approved and asset pack delivered.", priority: "medium", dueDate: null, labels: [], assigneeId: null, commentCount: 0, checklist: [] },
    "card-8": { id: "card-8", title: "Close onboarding sprint", details: "Document release notes and share internally.", priority: "low", dueDate: null, labels: [], assigneeId: null, commentCount: 0, checklist: [] },
  },
};

const isColumnId = (columns: Column[], id: string) =>
  columns.some((column) => column.id === id);

const findColumnId = (columns: Column[], id: string) => {
  if (isColumnId(columns, id)) {
    return id;
  }
  return columns.find((column) => column.cardIds.includes(id))?.id;
};

export const moveCard = (
  columns: Column[],
  activeId: string,
  overId: string
): Column[] => {
  const activeColumnId = findColumnId(columns, activeId);
  const overColumnId = findColumnId(columns, overId);

  if (!activeColumnId || !overColumnId) {
    return columns;
  }

  const activeColumn = columns.find((column) => column.id === activeColumnId);
  const overColumn = columns.find((column) => column.id === overColumnId);

  if (!activeColumn || !overColumn) {
    return columns;
  }

  const isOverColumn = isColumnId(columns, overId);

  if (activeColumnId === overColumnId) {
    if (isOverColumn) {
      const nextCardIds = activeColumn.cardIds.filter(
        (cardId) => cardId !== activeId
      );
      nextCardIds.push(activeId);
      return columns.map((column) =>
        column.id === activeColumnId
          ? { ...column, cardIds: nextCardIds }
          : column
      );
    }

    const oldIndex = activeColumn.cardIds.indexOf(activeId);
    const newIndex = activeColumn.cardIds.indexOf(overId);

    if (oldIndex === -1 || newIndex === -1 || oldIndex === newIndex) {
      return columns;
    }

    const nextCardIds = [...activeColumn.cardIds];
    nextCardIds.splice(oldIndex, 1);
    nextCardIds.splice(newIndex, 0, activeId);

    return columns.map((column) =>
      column.id === activeColumnId
        ? { ...column, cardIds: nextCardIds }
        : column
    );
  }

  const activeIndex = activeColumn.cardIds.indexOf(activeId);
  if (activeIndex === -1) {
    return columns;
  }

  const nextActiveCardIds = [...activeColumn.cardIds];
  nextActiveCardIds.splice(activeIndex, 1);

  const nextOverCardIds = [...overColumn.cardIds];
  if (isOverColumn) {
    nextOverCardIds.push(activeId);
  } else {
    const overIndex = overColumn.cardIds.indexOf(overId);
    const insertIndex = overIndex === -1 ? nextOverCardIds.length : overIndex;
    nextOverCardIds.splice(insertIndex, 0, activeId);
  }

  return columns.map((column) => {
    if (column.id === activeColumnId) {
      return { ...column, cardIds: nextActiveCardIds };
    }
    if (column.id === overColumnId) {
      return { ...column, cardIds: nextOverCardIds };
    }
    return column;
  });
};
