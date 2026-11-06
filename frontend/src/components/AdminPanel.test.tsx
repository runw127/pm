import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AdminPanel } from "@/components/AdminPanel";
import { ApiError } from "@/lib/api";
import * as accountApi from "@/lib/account-api";

vi.mock("@/lib/account-api");
const api = vi.mocked(accountApi);

const users = [
  { id: "admin", username: "user", isAdmin: true, createdAt: "2026-01-01T00:00:00+00:00", boardCount: 2 },
  { id: "u2", username: "bob", isAdmin: false, createdAt: "2026-02-03T00:00:00+00:00", boardCount: 1 },
];

const renderPanel = () => {
  const onSessionExpired = vi.fn();
  render(<AdminPanel currentUserId="admin" onSessionExpired={onSessionExpired} />);
  return { onSessionExpired };
};

const row = (name: string) => screen.getByRole("cell", { name: new RegExp(`^${name}`) }).closest("tr")!;

beforeEach(() => {
  vi.resetAllMocks();
  api.listUsers.mockResolvedValue(users);
});

describe("AdminPanel", () => {
  it("lists users with roles, boards, and join dates", async () => {
    renderPanel();
    expect(screen.getByText("Loading users...")).toBeInTheDocument();
    await screen.findByText("bob");
    expect(within(row("user")).getByText("(you)")).toBeInTheDocument();
    expect(row("bob")).toHaveTextContent("Member");
    expect(row("bob")).toHaveTextContent("2026-02-03");
    expect(within(row("user")).queryByRole("button", { name: /Delete/ })).not.toBeInTheDocument();
  });

  it("changes roles and reports errors", async () => {
    api.setAdmin.mockResolvedValueOnce([users[0], { ...users[1], isAdmin: true }])
      .mockRejectedValueOnce(new ApiError("At least one admin is required", 422));
    renderPanel();
    await userEvent.click(await screen.findByRole("button", { name: "Make bob admin" }));
    expect(api.setAdmin).toHaveBeenCalledWith("u2", true);
    expect(await screen.findByRole("button", { name: "Revoke admin for bob" })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Revoke admin for user" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("At least one admin is required");
  });

  it("resets a password", async () => {
    api.resetPassword.mockResolvedValue(undefined);
    renderPanel();
    await userEvent.click(await screen.findByRole("button", { name: "Reset password for bob" }));
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByLabelText("New password for bob")).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Reset password for bob" }));
    await userEvent.type(screen.getByLabelText("New password for bob"), "fresh-pass");
    await userEvent.click(screen.getByRole("button", { name: "Save password" }));
    expect(await screen.findByRole("status")).toHaveTextContent("Password reset for bob.");
    expect(api.resetPassword).toHaveBeenCalledWith("u2", "fresh-pass");
  });

  it("deletes a user after confirmation", async () => {
    vi.spyOn(window, "confirm").mockReturnValueOnce(false).mockReturnValue(true);
    api.removeUser.mockResolvedValue([users[0]]);
    renderPanel();
    await userEvent.click(await screen.findByRole("button", { name: "Delete bob" }));
    expect(api.removeUser).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: "Delete bob" }));
    await waitFor(() => expect(screen.queryByText("bob")).not.toBeInTheDocument());
  });

  it("reports session expiry", async () => {
    api.listUsers.mockRejectedValue(new ApiError("Not signed in", 401));
    const { onSessionExpired } = renderPanel();
    await waitFor(() => expect(onSessionExpired).toHaveBeenCalledOnce());
  });
});
