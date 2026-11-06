import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Checklist } from "@/components/Checklist";
import * as boardApi from "@/lib/board-api";
import { CHECKLIST_MAX_ITEMS, initialData, type Card } from "@/lib/kanban";

vi.mock("@/lib/board-api", () => ({
  addChecklistItem: vi.fn(), editChecklistItem: vi.fn(), deleteChecklistItem: vi.fn(),
}));
const api = vi.mocked(boardApi);

const card = initialData.cards["card-3"];

const renderChecklist = (target: Card = card, readOnly = false, saved = true) => {
  // Run each change immediately, as the board's save() does.
  const onSave = vi.fn(async (change: () => Promise<unknown>) => {
    await change();
    return saved;
  });
  render(<Checklist boardId="b1" card={target} readOnly={readOnly} onSave={onSave} />);
  return onSave;
};

beforeEach(() => vi.resetAllMocks());

describe("Checklist", () => {
  it("shows items and progress", () => {
    renderChecklist();
    expect(screen.getByText("1/2 done")).toBeInTheDocument();
    expect(screen.getByRole("progressbar", { name: "Checklist progress" })).toHaveAttribute("aria-valuenow", "1");
    expect(screen.getByRole("checkbox", { name: "Pick metrics" })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: "Sketch layout" })).not.toBeChecked();
  });

  it("toggles, removes, and adds items through the board save", async () => {
    const onSave = renderChecklist();
    await userEvent.click(screen.getByRole("checkbox", { name: "Sketch layout" }));
    expect(api.editChecklistItem).toHaveBeenCalledWith("b1", "card-3", "item-2", { done: true });
    await userEvent.click(screen.getByRole("checkbox", { name: "Pick metrics" }));
    expect(api.editChecklistItem).toHaveBeenLastCalledWith("b1", "card-3", "item-1", { done: false });
    await userEvent.click(screen.getByRole("button", { name: "Remove Pick metrics" }));
    expect(api.deleteChecklistItem).toHaveBeenCalledWith("b1", "card-3", "item-1");

    const input = screen.getByLabelText("New checklist item");
    expect(screen.getByRole("button", { name: "Add item" })).toBeDisabled();
    await userEvent.type(input, "  Share draft  {Enter}");
    expect(api.addChecklistItem).toHaveBeenCalledWith("b1", "card-3", "Share draft");
    expect(input).toHaveValue("");
    expect(onSave).toHaveBeenCalledTimes(4);
  });

  it("keeps the draft when saving fails", async () => {
    renderChecklist(card, false, false);
    await userEvent.type(screen.getByLabelText("New checklist item"), "Retry me{Enter}");
    expect(screen.getByLabelText("New checklist item")).toHaveValue("Retry me");
  });

  it("is read-only for viewers and hides the form when full", () => {
    renderChecklist(card, true);
    expect(screen.getByRole("checkbox", { name: "Pick metrics" })).toBeDisabled();
    expect(screen.queryByRole("button", { name: /Remove/ })).not.toBeInTheDocument();
    expect(screen.queryByLabelText("New checklist item")).not.toBeInTheDocument();
  });

  it("shows an empty state and stops at the item limit", () => {
    const { unmount } = render(<Checklist boardId="b1" card={{ ...card, checklist: [] }} readOnly={false} onSave={vi.fn()} />);
    expect(screen.getByText("No checklist items.")).toBeInTheDocument();
    expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();
    unmount();
    const checklist = Array.from({ length: CHECKLIST_MAX_ITEMS }, (_, index) => ({ id: `i${index}`, text: `Step ${index}`, done: false }));
    render(<Checklist boardId="b1" card={{ ...card, checklist }} readOnly={false} onSave={vi.fn()} />);
    expect(screen.queryByLabelText("New checklist item")).not.toBeInTheDocument();
  });
});
