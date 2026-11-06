import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError, isExpired, messageOf, request } from "@/lib/api";

afterEach(() => vi.unstubAllGlobals());

describe("request", () => {
  it("sends JSON and parses the response", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ ok: 1 }) });
    vi.stubGlobal("fetch", fetchMock);
    expect(await request("/api/x", "POST", { a: 1 })).toEqual({ ok: 1 });
    expect(fetchMock).toHaveBeenCalledWith("/api/x", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ a: 1 }),
    });
    await request("/api/y");
    expect(fetchMock).toHaveBeenLastCalledWith("/api/y", { method: "GET", headers: undefined, body: undefined });
  });

  it("returns nothing for 204 responses", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, status: 204, json: async () => { throw new Error("no body"); } }));
    expect(await request("/api/logout", "POST")).toBeUndefined();
  });

  it("uses the API detail or a fallback for failures", async () => {
    vi.stubGlobal("fetch", vi.fn()
      .mockResolvedValueOnce({ ok: false, status: 422, json: async () => ({ detail: "Title cannot be empty" }) })
      .mockResolvedValueOnce({ ok: false, status: 500, json: async () => { throw new Error("html"); } })
      .mockRejectedValueOnce(new Error("Offline")));
    await expect(request("/api/x")).rejects.toEqual(new ApiError("Title cannot be empty", 422));
    await expect(request("/api/x")).rejects.toEqual(new ApiError("Request failed (500)", 500));
    await expect(request("/api/x")).rejects.toThrow("Offline");
  });

  it("classifies errors", () => {
    expect(isExpired(new ApiError("Not signed in", 401))).toBe(true);
    expect(isExpired(new ApiError("Nope", 403))).toBe(false);
    expect(isExpired(new Error("x"))).toBe(false);
    expect(messageOf(new Error("Broken"), "Fallback")).toBe("Broken");
    expect(messageOf("string", "Fallback")).toBe("Fallback");
  });
});
