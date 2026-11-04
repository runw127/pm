import { errorFrom } from "@/lib/board-api";
import type { BoardData } from "@/lib/kanban";

export type ChatMessage = { role: "user" | "assistant"; content: string };
export type ChatReply = { text: string; board: BoardData };

export const CHAT_SESSION_KEY = "kanban-studio-chat";

export const sendChat = async (message: string, history: ChatMessage[]): Promise<ChatReply> => {
  const response = await fetch("/api/ai/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message, history: history.slice(-10).map((item) => ({
      role: item.role, content: item.content.slice(0, 1000),
    })) }),
  });
  if (!response.ok) throw await errorFrom(response, "Chat failed");
  return response.json();
};
