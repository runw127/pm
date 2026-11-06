import { expect, test } from "@playwright/test";
import { addCard, boardLoaded, boardPicker, registerUser, selectBoard } from "./helpers";

test("creates, switches, renames, and deletes boards with isolated cards", async ({ page }) => {
  await registerUser(page);
  const boards = boardPicker(page);
  await addCard(page, "Card on first board");

  await page.getByLabel("New board name").fill("Launch plan");
  await page.getByRole("button", { name: "Create board" }).click();
  await expect(page.getByLabel("Board name", { exact: true })).toHaveValue("Launch plan");
  await expect(page.getByText("Card on first board")).toHaveCount(0);
  await addCard(page, "Card on launch board");
  await expect(boards.locator("option:checked")).toHaveText("Launch plan (1)");

  const name = page.getByLabel("Board name", { exact: true });
  await name.fill("Launch v2");
  await name.press("Enter");
  await expect(boards.locator("option:checked")).toHaveText("Launch v2 (1)");

  await page.reload();
  await boardLoaded(page);
  await expect(page.getByLabel("Board name", { exact: true })).toHaveValue("Launch v2");
  await expect(page.getByText("Card on launch board")).toBeVisible();

  await selectBoard(page, "My board");
  await expect(page.getByText("Card on first board")).toBeVisible();

  await selectBoard(page, "Launch v2");
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "Delete board Launch v2" }).click();
  await expect(page.getByLabel("Board name", { exact: true })).toHaveValue("My board");
  await expect(boards.locator("option")).toHaveText(["My board (1)"]);
  await expect(page.getByRole("button", { name: /Delete board/ })).toHaveCount(0);
  await page.reload();
  await boardLoaded(page);
  await expect(boards.locator("option")).toHaveCount(1);
});
