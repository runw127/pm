import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { KanbanBoard } from "@/components/KanbanBoard";
import { initialData, type BoardData } from "@/lib/kanban";
import { ApiError } from "@/lib/api";
import * as boardApi from "@/lib/board-api";
import { sendChat } from "@/lib/ai-api";
import * as activityApi from "@/lib/activity-api";

vi.mock("@/lib/board-api");
vi.mock("@/lib/activity-api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/activity-api")>()),
  listActivity: vi.fn().mockResolvedValue([]),
  listComments: vi.fn().mockResolvedValue([]),
  addComment: vi.fn(),
}));
vi.mock("@/lib/ai-api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/ai-api")>()),
  sendChat: vi.fn(),
}));

const api = vi.mocked(boardApi);
const copyBoard = (): BoardData => structuredClone(initialData);
const withCard = (board: BoardData, columnIndex: number, id: string, title: string): BoardData => {
  const next = structuredClone(board);
  next.columns[columnIndex].cardIds.push(id);
  next.cards[id] = { id, title, details: "", priority: "medium", dueDate: null, labels: [], assigneeId: null, commentCount: 0, checklist: [] };
  return next;
};

const renderBoard = (props: Partial<Parameters<typeof KanbanBoard>[0]> = {}) => {
  const onBoardChanged = vi.fn();
  const onSessionExpired = vi.fn();
  const onLeft = vi.fn();
  render(
    <KanbanBoard boardId="board-1" currentUserId="user-1" onBoardChanged={onBoardChanged} onSessionExpired={onSessionExpired} onLeft={onLeft} {...props} />
  );
  return { onBoardChanged, onSessionExpired, onLeft };
};

const column = (id: string) => screen.findByTestId(`column-${id}`);

beforeEach(() => {
  vi.resetAllMocks();
  sessionStorage.clear();
  api.getBoard.mockResolvedValue(copyBoard());
  vi.mocked(activityApi.listActivity).mockResolvedValue([]);
  vi.mocked(activityApi.listComments).mockResolvedValue([]);
});

describe("KanbanBoard", () => {
  it("loads the board, its summary, and card metadata", async () => {
    renderBoard();
    expect(screen.getByText("Loading board...")).toBeInTheDocument();
    expect(await screen.findByLabelText("Board name")).toHaveValue("Product launch");
    expect(api.getBoard).toHaveBeenCalledWith("board-1");
    expect(screen.getAllByTestId(/^column-/)).toHaveLength(5);
    const summary = screen.getByLabelText("Board summary");
    expect(within(summary).getByText("Cards").nextSibling).toHaveTextContent("8");
    expect(within(summary).getByText("High priority").nextSibling).toHaveTextContent("2");
    const card = screen.getByTestId("card-card-1");
    expect(within(card).getByText("high")).toBeInTheDocument();
    expect(within(card).getByText("#planning")).toBeInTheDocument();
    expect(within(card).getByText(/Overdue 2026-01-15/)).toBeInTheDocument();
    expect(within(screen.getByTestId("card-card-6")).getByText(/Due 2099-03-01/)).toBeInTheDocument();
  });

  it("retries a failed board load", async () => {
    api.getBoard.mockRejectedValueOnce(new Error("Unavailable"));
    renderBoard();
    expect(await screen.findByRole("alert")).toHaveTextContent("Unavailable");
    await userEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(await screen.findByLabelText("Board name")).toBeInTheDocument();
  });

  it("reports an expired session when loading, saving, or chatting", async () => {
    const expired = () => new ApiError("Not signed in", 401);
    api.getBoard.mockRejectedValueOnce(expired());
    const first = renderBoard();
    await waitFor(() => expect(first.onSessionExpired).toHaveBeenCalledOnce());

    document.body.innerHTML = "";
    api.renameColumn.mockRejectedValue(expired());
    vi.mocked(sendChat).mockRejectedValue(expired());
    const { onSessionExpired } = renderBoard();
    const input = within(await column("col-backlog")).getByLabelText("Column title");
    await userEvent.clear(input);
    await userEvent.type(input, "Ideas");
    await userEvent.tab();
    await waitFor(() => expect(onSessionExpired).toHaveBeenCalledTimes(1));
    await userEvent.click(screen.getByRole("button", { name: "AI chat" }));
    await userEvent.type(screen.getByLabelText("Message"), "Hello");
    await userEvent.click(screen.getByRole("button", { name: "Send message" }));
    await waitFor(() => expect(onSessionExpired).toHaveBeenCalledTimes(2));
  });

  it("renames the board and reports the change", async () => {
    const renamed = { ...copyBoard(), name: "Launch v2" };
    api.renameBoard.mockResolvedValue(renamed);
    const { onBoardChanged } = renderBoard();
    const name = await screen.findByLabelText("Board name");
    await userEvent.clear(name);
    await userEvent.type(name, "Launch v2{Enter}");
    await waitFor(() => expect(api.renameBoard).toHaveBeenCalledWith("board-1", "Launch v2"));
    expect(onBoardChanged).toHaveBeenCalledWith(renamed);
    expect(screen.getByLabelText("Board name")).toHaveValue("Launch v2");
  });

  it("restores the board name when it is blank or unchanged", async () => {
    renderBoard();
    const name = await screen.findByLabelText("Board name");
    await userEvent.clear(name);
    await userEvent.tab();
    expect(name).toHaveValue("Product launch");
    await userEvent.click(name);
    await userEvent.tab();
    expect(api.renameBoard).not.toHaveBeenCalled();
  });

  it("saves a renamed column and keeps the confirmed title on failure", async () => {
    const next = copyBoard();
    next.columns[0].title = "Ideas";
    api.renameColumn.mockResolvedValueOnce(next).mockRejectedValueOnce(new Error("Save failed"));
    renderBoard();
    const input = within(await column("col-backlog")).getByLabelText("Column title");
    await userEvent.clear(input);
    await userEvent.type(input, "Ideas");
    expect(api.renameColumn).not.toHaveBeenCalled();
    await userEvent.tab();
    await waitFor(() => expect(api.renameColumn).toHaveBeenCalledWith("board-1", "col-backlog", "Ideas"));
    const renamed = within(await column("col-backlog")).getByLabelText("Column title");
    expect(renamed).toHaveValue("Ideas");

    await userEvent.clear(renamed);
    await userEvent.type(renamed, "Broken{Enter}");
    expect(await screen.findByRole("alert")).toHaveTextContent("Save failed");
    expect(renamed).toHaveValue("Ideas");
  });

  it("adds, moves, and deletes columns", async () => {
    const added = copyBoard();
    added.columns.push({ id: "col-new", title: "Blocked", cardIds: [] });
    const moved = structuredClone(added);
    moved.columns.splice(4, 0, moved.columns.pop()!);
    api.addColumn.mockResolvedValue(added);
    api.moveColumn.mockResolvedValue(moved);
    api.deleteColumn.mockResolvedValue(copyBoard());
    const confirm = vi.spyOn(window, "confirm").mockReturnValueOnce(false).mockReturnValue(true);
    renderBoard();

    await userEvent.type(await screen.findByLabelText("New column title"), "Blocked");
    await userEvent.click(screen.getByRole("button", { name: "Add column" }));
    await waitFor(() => expect(api.addColumn).toHaveBeenCalledWith("board-1", "Blocked"));
    expect(await column("col-new")).toBeInTheDocument();
    expect(screen.getByLabelText("New column title")).toHaveValue("");

    expect(screen.getByRole("button", { name: "Move Backlog left" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Move Blocked right" })).toBeDisabled();
    await userEvent.click(screen.getByRole("button", { name: "Move Blocked left" }));
    await waitFor(() => expect(api.moveColumn).toHaveBeenCalledWith("board-1", "col-new", 4));
    await userEvent.click(screen.getByRole("button", { name: "Move Backlog right" }));
    await waitFor(() => expect(api.moveColumn).toHaveBeenCalledWith("board-1", "col-backlog", 1));

    await userEvent.click(screen.getByRole("button", { name: "Delete column Blocked" }));
    expect(confirm).toHaveBeenLastCalledWith('Delete "Blocked"?');
    expect(api.deleteColumn).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: "Delete column Backlog" }));
    expect(confirm).toHaveBeenLastCalledWith('Delete "Backlog" and its 2 card(s)?');
    await waitFor(() => expect(api.deleteColumn).toHaveBeenCalledWith("board-1", "col-backlog"));
    await waitFor(() => expect(screen.queryByTestId("column-col-new")).not.toBeInTheDocument());
  });

  it("adds a card with all fields, edits it, and archives it", async () => {
    const added = withCard(copyBoard(), 0, "card-new", "New card");
    const edited = structuredClone(added);
    edited.cards["card-new"] = { ...edited.cards["card-new"], title: "Updated card", priority: "low" };
    api.addCard.mockResolvedValue(added);
    api.editCard.mockResolvedValue(edited);
    api.archiveCard.mockResolvedValue(copyBoard());
    renderBoard();
    const backlog = await column("col-backlog");

    await userEvent.click(within(backlog).getByRole("button", { name: "Add a card" }));
    await userEvent.type(within(backlog).getByPlaceholderText("Card title"), "New card");
    await userEvent.type(within(backlog).getByPlaceholderText("Details"), " Notes ");
    await userEvent.selectOptions(within(backlog).getByLabelText("Priority"), "high");
    await userEvent.type(within(backlog).getByLabelText("Due date"), "2026-12-01");
    await userEvent.type(within(backlog).getByLabelText("Labels"), "qa, launch");
    await userEvent.click(within(backlog).getByRole("button", { name: "Add card" }));
    await waitFor(() => expect(api.addCard).toHaveBeenCalledWith("board-1", "col-backlog", {
      title: "New card", details: "Notes", priority: "high", dueDate: "2026-12-01", labels: ["qa", "launch"],
      assigneeId: null,
    }));
    expect(await within(backlog).findByText("New card")).toBeInTheDocument();
    expect(within(backlog).queryByPlaceholderText("Card title")).not.toBeInTheDocument();

    await userEvent.click(within(backlog).getByRole("button", { name: "Edit New card" }));
    const card = within(backlog).getByTestId("card-card-new");
    await userEvent.clear(within(card).getByLabelText("Card title"));
    await userEvent.type(within(card).getByLabelText("Card title"), "Updated card");
    await userEvent.selectOptions(within(card).getByLabelText("Priority"), "low");
    await userEvent.click(within(card).getByRole("button", { name: "Save card" }));
    await waitFor(() => expect(api.editCard).toHaveBeenCalledWith("board-1", "card-new", {
      title: "Updated card", details: "", priority: "low", dueDate: null, labels: [], assigneeId: null,
    }));
    expect(await within(backlog).findByText("Updated card")).toBeInTheDocument();

    await userEvent.click(within(backlog).getByRole("button", { name: "Archive Updated card" }));
    await waitFor(() => expect(api.archiveCard).toHaveBeenCalledWith("board-1", "card-new"));
    await waitFor(() => expect(within(backlog).queryByText("Updated card")).not.toBeInTheDocument());
  });

  it("cancels card forms without saving", async () => {
    renderBoard();
    const backlog = await column("col-backlog");
    await userEvent.click(within(backlog).getByRole("button", { name: "Add a card" }));
    await userEvent.click(within(backlog).getByRole("button", { name: "Add card" }));
    await userEvent.click(within(backlog).getByRole("button", { name: "Cancel" }));
    await userEvent.click(within(backlog).getByRole("button", { name: "Edit Align roadmap themes" }));
    await userEvent.click(within(backlog).getByRole("button", { name: "Cancel" }));
    expect(api.addCard).not.toHaveBeenCalled();
    expect(api.editCard).not.toHaveBeenCalled();
    expect(within(backlog).getByText("Align roadmap themes")).toBeInTheDocument();
  });

  it("shows a failed add without inventing a saved card", async () => {
    api.addCard.mockRejectedValue(new Error("Network error"));
    renderBoard();
    const backlog = await column("col-backlog");
    await userEvent.click(within(backlog).getByRole("button", { name: "Add a card" }));
    await userEvent.type(within(backlog).getByPlaceholderText("Card title"), "Unsaved");
    await userEvent.click(within(backlog).getByRole("button", { name: "Add card" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Network error");
    expect(within(backlog).getByPlaceholderText("Card title")).toHaveValue("Unsaved");
    expect(within(backlog).queryByText("Unsaved")).not.toBeInTheDocument();
  });

  it("shows saving until the server confirms a change", async () => {
    let confirm!: (board: BoardData) => void;
    api.addCard.mockReturnValue(new Promise((resolve) => { confirm = resolve; }));
    renderBoard();
    const backlog = await column("col-backlog");
    await userEvent.click(within(backlog).getByRole("button", { name: "Add a card" }));
    await userEvent.type(within(backlog).getByPlaceholderText("Card title"), "Pending card");
    await userEvent.click(within(backlog).getByRole("button", { name: "Add card" }));
    expect(screen.getByText("Saving...")).toBeInTheDocument();
    expect(screen.getByLabelText("New column title")).toBeDisabled();

    await act(async () => confirm(withCard(copyBoard(), 0, "card-pending", "Pending card")));
    expect(await within(backlog).findByText("Pending card")).toBeInTheDocument();
    expect(screen.queryByText("Saving...")).not.toBeInTheDocument();
  });

  it("filters cards by search, priority, and label", async () => {
    renderBoard();
    const search = await screen.findByLabelText("Search cards");
    await userEvent.type(search, "design");
    expect(screen.queryByText("Align roadmap themes")).not.toBeInTheDocument();
    expect(screen.getByText("Design card layout")).toBeInTheDocument();
    expect(within(await column("col-progress")).getByText("1 of 2")).toBeInTheDocument();
    expect(within(await column("col-backlog")).getByText("No matching cards")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Clear filters" }));
    expect(screen.getByText("Align roadmap themes")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Clear filters" })).not.toBeInTheDocument();

    await userEvent.selectOptions(screen.getByLabelText("Filter by priority"), "low");
    expect(screen.getByText("Refine status language")).toBeInTheDocument();
    expect(screen.queryByText("Design card layout")).not.toBeInTheDocument();
    await userEvent.selectOptions(screen.getByLabelText("Filter by priority"), "");
    await userEvent.selectOptions(screen.getByLabelText("Filter by label"), "qa");
    expect(screen.getByText("QA micro-interactions")).toBeInTheDocument();
    expect(screen.queryByText("Ship marketing page")).not.toBeInTheDocument();
  });

  it("applies the authoritative AI board and scopes chat to the board", async () => {
    const next = withCard(copyBoard(), 0, "card-ai", "AI card");
    vi.mocked(sendChat).mockResolvedValue({ text: "Added a card.", board: next });
    const { onBoardChanged } = renderBoard();
    await screen.findByLabelText("Board name");
    await userEvent.click(screen.getByRole("button", { name: "AI chat" }));
    await userEvent.type(screen.getByLabelText("Message"), "Add a card");
    await userEvent.click(screen.getByRole("button", { name: "Send message" }));
    expect(await screen.findByText("AI card")).toBeInTheDocument();
    expect(sendChat).toHaveBeenCalledWith("board-1", "Add a card", []);
    expect(onBoardChanged).toHaveBeenCalledWith(next);
    expect(screen.getByLabelText("Conversation")).toHaveTextContent("Added a card.");
  });

  it("assigns cards to members and filters by assignee", async () => {
    const assigned = structuredClone(initialData);
    assigned.cards["card-1"].assigneeId = "user-1";
    api.editCard.mockResolvedValue(assigned);
    renderBoard();
    const backlog = await column("col-backlog");
    expect(within(backlog).getByText("@bob")).toBeInTheDocument();

    await userEvent.click(within(backlog).getByRole("button", { name: "Edit Align roadmap themes" }));
    const card = within(backlog).getByTestId("card-card-1");
    await userEvent.selectOptions(within(card).getByLabelText("Assignee"), "user");
    await userEvent.click(within(card).getByRole("button", { name: "Save card" }));
    await waitFor(() => expect(api.editCard).toHaveBeenCalledWith("board-1", "card-1",
      expect.objectContaining({ assigneeId: "user-1" })));
    expect(await within(backlog).findByText("@user")).toBeInTheDocument();

    await userEvent.selectOptions(screen.getByLabelText("Filter by assignee"), "user-2");
    expect(screen.getByText("Gather customer signals")).toBeInTheDocument();
    expect(screen.queryByText("Align roadmap themes")).not.toBeInTheDocument();
    await userEvent.selectOptions(screen.getByLabelText("Filter by assignee"), "none");
    expect(screen.queryByText("Gather customer signals")).not.toBeInTheDocument();
    expect(screen.getByText("Prototype analytics view")).toBeInTheDocument();
  });

  it("lets the owner share, change roles, and remove members", async () => {
    const shared = structuredClone(initialData);
    shared.members.push({ id: "user-3", username: "carol", role: "viewer" });
    api.shareBoard.mockResolvedValue(shared);
    api.removeMember.mockResolvedValue(copyBoard());
    renderBoard();
    await userEvent.click(await screen.findByRole("button", { name: "Members (2)" }));
    const panel = screen.getByRole("region", { name: "Board members" });
    expect(within(panel).getByText("owner")).toBeInTheDocument();

    await userEvent.type(within(panel).getByLabelText("Share with username"), " carol ");
    await userEvent.selectOptions(within(panel).getByLabelText("New member role"), "viewer");
    await userEvent.click(within(panel).getByRole("button", { name: "Share" }));
    await waitFor(() => expect(api.shareBoard).toHaveBeenCalledWith("board-1", "carol", "viewer"));
    expect(await screen.findByRole("button", { name: "Members (3)" })).toBeInTheDocument();
    expect(within(panel).getByLabelText("Share with username")).toHaveValue("");

    await userEvent.selectOptions(within(panel).getByLabelText("Role for bob"), "viewer");
    await waitFor(() => expect(api.shareBoard).toHaveBeenLastCalledWith("board-1", "bob", "viewer"));
    await userEvent.click(within(panel).getByRole("button", { name: "Remove carol" }));
    await waitFor(() => expect(api.removeMember).toHaveBeenCalledWith("board-1", "user-3"));
    expect(await screen.findByRole("button", { name: "Members (2)" })).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Members (2)" }));
    expect(screen.queryByRole("region", { name: "Board members" })).not.toBeInTheDocument();
  });

  it("shows a read-only board to viewers and lets them leave", async () => {
    const viewing: BoardData = { ...copyBoard(), role: "viewer" };
    api.getBoard.mockResolvedValue(viewing);
    const remaining = [{ id: "own", name: "Mine", createdAt: "", cardCount: 0, role: "owner" as const, owner: "me" }];
    api.leaveBoard.mockRejectedValueOnce(new Error("Offline")).mockResolvedValue(remaining);
    vi.spyOn(window, "confirm").mockReturnValueOnce(false).mockReturnValue(true);
    const { onLeft } = renderBoard();

    expect(await screen.findByText("View only")).toBeInTheDocument();
    expect(screen.getByLabelText("Board name")).toHaveAttribute("readonly");
    expect(screen.queryByRole("button", { name: "Add a card" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Edit / })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Drag / })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Delete column/ })).not.toBeInTheDocument();
    expect(screen.queryByLabelText("New column title")).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Members (2)" }));
    const panel = screen.getByRole("region", { name: "Board members" });
    expect(within(panel).queryByLabelText("Share with username")).not.toBeInTheDocument();
    await userEvent.click(within(panel).getByRole("button", { name: "Leave board" }));
    expect(api.leaveBoard).not.toHaveBeenCalled();
    await userEvent.click(within(panel).getByRole("button", { name: "Leave board" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Offline");
    await userEvent.click(within(panel).getByRole("button", { name: "Leave board" }));
    await waitFor(() => expect(onLeft).toHaveBeenCalledWith(remaining));
  });

  it("labels editor access and reports an expired session when leaving", async () => {
    api.getBoard.mockResolvedValue({ ...copyBoard(), role: "editor" });
    api.leaveBoard.mockRejectedValue(new ApiError("Not signed in", 401));
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const { onSessionExpired } = renderBoard();
    expect(await screen.findByText("Shared with you as editor")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Add column" })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Members (2)" }));
    await userEvent.click(screen.getByRole("button", { name: "Leave board" }));
    await waitFor(() => expect(onSessionExpired).toHaveBeenCalledOnce());
  });

  it("opens card details, updates the comment count, and shows the activity feed", async () => {
    vi.mocked(activityApi.addComment).mockResolvedValue([
      { id: "m1", userId: "user-1", username: "user", body: "First!", createdAt: "2026-11-05T10:00:00+00:00" },
    ]);
    vi.mocked(activityApi.listActivity).mockResolvedValue([
      { id: 1, cardId: null, username: "bob", action: "add_column", summary: 'added column "QA"', source: "ai", createdAt: "2026-11-05T10:00:00+00:00" },
    ]);
    renderBoard();
    const discovery = await column("col-discovery");
    expect(within(discovery).getByText("2 comments")).toBeInTheDocument();

    await userEvent.click(within(await column("col-backlog")).getByRole("button", { name: "Open Align roadmap themes" }));
    const dialog = screen.getByRole("dialog", { name: "Card Align roadmap themes" });
    expect(await within(dialog).findByText("No comments yet.")).toBeInTheDocument();
    await userEvent.type(within(dialog).getByLabelText("New comment"), "First!");
    await userEvent.click(within(dialog).getByRole("button", { name: "Add comment" }));
    expect(await within(dialog).findByText("First!")).toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole("button", { name: "Close" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(within(await column("col-backlog")).getByText("1 comment")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Activity" }));
    const feed = screen.getByRole("region", { name: "Board activity" });
    expect(await within(feed).findByText('bob added column "QA" (via AI)')).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Activity" }));
    expect(screen.queryByRole("region", { name: "Board activity" })).not.toBeInTheDocument();
  });

  it("updates checklists from the card dialog and shows progress on the card", async () => {
    const checked = copyBoard();
    checked.cards["card-3"].checklist[1].done = true;
    api.editChecklistItem.mockResolvedValueOnce(checked).mockRejectedValueOnce(new Error("Checklist failed"));
    renderBoard();
    const discovery = await column("col-discovery");
    expect(within(discovery).getByText("1 card")).toBeInTheDocument();
    expect(within(discovery).getByLabelText("Checklist 1 of 2 done")).toHaveTextContent("1/2");

    await userEvent.click(within(discovery).getByRole("button", { name: "Open Prototype analytics view" }));
    const dialog = screen.getByRole("dialog", { name: "Card Prototype analytics view" });
    await userEvent.click(within(dialog).getByRole("checkbox", { name: "Sketch layout" }));
    expect(api.editChecklistItem).toHaveBeenCalledWith("board-1", "card-3", "item-2", { done: true });
    expect(await within(dialog).findByText("2/2 done")).toBeInTheDocument();
    expect(within(discovery).getByLabelText("Checklist 2 of 2 done")).toBeInTheDocument();

    await userEvent.click(within(dialog).getByRole("checkbox", { name: "Pick metrics" }));
    expect(await within(dialog).findByRole("alert")).toHaveTextContent("Checklist failed");
    expect(within(dialog).getByRole("checkbox", { name: "Pick metrics" })).toBeChecked();
  });

  it("opens the requested card once the board loads", async () => {
    renderBoard({ initialCardId: "card-3" });
    expect(await screen.findByRole("dialog", { name: "Card Prototype analytics view" })).toBeInTheDocument();
  });

  it("restores archived cards from the archive panel", async () => {
    api.listArchived.mockResolvedValue([{ id: "card-old", title: "Old card", column: "Backlog", archivedAt: "2026-11-05T10:00:00+00:00" }]);
    api.restoreCard.mockResolvedValue(withCard(copyBoard(), 0, "card-old", "Old card"));
    renderBoard();
    await userEvent.click(await screen.findByRole("button", { name: "Archived" }));
    const panel = screen.getByRole("region", { name: "Archived cards" });
    await userEvent.click(await within(panel).findByRole("button", { name: "Restore Old card" }));
    expect(api.restoreCard).toHaveBeenCalledWith("board-1", "card-old");
    expect(await within(await column("col-backlog")).findByText("Old card")).toBeInTheDocument();
    await waitFor(() => expect(api.listArchived).toHaveBeenCalledTimes(2));
    await userEvent.click(screen.getByRole("button", { name: "Archived" }));
    expect(screen.queryByRole("region", { name: "Archived cards" })).not.toBeInTheDocument();
  });

  it("lets viewers open cards", async () => {
    api.getBoard.mockResolvedValue({ ...copyBoard(), role: "viewer" });
    renderBoard();
    await userEvent.click(await screen.findByRole("button", { name: "Open Align roadmap themes" }));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });
});
