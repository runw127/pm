import { afterEach, describe, expect, it, vi } from "vitest";
import * as api from "@/lib/account-api";

afterEach(() => vi.unstubAllGlobals());

describe("account API", () => {
  it("sends each account and admin request", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({}) });
    vi.stubGlobal("fetch", fetchMock);

    const calls: [() => Promise<unknown>, string, string, object?][] = [
      [() => api.getSession(), "/api/session", "GET"],
      [() => api.login("user", "pw"), "/api/login", "POST", { username: "user", password: "pw" }],
      [() => api.register("new", "pw"), "/api/register", "POST", { username: "new", password: "pw" }],
      [() => api.logout(), "/api/logout", "POST"],
      [() => api.changePassword("a", "b"), "/api/account/password", "POST", { currentPassword: "a", newPassword: "b" }],
      [() => api.deleteAccount("pw"), "/api/account", "DELETE", { password: "pw" }],
      [() => api.listUsers(), "/api/admin/users", "GET"],
      [() => api.setAdmin("u1", true), "/api/admin/users/u1", "PATCH", { isAdmin: true }],
      [() => api.resetPassword("u1", "newpass1"), "/api/admin/users/u1/password", "POST", { password: "newpass1" }],
      [() => api.removeUser("u1"), "/api/admin/users/u1", "DELETE"],
    ];
    for (const [call, path, method, body] of calls) {
      await call();
      expect(fetchMock).toHaveBeenLastCalledWith(path, expect.objectContaining({
        method, body: body ? JSON.stringify(body) : undefined,
      }));
    }
  });
});
