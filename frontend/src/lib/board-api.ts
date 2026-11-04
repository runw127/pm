import type { BoardData } from "@/lib/kanban";

export class ApiError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

export const errorFrom = async (response: Response, fallback: string) => {
  const error = await response.json().catch(() => null);
  return new ApiError(
    typeof error?.detail === "string" ? error.detail : `${fallback} (${response.status})`,
    response.status
  );
};

const request = async (path: string, method = "GET", body?: object): Promise<BoardData> => {
  const response = await fetch(path, {
    method,
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!response.ok) throw await errorFrom(response, "Request failed");
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
