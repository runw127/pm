import { request } from "@/lib/api";
import type { BoardData } from "@/lib/kanban";

export type ChatMessage = { role: "user" | "assistant"; content: string };
export type ChatReply = { text: string; board: BoardData };

export const CHAT_SESSION_PREFIX = "kanban-studio-chat:";
export const chatKey = (boardId: string) => `${CHAT_SESSION_PREFIX}${boardId}`;

export const clearChats = () => {
  Object.keys(sessionStorage)
    .filter((key) => key.startsWith(CHAT_SESSION_PREFIX))
    .forEach((key) => sessionStorage.removeItem(key));
};

export const sendChat = (boardId: string, message: string, history: ChatMessage[]) =>
  request<ChatReply>(`/api/boards/${encodeURIComponent(boardId)}/ai/chat`, "POST", {
    message,
    history: history.slice(-10).map((item) => ({ role: item.role, content: item.content.slice(0, 1000) })),
  });
