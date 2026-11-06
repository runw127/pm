import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AuthGate } from "@/components/AuthGate";
import { ApiError } from "@/lib/api";
import * as accountApi from "@/lib/account-api";
import { chatKey } from "@/lib/ai-api";

vi.mock("@/lib/account-api");
vi.mock("@/components/Workspace", () => ({
  Workspace: (props: { user: { username: string }; onLogout: () => void; onSessionExpired: () => void; onAccountDeleted: () => void }) => (
    <>
      <h1>Workspace for {props.user.username}</h1>
      <button type="button" onClick={props.onLogout}>Log out</button>
      <button type="button" onClick={props.onSessionExpired}>Expire session</button>
      <button type="button" onClick={props.onAccountDeleted}>Delete account</button>
    </>
  ),
}));

const api = vi.mocked(accountApi);
const member = { id: "u1", username: "alice", isAdmin: false };
const unauthorized = () => new ApiError("Not signed in", 401);

beforeEach(() => {
  vi.resetAllMocks();
  sessionStorage.clear();
  api.getSession.mockRejectedValue(unauthorized());
});

describe("AuthGate", () => {
  it("checks the session before showing sign-in", async () => {
    render(<AuthGate />);
    expect(screen.getByText("Checking your session...")).toBeInTheDocument();
    expect(await screen.findByRole("heading", { name: "Sign in" })).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("reports a failed session check", async () => {
    api.getSession.mockRejectedValue(new TypeError("Failed to fetch"));
    render(<AuthGate />);
    expect(await screen.findByRole("alert")).toHaveTextContent("Unable to check your session.");
  });

  it("rejects bad credentials and signs in with valid credentials", async () => {
    api.login.mockRejectedValueOnce(new ApiError("Invalid credentials", 401)).mockResolvedValueOnce(member);
    const user = userEvent.setup();
    render(<AuthGate />);
    await user.type(await screen.findByLabelText("Username"), "alice");
    await user.type(screen.getByLabelText("Password"), "wrong");
    await user.click(screen.getByRole("button", { name: "Sign in" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Incorrect username or password.");

    await user.clear(screen.getByLabelText("Password"));
    await user.type(screen.getByLabelText("Password"), "password");
    await user.click(screen.getByRole("button", { name: "Sign in" }));
    expect(await screen.findByRole("heading", { name: "Workspace for alice" })).toBeInTheDocument();
    expect(api.login).toHaveBeenLastCalledWith("alice", "password");
  });

  it("creates an account and shows validation errors", async () => {
    api.register
      .mockRejectedValueOnce(new ApiError("Username is already taken", 409))
      .mockRejectedValueOnce(new Error("Offline"))
      .mockResolvedValueOnce(member);
    const user = userEvent.setup();
    render(<AuthGate />);
    await user.click(await screen.findByRole("button", { name: "Need an account? Create one" }));
    expect(screen.getByRole("heading", { name: "Create account" })).toBeInTheDocument();
    await user.type(screen.getByLabelText("Username"), "alice");
    await user.type(screen.getByLabelText("Password"), "password1");
    await user.click(screen.getByRole("button", { name: "Create account" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Username is already taken");
    await user.click(screen.getByRole("button", { name: "Create account" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Unable to create your account. Please try again.");
    await user.click(screen.getByRole("button", { name: "Create account" }));
    expect(await screen.findByRole("heading", { name: "Workspace for alice" })).toBeInTheDocument();
    expect(api.register).toHaveBeenLastCalledWith("alice", "password1");

    api.logout.mockResolvedValue(undefined);
    await user.click(screen.getByRole("button", { name: "Log out" }));
    expect(await screen.findByRole("heading", { name: "Sign in" })).toBeInTheDocument();
  });

  it("switches back to sign-in from registration", async () => {
    render(<AuthGate />);
    await userEvent.click(await screen.findByRole("button", { name: "Need an account? Create one" }));
    await userEvent.click(screen.getByRole("button", { name: "Already have an account? Sign in" }));
    expect(screen.getByRole("heading", { name: "Sign in" })).toBeInTheDocument();
  });

  it("returns to sign-in when the session expires and clears chats", async () => {
    api.getSession.mockResolvedValue(member);
    sessionStorage.setItem(chatKey("board-1"), "[]");
    render(<AuthGate />);
    await userEvent.click(await screen.findByRole("button", { name: "Expire session" }));
    expect(await screen.findByRole("heading", { name: "Sign in" })).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent("Your session has expired. Please sign in again.");
    expect(sessionStorage.getItem(chatKey("board-1"))).toBeNull();
  });

  it("returns to sign-in after deleting the account", async () => {
    api.getSession.mockResolvedValue(member);
    render(<AuthGate />);
    await userEvent.click(await screen.findByRole("button", { name: "Delete account" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Your account has been deleted.");
  });

  it("logs out, and reports a failed logout", async () => {
    api.getSession.mockResolvedValue(member);
    api.logout.mockRejectedValueOnce(new Error("Offline")).mockResolvedValueOnce(undefined);
    render(<AuthGate />);
    await userEvent.click(await screen.findByRole("button", { name: "Log out" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Offline");
    await userEvent.click(screen.getByRole("button", { name: "Log out" }));
    expect(await screen.findByRole("heading", { name: "Sign in" })).toBeInTheDocument();
    await waitFor(() => expect(api.logout).toHaveBeenCalledTimes(2));
  });
});
