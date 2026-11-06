import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AIChatSidebar } from "@/components/AIChatSidebar";
import { chatKey } from "@/lib/ai-api";

beforeEach(() => sessionStorage.clear());

describe("AIChatSidebar", () => {
  it("sends a message, shows attribution, and retains history across remount", async () => {
    const onSend = vi.fn().mockResolvedValue("I added two cards.");
    const view = render(<AIChatSidebar boardId="board-1" disabled={false} open onClose={vi.fn()} onSend={onSend} />);
    await userEvent.type(screen.getByLabelText("Message"), "Add two cards");
    await userEvent.click(screen.getByRole("button", { name: "Send message" }));
    await waitFor(() => expect(onSend).toHaveBeenCalledWith("Add two cards", []));
    const conversation = screen.getByLabelText("Conversation");
    expect(await within(conversation).findByText("I added two cards.")).toBeInTheDocument();
    expect(within(conversation).getByText("You")).toBeInTheDocument();
    expect(within(conversation).getByText("AI assistant")).toBeInTheDocument();
    view.unmount();
    render(<AIChatSidebar boardId="board-1" disabled={false} open onClose={vi.fn()} onSend={onSend} />);
    expect(screen.getByLabelText("Conversation")).toHaveTextContent("I added two cards.");

    await userEvent.type(screen.getByLabelText("Message"), "What next?");
    await userEvent.click(screen.getByRole("button", { name: "Send message" }));
    await waitFor(() => expect(onSend).toHaveBeenLastCalledWith("What next?", [
      { role: "user", content: "Add two cards" },
      { role: "assistant", content: "I added two cards." },
    ]));
  });

  it("keeps a failed message ready for retry and can start a new conversation", async () => {
    const onSend = vi.fn().mockRejectedValueOnce(new Error("Model unavailable")).mockResolvedValueOnce("Ready");
    render(<AIChatSidebar boardId="board-1" disabled={false} open onClose={vi.fn()} onSend={onSend} />);
    await userEvent.type(screen.getByLabelText("Message"), "Help");
    await userEvent.click(screen.getByRole("button", { name: "Send message" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Model unavailable");
    expect(screen.getByLabelText("Message")).toHaveValue("Help");
    await userEvent.click(screen.getByRole("button", { name: "Send message" }));
    expect(await screen.findByText("Ready")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "New conversation" }));
    expect(screen.getByLabelText("Conversation")).not.toHaveTextContent("Ready");
    expect(JSON.parse(sessionStorage.getItem(chatKey("board-1")) ?? "[]")).toEqual([]);
  });

  it("hides when closed without losing the conversation", async () => {
    sessionStorage.setItem(chatKey("board-1"), JSON.stringify([{ role: "assistant", content: "Earlier" }]));
    const onClose = vi.fn();
    const view = render(<AIChatSidebar boardId="board-1" disabled={false} open onClose={onClose} onSend={vi.fn()} />);
    await userEvent.click(screen.getByRole("button", { name: "Close AI chat" }));
    expect(onClose).toHaveBeenCalledOnce();
    view.rerender(<AIChatSidebar boardId="board-1" disabled={false} open={false} onClose={onClose} onSend={vi.fn()} />);
    expect(screen.queryByRole("complementary", { name: "AI chat" })).not.toBeInTheDocument();
    view.rerender(<AIChatSidebar boardId="board-1" disabled={false} open onClose={onClose} onSend={vi.fn()} />);
    expect(screen.getByLabelText("Conversation")).toHaveTextContent("Earlier");
  });

  it("keeps a separate conversation per board", async () => {
    const onSend = vi.fn().mockResolvedValue("Board one reply");
    const view = render(<AIChatSidebar boardId="board-1" disabled={false} open onClose={vi.fn()} onSend={onSend} />);
    await userEvent.type(screen.getByLabelText("Message"), "Hello");
    await userEvent.click(screen.getByRole("button", { name: "Send message" }));
    expect(await screen.findByText("Board one reply")).toBeInTheDocument();
    view.unmount();
    render(<AIChatSidebar boardId="board-2" disabled={false} open onClose={vi.fn()} onSend={onSend} />);
    expect(screen.getByLabelText("Conversation")).not.toHaveTextContent("Board one reply");
  });
});
