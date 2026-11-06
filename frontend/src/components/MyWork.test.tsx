import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MyWork } from "@/components/MyWork";
import { ApiError } from "@/lib/api";
import * as workApi from "@/lib/work-api";
import type { WorkItem } from "@/lib/work-api";

vi.mock("@/lib/work-api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/work-api")>()),
  listMyWork: vi.fn(),
}));
const api = vi.mocked(workApi);

const item = (title: string, fields: Partial<WorkItem> = {}): WorkItem => ({
  boardId: "b1", boardName: "Launch", cardId: `card-${title}`, title, column: "Backlog", priority: "medium",
  dueDate: null, labels: [], checklistDone: 0, checklistTotal: 0, ...fields,
});

const renderWork = () => {
  const props = { onOpen: vi.fn(), onSessionExpired: vi.fn() };
  render(<MyWork {...props} />);
  return props;
};

beforeEach(() => vi.resetAllMocks());

describe("MyWork", () => {
  it("groups assigned cards by due date and opens them", async () => {
    api.listMyWork.mockResolvedValue([
      item("Late", { dueDate: "2000-01-01", priority: "high", labels: ["qa"], checklistDone: 1, checklistTotal: 3 }),
      item("Future", { dueDate: "2099-01-01", boardId: "b2", boardName: "Team", column: "Review" }),
      item("Someday"),
    ]);
    const { onOpen } = renderWork();
    const overdue = await screen.findByRole("region", { name: "Overdue" });
    expect(within(overdue).getByRole("heading")).toHaveTextContent("Overdue (1)");
    const late = within(overdue).getByRole("button", { name: /Late/ });
    expect(late).toHaveTextContent("Launch · Backlog");
    expect(late).toHaveTextContent("2000-01-01");
    expect(late).toHaveTextContent("1/3");
    expect(late).toHaveTextContent("#qa");
    expect(within(screen.getByRole("region", { name: "Upcoming" })).getByText("Team · Review")).toBeInTheDocument();
    expect(within(screen.getByRole("region", { name: "No due date" })).getByText("Someday")).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Due today" })).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: /Future/ }));
    expect(onOpen).toHaveBeenCalledWith("b2", "card-Future");
  });

  it("shows loading, empty, error, and expiry states", async () => {
    api.listMyWork.mockResolvedValueOnce([]).mockRejectedValueOnce(new Error("Offline"))
      .mockRejectedValueOnce(new ApiError("Not signed in", 401));
    const first = render(<MyWork onOpen={vi.fn()} onSessionExpired={vi.fn()} />);
    expect(screen.getByText("Loading your work...")).toBeInTheDocument();
    expect(await screen.findByText("Nothing is assigned to you right now.")).toBeInTheDocument();
    first.unmount();
    const second = render(<MyWork onOpen={vi.fn()} onSessionExpired={vi.fn()} />);
    expect(await screen.findByRole("alert")).toHaveTextContent("Offline");
    second.unmount();
    const { onSessionExpired } = renderWork();
    await vi.waitFor(() => expect(onSessionExpired).toHaveBeenCalledOnce());
  });
});
