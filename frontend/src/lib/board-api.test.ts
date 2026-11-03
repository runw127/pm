import { afterEach, describe, expect, it, vi } from "vitest";
import { addCard, deleteCard, editCard, getBoard, moveCardOnServer, renameColumn } from "@/lib/board-api";
import { initialData } from "@/lib/kanban";

afterEach(() => vi.unstubAllGlobals());

describe("board API", () => {
  it("sends board requests with the expected paths and payloads", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => initialData });
    vi.stubGlobal("fetch", fetchMock);

    expect(await getBoard()).toBe(initialData);
    await renameColumn("col-backlog", "Ideas");
    await addCard("col-backlog", "First", "Notes");
    await editCard("card-1", "Updated", "More notes");
    await moveCardOnServer("card-1", "col-done", 0);
    await deleteCard("card-1");

    expect(fetchMock).toHaveBeenNthCalledWith(1, "/api/board", expect.objectContaining({ method: "GET" }));
    expect(fetchMock).toHaveBeenNthCalledWith(2, "/api/board/columns/col-backlog", expect.objectContaining({
      method: "PATCH", body: JSON.stringify({ title: "Ideas" }),
    }));
    expect(fetchMock).toHaveBeenNthCalledWith(3, "/api/board/cards", expect.objectContaining({
      method: "POST", body: JSON.stringify({ columnId: "col-backlog", title: "First", details: "Notes" }),
    }));
    expect(fetchMock).toHaveBeenNthCalledWith(4, "/api/board/cards/card-1", expect.objectContaining({
      method: "PATCH", body: JSON.stringify({ title: "Updated", details: "More notes" }),
    }));
    expect(fetchMock).toHaveBeenNthCalledWith(5, "/api/board/cards/card-1/move", expect.objectContaining({
      method: "POST", body: JSON.stringify({ toColumnId: "col-done", toIndex: 0 }),
    }));
    expect(fetchMock).toHaveBeenNthCalledWith(6, "/api/board/cards/card-1", expect.objectContaining({ method: "DELETE" }));
  });

  it("reports API and network failures", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce({
      ok: false, status: 422, json: async () => ({ detail: "Title cannot be empty" }),
    }).mockRejectedValueOnce(new Error("Offline"));
    vi.stubGlobal("fetch", fetchMock);
    await expect(renameColumn("col-backlog", "")).rejects.toThrow("Title cannot be empty");
    await expect(getBoard()).rejects.toThrow("Offline");
  });
});
