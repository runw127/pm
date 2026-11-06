import { request } from "@/lib/api";
import type { BoardData, BoardSummary, CardFields, MemberRole } from "@/lib/kanban";

export type ArchivedCard = { id: string; title: string; column: string; archivedAt: string };

const boardPath = (boardId: string) => `/api/boards/${encodeURIComponent(boardId)}`;
const columnPath = (boardId: string, columnId: string) =>
  `${boardPath(boardId)}/columns/${encodeURIComponent(columnId)}`;
const cardPath = (boardId: string, cardId: string) =>
  `${boardPath(boardId)}/cards/${encodeURIComponent(cardId)}`;

export const listBoards = () => request<BoardSummary[]>("/api/boards");
export const createBoard = (name: string) => request<BoardData>("/api/boards", "POST", { name });
export const getBoard = (boardId: string) => request<BoardData>(boardPath(boardId));
export const renameBoard = (boardId: string, name: string) =>
  request<BoardData>(boardPath(boardId), "PATCH", { name });
export const deleteBoard = (boardId: string) =>
  request<BoardSummary[]>(boardPath(boardId), "DELETE");

export const addColumn = (boardId: string, title: string) =>
  request<BoardData>(`${boardPath(boardId)}/columns`, "POST", { title });
export const renameColumn = (boardId: string, columnId: string, title: string) =>
  request<BoardData>(columnPath(boardId, columnId), "PATCH", { title });
export const deleteColumn = (boardId: string, columnId: string) =>
  request<BoardData>(columnPath(boardId, columnId), "DELETE");
export const moveColumn = (boardId: string, columnId: string, toIndex: number) =>
  request<BoardData>(`${columnPath(boardId, columnId)}/move`, "POST", { toIndex });

export const addCard = (boardId: string, columnId: string, fields: CardFields) =>
  request<BoardData>(`${boardPath(boardId)}/cards`, "POST", { columnId, ...fields });
export const editCard = (boardId: string, cardId: string, fields: Partial<CardFields>) =>
  request<BoardData>(cardPath(boardId, cardId), "PATCH", fields);
export const deleteCard = (boardId: string, cardId: string) =>
  request<BoardData>(cardPath(boardId, cardId), "DELETE");
export const archiveCard = (boardId: string, cardId: string) =>
  request<BoardData>(`${cardPath(boardId, cardId)}/archive`, "POST");
export const restoreCard = (boardId: string, cardId: string) =>
  request<BoardData>(`${cardPath(boardId, cardId)}/restore`, "POST");
export const listArchived = (boardId: string) =>
  request<ArchivedCard[]>(`${boardPath(boardId)}/archive`);
export const moveCardOnServer = (boardId: string, cardId: string, toColumnId: string, toIndex: number) =>
  request<BoardData>(`${cardPath(boardId, cardId)}/move`, "POST", { toColumnId, toIndex });

export const shareBoard = (boardId: string, username: string, role: MemberRole) =>
  request<BoardData>(`${boardPath(boardId)}/members`, "POST", { username, role });
export const removeMember = (boardId: string, memberId: string) =>
  request<BoardData>(`${boardPath(boardId)}/members/${encodeURIComponent(memberId)}`, "DELETE");
export const leaveBoard = (boardId: string) =>
  request<BoardSummary[]>(`${boardPath(boardId)}/leave`, "POST");

const checklistPath = (boardId: string, cardId: string, itemId = "") =>
  `${cardPath(boardId, cardId)}/checklist${itemId ? `/${encodeURIComponent(itemId)}` : ""}`;

export const addChecklistItem = (boardId: string, cardId: string, text: string) =>
  request<BoardData>(checklistPath(boardId, cardId), "POST", { text });
export const editChecklistItem = (
  boardId: string, cardId: string, itemId: string, change: { text?: string; done?: boolean }
) => request<BoardData>(checklistPath(boardId, cardId, itemId), "PATCH", change);
export const deleteChecklistItem = (boardId: string, cardId: string, itemId: string) =>
  request<BoardData>(checklistPath(boardId, cardId, itemId), "DELETE");
