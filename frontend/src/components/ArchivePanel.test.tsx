import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ArchivePanel } from "@/components/ArchivePanel";
import { ApiError } from "@/lib/api";
import * as boardApi from "@/lib/board-api";

vi.mock("@/lib/board-api", () => ({ listArchived: vi.fn(), restoreCard: vi.fn(), deleteCard: vi.fn() }));
const api = vi.mocked(boardApi);

const archived = [
  { id: "c1", title: "Old plan", column: "Backlog", archivedAt: "2026-11-05T10:00:00.123456+00:00" },
  { id: "c2", title: "Stale idea", column: "Done", archivedAt: "2026-11-04T10:00:00+00:00" },
];

const renderPanel = (readOnly = false, version: unknown = 1) => {
  const props = { onSave: vi.fn(async (change: () => Promise<unknown>) => { await change(); return true; }), onSessionExpired: vi.fn() };
  const view = render(<ArchivePanel boardId="b1" version={version} readOnly={readOnly} disabled={false} {...props} />);
  return { ...props, view };
};

beforeEach(() => {
  vi.resetAllMocks();
  api.listArchived.mockResolvedValue(archived);
});

describe("ArchivePanel", () => {
  it("lists archived cards and restores them", async () => {
    const { onSave } = renderPanel();
    expect(screen.getByText("Loading archived cards...")).toBeInTheDocument();
    expect(await screen.findByText("Old plan")).toBeInTheDocument();
    expect(screen.getByText(/Done · archived/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Restore Old plan" }));
    expect(onSave).toHaveBeenCalledOnce();
    expect(api.restoreCard).toHaveBeenCalledWith("b1", "c1");
  });

  it("deletes permanently only after confirmation", async () => {
    vi.spyOn(window, "confirm").mockReturnValueOnce(false).mockReturnValueOnce(true);
    renderPanel();
    const button = await screen.findByRole("button", { name: "Delete Stale idea permanently" });
    await userEvent.click(button);
    expect(api.deleteCard).not.toHaveBeenCalled();
    await userEvent.click(button);
    expect(api.deleteCard).toHaveBeenCalledWith("b1", "c2");
  });

  it("is read-only for viewers and refreshes when the board changes", async () => {
    const { view } = renderPanel(true);
    expect(await screen.findByText("Old plan")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Restore|Delete/ })).not.toBeInTheDocument();
    api.listArchived.mockResolvedValue([]);
    view.rerender(<ArchivePanel boardId="b1" version={2} readOnly disabled={false} onSave={vi.fn()} onSessionExpired={vi.fn()} />);
    expect(await screen.findByText("No archived cards.")).toBeInTheDocument();
  });

  it("reports load errors and session expiry", async () => {
    api.listArchived.mockRejectedValueOnce(new Error("Offline")).mockRejectedValueOnce(new ApiError("Not signed in", 401));
    const first = renderPanel();
    expect(await screen.findByRole("alert")).toHaveTextContent("Offline");
    first.view.unmount();
    const { onSessionExpired } = renderPanel();
    await waitFor(() => expect(onSessionExpired).toHaveBeenCalledOnce());
  });
});
