import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ACTIVE_BOARD_KEY, Workspace } from "@/components/Workspace";
import { ApiError } from "@/lib/api";
import * as boardApi from "@/lib/board-api";
import { initialData, type BoardData, type BoardSummary } from "@/lib/kanban";

vi.mock("@/lib/board-api");
vi.mock("@/components/KanbanBoard", () => ({
  KanbanBoard: ({ boardId, initialCardId, onBoardChanged, onLeft }: {
    boardId: string; initialCardId?: string; onBoardChanged: (board: BoardData) => void; onLeft: (boards: BoardSummary[]) => void;
  }) => (
    <div>
      <p>Showing {boardId}</p>
      {initialCardId && <p>Opening {initialCardId}</p>}
      <button type="button" onClick={() => onLeft([{ id: "b9", name: "Left", createdAt: "", cardCount: 0, role: "owner", owner: "alice" }])}>
        Leave
      </button>
      <button type="button" onClick={() => onBoardChanged({ ...initialData, id: boardId, name: "Renamed" })}>
        Change board
      </button>
    </div>
  ),
}));
vi.mock("@/components/AccountSettings", () => ({ AccountSettings: () => <p>Account settings view</p> }));
vi.mock("@/components/AdminPanel", () => ({ AdminPanel: () => <p>Admin view</p> }));
vi.mock("@/components/MyWork", () => ({
  MyWork: ({ onOpen }: { onOpen: (boardId: string, cardId: string) => void }) => (
    <button type="button" onClick={() => onOpen("b2", "card-9")}>Open work item</button>
  ),
}));

const api = vi.mocked(boardApi);
const summaries: BoardSummary[] = [
  { id: "b1", name: "First", createdAt: "", cardCount: 1, role: "owner", owner: "alice" },
  { id: "b2", name: "Second", createdAt: "", cardCount: 0, role: "owner", owner: "alice" },
];
const sharedBoard: BoardSummary = { id: "s1", name: "Team plan", createdAt: "", cardCount: 3, role: "viewer", owner: "carol" };
const member = { id: "u1", username: "alice", isAdmin: false };

const renderWorkspace = (user = member) => {
  const props = { onLogout: vi.fn(), onSessionExpired: vi.fn(), onAccountDeleted: vi.fn() };
  render(<Workspace user={user} {...props} />);
  return props;
};

const picker = () => screen.getByRole("combobox", { name: "Board" });
const optionNames = () => within(picker()).getAllByRole("option").map((option) => option.textContent);

beforeEach(() => {
  vi.resetAllMocks();
  localStorage.clear();
  api.listBoards.mockResolvedValue(summaries);
});

describe("Workspace", () => {
  it("lists boards and opens the first or remembered board", async () => {
    renderWorkspace();
    expect(await screen.findByText("Showing b1")).toBeInTheDocument();
    expect(screen.getByText("Signed in as alice")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Users" })).not.toBeInTheDocument();

    expect(optionNames()).toEqual(["First (1)", "Second (0)"]);
    await userEvent.selectOptions(picker(), "b2");
    expect(screen.getByText("Showing b2")).toBeInTheDocument();
    expect(localStorage.getItem(ACTIVE_BOARD_KEY)).toBe("b2");
  });

  it("restores the remembered board and ignores stale ids", async () => {
    localStorage.setItem(ACTIVE_BOARD_KEY, "b2");
    const { unmount } = render(<Workspace user={member} onLogout={vi.fn()} onSessionExpired={vi.fn()} onAccountDeleted={vi.fn()} />);
    expect(await screen.findByText("Showing b2")).toBeInTheDocument();
    unmount();
    localStorage.setItem(ACTIVE_BOARD_KEY, "gone");
    renderWorkspace();
    expect(await screen.findByText("Showing b1")).toBeInTheDocument();
  });

  it("creates a board and switches to it", async () => {
    api.createBoard.mockResolvedValue({ ...initialData, id: "b3", name: "Launch" });
    renderWorkspace();
    await screen.findByText("Showing b1");
    await userEvent.type(screen.getByLabelText("New board name"), "  Launch ");
    await userEvent.click(screen.getByRole("button", { name: "Create board" }));
    expect(api.createBoard).toHaveBeenCalledWith("Launch");
    expect(await screen.findByText("Showing b3")).toBeInTheDocument();
    expect(picker()).toHaveValue("b3");
    expect(screen.getByLabelText("New board name")).toHaveValue("");
  });

  it("deletes a board after confirmation", async () => {
    api.deleteBoard.mockResolvedValue([summaries[1]]);
    vi.spyOn(window, "confirm").mockReturnValueOnce(false).mockReturnValue(true);
    renderWorkspace();
    await screen.findByText("Showing b1");
    await userEvent.click(screen.getByRole("button", { name: "Delete board First" }));
    expect(api.deleteBoard).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: "Delete board First" }));
    expect(await screen.findByText("Showing b2")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Delete board/ })).not.toBeInTheDocument();
  });

  it("shows board errors and session expiry", async () => {
    api.createBoard.mockRejectedValueOnce(new ApiError("Board name cannot be empty", 422))
      .mockRejectedValueOnce(new ApiError("Not signed in", 401));
    const { onSessionExpired } = renderWorkspace();
    await screen.findByText("Showing b1");
    await userEvent.type(screen.getByLabelText("New board name"), "X");
    await userEvent.click(screen.getByRole("button", { name: "Create board" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Board name cannot be empty");
    await userEvent.click(screen.getByRole("button", { name: "Create board" }));
    await waitFor(() => expect(onSessionExpired).toHaveBeenCalledOnce());
  });

  it("reports a failed board listing", async () => {
    api.listBoards.mockRejectedValue(new Error("Offline"));
    renderWorkspace();
    expect(await screen.findByRole("alert")).toHaveTextContent("Offline");
  });

  it("updates the list when the open board changes", async () => {
    renderWorkspace();
    await userEvent.click(await screen.findByRole("button", { name: "Change board" }));
    expect(optionNames()).toContain("Renamed (8)");
  });

  it("navigates to account and admin views and logs out", async () => {
    const { onLogout } = renderWorkspace({ ...member, isAdmin: true });
    await screen.findByText("Showing b1");
    await userEvent.click(screen.getByRole("button", { name: "Account" }));
    expect(screen.getByText("Account settings view")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Users" }));
    expect(screen.getByText("Admin view")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Boards" }));
    expect(screen.getByText("Showing b1")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Log out" }));
    expect(onLogout).toHaveBeenCalledOnce();
  });

  it("opens a card from My work on its board", async () => {
    renderWorkspace();
    await screen.findByText("Showing b1");
    await userEvent.click(screen.getByRole("button", { name: "My work" }));
    expect(screen.queryByText("Showing b1")).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Open work item" }));
    expect(screen.getByText("Showing b2")).toBeInTheDocument();
    expect(screen.getByText("Opening card-9")).toBeInTheDocument();
    expect(localStorage.getItem(ACTIVE_BOARD_KEY)).toBe("b2");
  });

  it("groups shared boards with their owner and role, without delete", async () => {
    api.listBoards.mockResolvedValue([summaries[0], sharedBoard]);
    renderWorkspace();
    await screen.findByText("Showing b1");
    expect(within(picker()).getByRole("group", { name: "Shared with you" })).toHaveTextContent("Team plan - carol, viewer (3)");
    expect(screen.queryByRole("button", { name: "Delete board First" })).not.toBeInTheDocument();
    await userEvent.selectOptions(picker(), "s1");
    expect(screen.getByText("Showing s1")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Delete board/ })).not.toBeInTheDocument();
  });

  it("creates new boards among owned boards and handles leaving", async () => {
    api.listBoards.mockResolvedValue([summaries[0], sharedBoard]);
    api.createBoard.mockResolvedValue({ ...initialData, id: "b3", name: "Launch" });
    renderWorkspace();
    await screen.findByText("Showing b1");
    await userEvent.type(screen.getByLabelText("New board name"), "Launch");
    await userEvent.click(screen.getByRole("button", { name: "Create board" }));
    await screen.findByText("Showing b3");
    expect(optionNames()).toEqual(["First (1)", "Launch (0)", "Team plan - carol, viewer (3)"]);

    await userEvent.click(screen.getByRole("button", { name: "Leave" }));
    expect(screen.getByText("Showing b9")).toBeInTheDocument();
  });
});
