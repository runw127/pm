import { expect, test } from "@playwright/test";
import { addCard, boardLoaded, registerUser } from "./helpers";

test("checklist items persist and show progress on the card", async ({ page }) => {
  const owner = await registerUser(page, "planner");
  await addCard(page, "Release prep");
  const card = page.locator("article", { hasText: "Release prep" });

  await page.getByRole("button", { name: "Open Release prep" }).click();
  const dialog = page.getByRole("dialog", { name: "Card Release prep" });
  await expect(dialog.getByText("No checklist items.")).toBeVisible();
  for (const item of ["Write notes", "Tag build", "Announce"]) {
    await dialog.getByLabel("New checklist item").fill(item);
    await dialog.getByRole("button", { name: "Add item" }).click();
    await expect(dialog.getByRole("checkbox", { name: item })).toBeVisible();
  }
  await dialog.getByRole("checkbox", { name: "Write notes" }).click();
  await expect(dialog.getByRole("checkbox", { name: "Write notes" })).toBeChecked();
  await expect(dialog.getByText("1/3 done")).toBeVisible();
  await dialog.getByRole("button", { name: "Remove Announce" }).click();
  await expect(dialog.getByRole("checkbox", { name: "Announce" })).toHaveCount(0);
  await expect(dialog.getByText("1/2 done")).toBeVisible();
  await expect(dialog.getByRole("region", { name: "Card history" })).toContainText(
    `${owner} checked "Write notes" on "Release prep"`
  );
  await page.keyboard.press("Escape");
  await expect(card.getByLabel("Checklist 1 of 2 done")).toBeVisible();

  await page.reload();
  await boardLoaded(page);
  await expect(card.getByLabel("Checklist 1 of 2 done")).toBeVisible();
  await page.getByRole("button", { name: "Open Release prep" }).click();
  await expect(dialog.getByRole("checkbox", { name: "Write notes" })).toBeChecked();
  await dialog.getByRole("checkbox", { name: "Tag build" }).click();
  await expect(dialog.getByText("2/2 done")).toBeVisible();
  await dialog.getByRole("button", { name: "Close" }).click();
  await expect(card.getByLabel("Checklist 2 of 2 done")).toBeVisible();
});
