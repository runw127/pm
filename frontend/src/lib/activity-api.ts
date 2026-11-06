import { request } from "@/lib/api";

export type Comment = { id: string; userId: string | null; username: string | null; body: string; createdAt: string };
export type ActivityEntry = {
  id: number;
  cardId: string | null;
  username: string | null;
  action: string;
  summary: string;
  source: "user" | "ai";
  createdAt: string;
};

const boardPath = (boardId: string) => `/api/boards/${encodeURIComponent(boardId)}`;
const commentsPath = (boardId: string, cardId: string) =>
  `${boardPath(boardId)}/cards/${encodeURIComponent(cardId)}/comments`;

export const listActivity = (boardId: string, cardId?: string) =>
  request<ActivityEntry[]>(
    `${boardPath(boardId)}/activity${cardId ? `?card_id=${encodeURIComponent(cardId)}` : ""}`
  );
export const listComments = (boardId: string, cardId: string) =>
  request<Comment[]>(commentsPath(boardId, cardId));
export const addComment = (boardId: string, cardId: string, body: string) =>
  request<Comment[]>(commentsPath(boardId, cardId), "POST", { body });
export const deleteComment = (boardId: string, cardId: string, commentId: string) =>
  request<Comment[]>(`${commentsPath(boardId, cardId)}/${encodeURIComponent(commentId)}`, "DELETE");

/** "Nov 5, 14:03" in the viewer's locale and time zone. */
export const formatTime = (iso: string) =>
  new Date(iso).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });

export const describe = (entry: ActivityEntry) =>
  `${entry.username ?? "Deleted user"} ${entry.summary}${entry.source === "ai" ? " (via AI)" : ""}`;
