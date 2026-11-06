import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { CardDetail } from "@/components/CardDetail";
import { ApiError } from "@/lib/api";
import * as activityApi from "@/lib/activity-api";
import { initialData, type BoardData } from "@/lib/kanban";

vi.mock("@/lib/activity-api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/activity-api")>()),
  listActivity: vi.fn(), listComments: vi.fn(), addComment: vi.fn(), deleteComment: vi.fn(),
}));
const api = vi.mocked(activityApi);

const mine = { id: "m1", userId: "user-1", username: "user", body: "My note", createdAt: "2026-11-05T10:00:00+00:00" };
const theirs = { id: "m2", userId: "user-2", username: "bob", body: "Bob note", createdAt: "2026-11-05T11:00:00+00:00" };
const gone = { id: "m3", userId: null, username: null, body: "Orphan", createdAt: "2026-11-05T12:00:00+00:00" };

const renderDetail = (board: BoardData = structuredClone(initialData), currentUserId = "user-1") => {
  const props = { onClose: vi.fn(), onCommentCount: vi.fn(), onSave: vi.fn(), onSessionExpired: vi.fn() };
  render(<CardDetail board={board} cardId="card-2" currentUserId={currentUserId} {...props} />);
  return { ...props, dialog: screen.getByRole("dialog", { name: "Card Gather customer signals" }) };
};

beforeEach(() => {
  vi.resetAllMocks();
  api.listComments.mockResolvedValue([mine, theirs, gone]);
  api.listActivity.mockResolvedValue([
    { id: 2, cardId: "card-2", username: "bob", action: "edit_card", summary: 'edited card "Gather customer signals"', source: "user", createdAt: "2026-11-05T09:00:00+00:00" },
  ]);
});

describe("CardDetail", () => {
  it("shows card fields, comments, and history", async () => {
    const { dialog } = renderDetail();
    expect(within(dialog).getByText("Backlog")).toBeInTheDocument();
    expect(within(dialog).getByText("@bob")).toBeInTheDocument();
    expect(within(dialog).getByText("Loading comments...")).toBeInTheDocument();
    expect(await within(dialog).findByText("Bob note")).toBeInTheDocument();
    expect(within(dialog).getByText("Deleted user")).toBeInTheDocument();
    expect(within(dialog).getByText(/bob edited card "Gather customer signals"/)).toBeInTheDocument();
    expect(api.listComments).toHaveBeenCalledWith("board-1", "card-2");
    expect(api.listActivity).toHaveBeenCalledWith("board-1", "card-2");
  });

  it("lets members delete only their own comments, and owners any", async () => {
    const member = { ...structuredClone(initialData), role: "editor" as const };
    const { dialog } = renderDetail(member);
    await within(dialog).findByText("Bob note");
    expect(within(dialog).getAllByRole("button", { name: /Delete comment/ })).toHaveLength(1);
    document.body.innerHTML = "";
    const owner = renderDetail();
    await within(owner.dialog).findByText("Bob note");
    expect(within(owner.dialog).getAllByRole("button", { name: /Delete comment/ })).toHaveLength(3);
  });

  it("adds and deletes comments and reports the new count", async () => {
    api.addComment.mockResolvedValue([mine, theirs, gone, { ...mine, id: "m4", body: "New one" }]);
    api.deleteComment.mockResolvedValue([theirs, gone]);
    const { dialog, onCommentCount } = renderDetail();
    await within(dialog).findByText("Bob note");
    const add = within(dialog).getByRole("button", { name: "Add comment" });
    expect(add).toBeDisabled();
    await userEvent.type(within(dialog).getByLabelText("New comment"), "  New one ");
    await userEvent.click(add);
    expect(api.addComment).toHaveBeenCalledWith("board-1", "card-2", "New one");
    expect(await within(dialog).findByText("New one")).toBeInTheDocument();
    expect(onCommentCount).toHaveBeenLastCalledWith("card-2", 4);
    expect(within(dialog).getByLabelText("New comment")).toHaveValue("");

    await userEvent.click(within(dialog).getByRole("button", { name: "Delete comment My note" }));
    expect(api.deleteComment).toHaveBeenCalledWith("board-1", "card-2", "m1");
    await waitFor(() => expect(onCommentCount).toHaveBeenLastCalledWith("card-2", 2));
  });

  it("reports errors and keeps the draft", async () => {
    api.addComment.mockRejectedValue(new ApiError("Comment cannot be empty", 422));
    const { dialog, onCommentCount } = renderDetail();
    await within(dialog).findByText("Bob note");
    await userEvent.type(within(dialog).getByLabelText("New comment"), "Hi");
    await userEvent.click(within(dialog).getByRole("button", { name: "Add comment" }));
    expect(await within(dialog).findByRole("alert")).toHaveTextContent("Comment cannot be empty");
    expect(within(dialog).getByLabelText("New comment")).toHaveValue("Hi");
    expect(onCommentCount).not.toHaveBeenCalled();
  });

  it("handles load failures and session expiry", async () => {
    api.listComments.mockRejectedValueOnce(new Error("Offline"));
    const first = renderDetail();
    expect(await within(first.dialog).findByRole("alert")).toHaveTextContent("Offline");
    document.body.innerHTML = "";
    api.listComments.mockRejectedValueOnce(new ApiError("Not signed in", 401));
    const second = renderDetail();
    await waitFor(() => expect(second.onSessionExpired).toHaveBeenCalledOnce());
  });

  it("closes from the button, the backdrop, or Escape", async () => {
    const { dialog, onClose } = renderDetail();
    await within(dialog).findByText("Bob note");
    fireEvent.keyDown(document.body, { key: "Enter" });
    fireEvent.keyDown(document.body, { key: "Escape" });
    fireEvent.click(dialog);
    expect(onClose).toHaveBeenCalledTimes(1);
    fireEvent.click(dialog.parentElement!);
    await userEvent.click(within(dialog).getByRole("button", { name: "Close" }));
    expect(onClose).toHaveBeenCalledTimes(3);
  });

  it("shows the card checklist read-only for viewers and the board save error", async () => {
    const board = { ...structuredClone(initialData), role: "viewer" as const };
    render(
      <CardDetail board={board} cardId="card-3" currentUserId="u" saveError="Save failed"
        onClose={vi.fn()} onCommentCount={vi.fn()} onSave={vi.fn()} onSessionExpired={vi.fn()} />
    );
    const dialog = screen.getByRole("dialog", { name: "Card Prototype analytics view" });
    expect(within(dialog).getByRole("checkbox", { name: "Pick metrics" })).toBeDisabled();
    expect(within(dialog).queryByLabelText("New checklist item")).not.toBeInTheDocument();
    expect(within(dialog).getByRole("alert")).toHaveTextContent("Save failed");
    await waitFor(() => expect(api.listComments).toHaveBeenCalled());
  });

  it("reloads history, but not comments, when the card changes", async () => {
    const board = structuredClone(initialData);
    const props = { currentUserId: "user-1", onClose: vi.fn(), onCommentCount: vi.fn(), onSave: vi.fn(), onSessionExpired: vi.fn() };
    const { rerender } = render(<CardDetail board={board} cardId="card-2" {...props} />);
    await waitFor(() => expect(api.listActivity).toHaveBeenCalledTimes(1));
    const edited = structuredClone(board);
    edited.cards["card-2"].title = "Renamed";
    rerender(<CardDetail board={edited} cardId="card-2" {...props} />);
    await waitFor(() => expect(api.listActivity).toHaveBeenCalledTimes(2));
    expect(api.listComments).toHaveBeenCalledTimes(1);
  });

  it("renders nothing for a missing card", async () => {
    const board = structuredClone(initialData);
    delete board.cards["card-2"];
    const { container } = render(
      <CardDetail board={board} cardId="card-2" currentUserId="u" onClose={vi.fn()} onCommentCount={vi.fn()} onSave={vi.fn()} onSessionExpired={vi.fn()} />
    );
    expect(container).toBeEmptyDOMElement();
    await waitFor(() => expect(api.listActivity).toHaveBeenCalled());
  });
});
