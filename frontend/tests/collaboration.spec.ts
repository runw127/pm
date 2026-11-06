import { expect, test } from "@playwright/test";
import { addCard, boardLoaded, registerUser, selectBoard } from "./helpers";

test("members discuss a card and see the board's activity", async ({ page, browser }) => {
  const owner = await registerUser(page, "lead");
  await addCard(page, "Launch checklist");
  const cardId = (await page.locator("article", { hasText: "Launch checklist" }).getAttribute("data-testid"))!;
  await page.getByTestId(cardId).getByRole("button", { name: "Edit Launch checklist" }).click();
  await page.getByTestId(cardId).getByLabel("Priority").selectOption("high");
  await page.getByTestId(cardId).getByRole("button", { name: "Save card" }).click();
  await expect(page.getByText("Saving...")).toHaveCount(0);

  await page.getByRole("button", { name: "Open Launch checklist" }).click();
  const dialog = page.getByRole("dialog", { name: "Card Launch checklist" });
  await expect(dialog.getByText("No comments yet.")).toBeVisible();
  await dialog.getByLabel("New comment").fill("Owner note");
  await dialog.getByRole("button", { name: "Add comment" }).click();
  await expect(dialog.getByText("Owner note")).toBeVisible();
  await expect(dialog.getByRole("region", { name: "Card history" })).toContainText(`${owner} edited card "Launch checklist"`);
  await expect(dialog.getByRole("region", { name: "Card history" })).toContainText(`${owner} added card "Launch checklist" to Backlog`);
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(page.getByTestId(cardId).getByText("1 comment")).toBeVisible();

  const viewerContext = await browser.newContext();
  const viewerPage = await viewerContext.newPage();
  const viewer = await registerUser(viewerPage, "reader");
  await page.getByRole("button", { name: "Members (1)" }).click();
  await page.getByLabel("Share with username").fill(viewer);
  await page.getByLabel("New member role").selectOption("viewer");
  await page.getByRole("button", { name: "Share" }).click();
  await expect(page.getByRole("button", { name: "Members (2)" })).toBeVisible();

  await viewerPage.reload();
  await boardLoaded(viewerPage);
  await selectBoard(viewerPage, "My board", true);
  await expect(viewerPage.getByText("View only")).toBeVisible();
  await viewerPage.getByRole("button", { name: "Open Launch checklist" }).click();
  const viewerDialog = viewerPage.getByRole("dialog", { name: "Card Launch checklist" });
  await expect(viewerDialog.getByText("Owner note")).toBeVisible();
  await expect(viewerDialog.getByRole("button", { name: /Delete comment/ })).toHaveCount(0);
  await viewerDialog.getByLabel("New comment").fill("Viewer question");
  await viewerDialog.getByRole("button", { name: "Add comment" }).click();
  await expect(viewerDialog.getByText("Viewer question")).toBeVisible();
  await expect(viewerDialog.getByRole("button", { name: /Delete comment/ })).toHaveCount(1);

  await page.reload();
  await boardLoaded(page);
  await expect(page.getByTestId(cardId).getByText("2 comments")).toBeVisible();
  await page.getByRole("button", { name: "Activity" }).click();
  const feed = page.getByRole("region", { name: "Board activity" });
  await expect(feed).toContainText(`${viewer} commented on "Launch checklist"`);
  await expect(feed).toContainText(`${owner} gave ${viewer} viewer access`);

  await page.getByRole("button", { name: "Open Launch checklist" }).click();
  const ownerDialog = page.getByRole("dialog", { name: "Card Launch checklist" });
  await ownerDialog.getByRole("button", { name: "Delete comment Viewer question" }).click();
  await expect(ownerDialog.getByText("Viewer question")).toHaveCount(0);
  await ownerDialog.getByRole("button", { name: "Close" }).click();
  await expect(page.getByTestId(cardId).getByText("1 comment")).toBeVisible();
  await viewerContext.close();
});
