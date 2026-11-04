import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { KanbanBoard } from "@/components/KanbanBoard";
import { initialData, type BoardData } from "@/lib/kanban";
import { ApiError, addCard, deleteCard, editCard, getBoard, renameColumn } from "@/lib/board-api";
import { sendChat } from "@/lib/ai-api";

vi.mock("@/lib/board-api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/board-api")>()),
  getBoard: vi.fn(), renameColumn: vi.fn(), addCard: vi.fn(),
  editCard: vi.fn(), deleteCard: vi.fn(), moveCardOnServer: vi.fn(),
}));
vi.mock("@/lib/ai-api", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/ai-api")>()), sendChat: vi.fn() }));

const copyBoard = (): BoardData => JSON.parse(JSON.stringify(initialData));

beforeEach(() => {
  vi.resetAllMocks();
  sessionStorage.clear();
  vi.mocked(getBoard).mockResolvedValue(copyBoard());
});

describe("KanbanBoard", () => {
  it("replaces the board with the authoritative AI response", async () => {
    const next = copyBoard();
    next.columns[0].cardIds.push("card-ai");
    next.cards["card-ai"] = { id: "card-ai", title: "AI card", details: "" };
    vi.mocked(sendChat).mockResolvedValue({ text: "Added a card.", board: next });
    render(<KanbanBoard onSessionExpired={vi.fn()} />);
    await screen.findByRole("heading", { name: "Kanban Studio" });
    await userEvent.type(screen.getByLabelText("Message"), "Add a card");
    await userEvent.click(screen.getByRole("button", { name: "Send message" }));
    expect(await screen.findByText("AI card")).toBeInTheDocument();
    expect(screen.getByLabelText("Conversation")).toHaveTextContent("Added a card.");
  });
  it("reports an expired session when loading, saving, or chatting", async () => {
    const expired = () => new ApiError("Not signed in", 401);
    const onSessionExpired = vi.fn();
    vi.mocked(getBoard).mockRejectedValueOnce(expired());
    const { unmount } = render(<KanbanBoard onSessionExpired={onSessionExpired} />);
    await waitFor(() => expect(onSessionExpired).toHaveBeenCalledOnce());
    unmount();

    vi.mocked(renameColumn).mockRejectedValue(expired());
    vi.mocked(sendChat).mockRejectedValue(expired());
    render(<KanbanBoard onSessionExpired={onSessionExpired} />);
    const input = within(await screen.findByTestId("column-col-backlog")).getByLabelText("Column title");
    await userEvent.clear(input);
    await userEvent.type(input, "Ideas");
    await userEvent.tab();
    await waitFor(() => expect(onSessionExpired).toHaveBeenCalledTimes(2));
    await userEvent.type(screen.getByLabelText("Message"), "Hello");
    await userEvent.click(screen.getByRole("button", { name: "Send message" }));
    await waitFor(() => expect(onSessionExpired).toHaveBeenCalledTimes(3));
  });

  it("loads the board from the API", async () => {
    render(<KanbanBoard onSessionExpired={vi.fn()} />);
    expect(screen.getByText("Loading board...")).toBeInTheDocument();
    expect(await screen.findByRole("heading", { name: "Kanban Studio" })).toBeInTheDocument();
    expect(screen.getAllByTestId(/column-/)).toHaveLength(5);
    expect(getBoard).toHaveBeenCalledOnce();
  });

  it("retries a failed board load", async () => {
    vi.mocked(getBoard).mockRejectedValueOnce(new Error("Unavailable"));
    render(<KanbanBoard onSessionExpired={vi.fn()} />);
    expect(await screen.findByRole("alert")).toHaveTextContent("Unavailable");
    await userEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(await screen.findByRole("heading", { name: "Kanban Studio" })).toBeInTheDocument();
  });

  it("saves a renamed column on blur", async () => {
    const next = copyBoard();
    next.columns[0].title = "Ideas";
    vi.mocked(renameColumn).mockResolvedValue(next);
    render(<KanbanBoard onSessionExpired={vi.fn()} />);
    const input = within(await screen.findByTestId("column-col-backlog")).getByLabelText("Column title");
    await userEvent.clear(input);
    await userEvent.type(input, "Ideas");
    expect(renameColumn).not.toHaveBeenCalled();
    await userEvent.tab();
    await waitFor(() => expect(renameColumn).toHaveBeenCalledWith("col-backlog", "Ideas"));
    expect(input).toHaveValue("Ideas");
  });

  it("keeps the confirmed title when saving fails", async () => {
    vi.mocked(renameColumn).mockRejectedValue(new Error("Save failed"));
    render(<KanbanBoard onSessionExpired={vi.fn()} />);
    const input = within(await screen.findByTestId("column-col-backlog")).getByLabelText("Column title");
    await userEvent.clear(input);
    await userEvent.type(input, "Ideas");
    await userEvent.tab();
    expect(await screen.findByRole("alert")).toHaveTextContent("Save failed");
    expect(input).toHaveValue("Backlog");
  });

  it("adds, edits, and deletes a card with server responses", async () => {
    const added = copyBoard();
    added.columns[0].cardIds.push("card-new");
    added.cards["card-new"] = { id: "card-new", title: "New card", details: "Notes" };
    const edited = JSON.parse(JSON.stringify(added)) as BoardData;
    edited.cards["card-new"].title = "Updated card";
    vi.mocked(addCard).mockResolvedValue(added);
    vi.mocked(editCard).mockResolvedValue(edited);
    vi.mocked(deleteCard).mockResolvedValue(copyBoard());
    render(<KanbanBoard onSessionExpired={vi.fn()} />);
    const column = await screen.findByTestId("column-col-backlog");

    await userEvent.click(within(column).getByRole("button", { name: "Add a card" }));
    await userEvent.type(within(column).getByPlaceholderText("Card title"), "New card");
    await userEvent.type(within(column).getByPlaceholderText("Details"), "Notes");
    await userEvent.click(within(column).getByRole("button", { name: "Add card" }));
    await waitFor(() => expect(addCard).toHaveBeenCalledWith("col-backlog", "New card", "Notes"));
    expect(await within(column).findByText("New card")).toBeInTheDocument();

    await userEvent.click(within(column).getByRole("button", { name: "Edit New card" }));
    const card = within(column).getByTestId("card-card-new");
    await userEvent.clear(within(card).getByLabelText("Edit card title"));
    await userEvent.type(within(card).getByLabelText("Edit card title"), "Updated card");
    await userEvent.click(within(card).getByRole("button", { name: "Save card" }));
    await waitFor(() => expect(editCard).toHaveBeenCalledWith("card-new", "Updated card", "Notes"));
    expect(await within(column).findByText("Updated card")).toBeInTheDocument();

    await userEvent.click(within(column).getByRole("button", { name: "Delete Updated card" }));
    await waitFor(() => expect(deleteCard).toHaveBeenCalledWith("card-new"));
    await waitFor(() => expect(within(column).queryByText("Updated card")).not.toBeInTheDocument());
  });

  it("shows a failed add without inventing a saved card", async () => {
    vi.mocked(addCard).mockRejectedValue(new Error("Network error"));
    render(<KanbanBoard onSessionExpired={vi.fn()} />);
    const column = await screen.findByTestId("column-col-backlog");
    await userEvent.click(within(column).getByRole("button", { name: "Add a card" }));
    await userEvent.type(within(column).getByPlaceholderText("Card title"), "Unsaved");
    await userEvent.click(within(column).getByRole("button", { name: "Add card" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Network error");
    expect(within(column).getByPlaceholderText("Card title")).toHaveValue("Unsaved");
    expect(within(column).queryByText("Unsaved")).not.toBeInTheDocument();
  });

  it("shows saving until the server confirms a new card", async () => {
    let confirm!: (board: BoardData) => void;
    vi.mocked(addCard).mockReturnValue(new Promise((resolve) => { confirm = resolve; }));
    render(<KanbanBoard onSessionExpired={vi.fn()} />);
    const column = await screen.findByTestId("column-col-backlog");
    await userEvent.click(within(column).getByRole("button", { name: "Add a card" }));
    await userEvent.type(within(column).getByPlaceholderText("Card title"), "Pending card");
    await userEvent.click(within(column).getByRole("button", { name: "Add card" }));
    expect(screen.getByText("Saving...")).toBeInTheDocument();
    expect(within(column).queryByText("Pending card")).not.toBeInTheDocument();

    const confirmed = copyBoard();
    confirmed.columns[0].cardIds.push("card-pending");
    confirmed.cards["card-pending"] = { id: "card-pending", title: "Pending card", details: "" };
    await act(async () => confirm(confirmed));
    expect(await within(column).findByText("Pending card")).toBeInTheDocument();
    expect(screen.queryByText("Saving...")).not.toBeInTheDocument();
  });
});
