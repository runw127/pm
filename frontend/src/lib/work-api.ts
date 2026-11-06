import { request } from "@/lib/api";
import { dueStatus, todayIso, type Priority } from "@/lib/kanban";

export type WorkItem = {
  boardId: string;
  boardName: string;
  cardId: string;
  title: string;
  column: string;
  priority: Priority;
  dueDate: string | null;
  labels: string[];
  checklistDone: number;
  checklistTotal: number;
};

/** Open cards assigned to the signed-in user, soonest due first (sorted by the server). */
export const listMyWork = () => request<WorkItem[]>("/api/my-work");

const GROUPS = [
  { key: "overdue", label: "Overdue" },
  { key: "today", label: "Due today" },
  { key: "upcoming", label: "Upcoming" },
  { key: null, label: "No due date" },
] as const;

/** Split work into due-date groups, keeping the server's order and dropping empty groups. */
export const groupWork = (items: WorkItem[], today = todayIso()) =>
  GROUPS.map((group) => ({
    label: group.label,
    items: items.filter((item) => dueStatus(item.dueDate, today) === group.key),
  })).filter((group) => group.items.length > 0);
