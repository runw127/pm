import type { BoardData } from "@/lib/kanban";

const request = async (path: string, method = "GET", body?: object): Promise<BoardData> => {
  const response = await fetch(path, {
    method,
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!response.ok) {
    const error = await response.json().catch(() => null);
    throw new Error(
      typeof error?.detail === "string" ? error.detail : `Request failed (${response.status})`
    );
  }
  return response.json();
};

export const getBoard = () => request("/api/board");
export const renameColumn = (columnId: string, title: string) =>
  request(`/api/board/columns/${encodeURIComponent(columnId)}`, "PATCH", { title });
export const addCard = (columnId: string, title: string, details: string) =>
  request("/api/board/cards", "POST", { columnId, title, details });
export const editCard = (cardId: string, title: string, details: string) =>
  request(`/api/board/cards/${encodeURIComponent(cardId)}`, "PATCH", { title, details });
export const deleteCard = (cardId: string) =>
  request(`/api/board/cards/${encodeURIComponent(cardId)}`, "DELETE");
export const moveCardOnServer = (cardId: string, toColumnId: string, toIndex: number) =>
  request(`/api/board/cards/${encodeURIComponent(cardId)}/move`, "POST", {
    toColumnId,
    toIndex,
  });
