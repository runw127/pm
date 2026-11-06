import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AccountSettings } from "@/components/AccountSettings";
import { ApiError } from "@/lib/api";
import * as accountApi from "@/lib/account-api";

vi.mock("@/lib/account-api");
const api = vi.mocked(accountApi);

const renderSettings = () => {
  const props = { onSessionExpired: vi.fn(), onDeleted: vi.fn() };
  render(<AccountSettings user={{ id: "u1", username: "alice", isAdmin: false }} {...props} />);
  return props;
};

beforeEach(() => vi.resetAllMocks());

describe("AccountSettings", () => {
  it("changes the password and reports errors", async () => {
    api.changePassword.mockRejectedValueOnce(new ApiError("Current password is incorrect", 403)).mockResolvedValueOnce(undefined);
    renderSettings();
    expect(screen.getByText(/alice/)).toHaveTextContent("Member");
    await userEvent.type(screen.getByLabelText("Current password"), "old-password");
    await userEvent.type(screen.getByLabelText("New password"), "new-password");
    await userEvent.click(screen.getByRole("button", { name: "Update password" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Current password is incorrect");
    await userEvent.click(screen.getByRole("button", { name: "Update password" }));
    expect(await screen.findByRole("status")).toHaveTextContent("Password updated.");
    expect(api.changePassword).toHaveBeenLastCalledWith("old-password", "new-password");
    expect(screen.getByLabelText("Current password")).toHaveValue("");
  });

  it("deletes the account only after confirmation", async () => {
    vi.spyOn(window, "confirm").mockReturnValueOnce(false).mockReturnValue(true);
    api.deleteAccount.mockResolvedValue(undefined);
    const { onDeleted } = renderSettings();
    await userEvent.type(screen.getByLabelText("Confirm with your password"), "password1");
    await userEvent.click(screen.getByRole("button", { name: "Delete my account" }));
    expect(api.deleteAccount).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: "Delete my account" }));
    await waitFor(() => expect(onDeleted).toHaveBeenCalledOnce());
    expect(api.deleteAccount).toHaveBeenCalledWith("password1");
  });

  it("reports session expiry", async () => {
    api.changePassword.mockRejectedValue(new ApiError("Not signed in", 401));
    const { onSessionExpired } = renderSettings();
    await userEvent.type(screen.getByLabelText("Current password"), "old-password");
    await userEvent.type(screen.getByLabelText("New password"), "new-password");
    await userEvent.click(screen.getByRole("button", { name: "Update password" }));
    await waitFor(() => expect(onSessionExpired).toHaveBeenCalledOnce());
  });
});
