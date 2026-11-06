import { expect, test, type Browser, type Page } from "@playwright/test";
import { addCard, boardLoaded, registerUser, selectBoard } from "./helpers";

const newUser = async (browser: Browser, prefix: string) => {
  const context = await browser.newContext();
  const page = await context.newPage();
  const username = await registerUser(page, prefix);
  return { context, page, username };
};

const share = async (page: Page, username: string, role: "editor" | "viewer") => {
  const panel = page.getByRole("region", { name: "Board members" });
  await panel.getByLabel("Share with username").fill(username);
  await panel.getByLabel("New member role").selectOption(role);
  await panel.getByRole("button", { name: "Share" }).click();
  await expect(panel.getByText(username, { exact: true })).toBeVisible();
};

const openShared = async (page: Page, boardName: string) => {
  await page.reload();
  await boardLoaded(page);
  await selectBoard(page, boardName, true);
};

test("owners share boards with editors and viewers who collaborate on cards", async ({ page, browser }) => {
  const owner = await registerUser(page, "owner");
  const name = page.getByLabel("Board name", { exact: true });
  await name.fill("Team roadmap");
  await name.press("Enter");
  await expect(page.getByText("Saving...")).toHaveCount(0);

  const editor = await newUser(browser, "editor");
  const viewer = await newUser(browser, "viewer");
  await page.getByRole("button", { name: "Members (1)" }).click();
  await share(page, editor.username, "editor");
  await share(page, viewer.username, "viewer");
  await expect(page.getByRole("button", { name: "Members (3)" })).toBeVisible();

  await openShared(editor.page, "Team roadmap");
  await expect(editor.page.getByText("Shared with you as editor")).toBeVisible();
  await addCard(editor.page, "Shared task");
  const card = editor.page.locator("article", { hasText: "Shared task" });
  const cardId = (await card.getAttribute("data-testid"))!;
  await editor.page.getByRole("button", { name: "Edit Shared task" }).click();
  await editor.page.getByTestId(cardId).getByLabel("Assignee").selectOption({ label: owner });
  await editor.page.getByTestId(cardId).getByRole("button", { name: "Save card" }).click();
  await expect(editor.page.getByTestId(cardId).getByText(`@${owner}`)).toBeVisible();

  await page.reload();
  await boardLoaded(page);
  await expect(page.getByTestId(cardId).getByText(`@${owner}`)).toBeVisible();

  await openShared(viewer.page, "Team roadmap");
  await expect(viewer.page.getByText("View only")).toBeVisible();
  await expect(viewer.page.getByText("Shared task")).toBeVisible();
  await expect(viewer.page.getByRole("button", { name: "Add a card" })).toHaveCount(0);
  await expect(viewer.page.getByRole("button", { name: "Edit Shared task" })).toHaveCount(0);
  const boardId = (await (await viewer.page.request.get("/api/boards")).json())[1].id;
  const blocked = await viewer.page.request.post(`/api/boards/${boardId}/cards`, {
    data: { columnId: "col-backlog", title: "Sneaky" },
  });
  expect(blocked.status()).toBe(403);

  viewer.page.once("dialog", (dialog) => dialog.accept());
  await viewer.page.getByRole("button", { name: "Members (3)" }).click();
  await viewer.page.getByRole("button", { name: "Leave board" }).click();
  await expect(viewer.page.getByLabel("Board name", { exact: true })).toHaveValue("My board");
  await expect(viewer.page.getByText("Shared with you")).toHaveCount(0);

  await page.reload();
  await boardLoaded(page);
  await page.getByRole("button", { name: "Members (2)" }).click();
  await page.getByRole("button", { name: `Remove ${editor.username}` }).click();
  await expect(page.getByRole("button", { name: "Members (1)" })).toBeVisible();
  expect((await editor.page.request.get(`/api/boards/${boardId}`)).status()).toBe(404);

  await editor.context.close();
  await viewer.context.close();
});
