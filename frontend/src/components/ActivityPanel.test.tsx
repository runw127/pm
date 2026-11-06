import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { ActivityPanel } from "@/components/ActivityPanel";
import { ApiError } from "@/lib/api";
import * as activityApi from "@/lib/activity-api";

vi.mock("@/lib/activity-api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/activity-api")>()),
  listActivity: vi.fn(),
}));
const listActivity = vi.mocked(activityApi.listActivity);

beforeEach(() => vi.resetAllMocks());

describe("ActivityPanel", () => {
  it("loads activity and refreshes when the board version changes", async () => {
    listActivity.mockResolvedValueOnce([]).mockResolvedValueOnce([
      { id: 1, cardId: "c1", username: "user", action: "add_card", summary: 'added card "A" to Backlog', source: "user", createdAt: "2026-11-05T10:00:00+00:00" },
    ]);
    const { rerender } = render(<ActivityPanel boardId="b1" version={1} onSessionExpired={vi.fn()} />);
    expect(screen.getByText("Loading activity...")).toBeInTheDocument();
    expect(await screen.findByText("No activity yet.")).toBeInTheDocument();
    rerender(<ActivityPanel boardId="b1" version={2} onSessionExpired={vi.fn()} />);
    expect(await screen.findByText('user added card "A" to Backlog')).toBeInTheDocument();
    expect(listActivity).toHaveBeenCalledTimes(2);
  });

  it("reports errors and session expiry", async () => {
    listActivity.mockRejectedValueOnce(new Error("Offline"));
    const { unmount } = render(<ActivityPanel boardId="b1" version={1} onSessionExpired={vi.fn()} />);
    expect(await screen.findByRole("alert")).toHaveTextContent("Offline");
    unmount();
    const onSessionExpired = vi.fn();
    listActivity.mockRejectedValueOnce(new ApiError("Not signed in", 401));
    render(<ActivityPanel boardId="b1" version={1} onSessionExpired={onSessionExpired} />);
    await waitFor(() => expect(onSessionExpired).toHaveBeenCalledOnce());
  });
});
