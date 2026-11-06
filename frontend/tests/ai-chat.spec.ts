import { expect, test } from "@playwright/test";
import { boardLoaded, openChat, registerUser } from "./helpers";

test.beforeEach(async ({ page }) => {
  await registerUser(page);
  await openChat(page);
});

const boardId = async (page: import("@playwright/test").Page) =>
  (await (await page.request.get("/api/boards")).json())[0].id as string;

test("shows an AI reply and keeps the conversation during refresh", async ({ page }) => {
  const id = await boardId(page);
  await page.route("**/api/boards/*/ai/chat", async (route) => {
    const board = await page.request.get(`/api/boards/${id}`);
    await route.fulfill({ json: { text: "Your board has five columns.", board: await board.json() } });
  });
  await page.getByLabel("Message").fill("How many columns?");
  await page.getByRole("button", { name: "Send message" }).click();
  await expect(page.getByLabel("Conversation")).toContainText("Your board has five columns.");
  await page.getByRole("button", { name: "Close AI chat" }).click();
  await expect(page.getByLabel("Conversation")).toBeHidden();
  await page.reload();
  await boardLoaded(page);
  await openChat(page);
  await expect(page.getByLabel("Conversation")).toContainText("Your board has five columns.");
  await page.getByRole("button", { name: "New conversation" }).click();
  await expect(page.getByLabel("Conversation")).not.toContainText("Your board has five columns.");
});

test("shows multiple AI card changes immediately and after refresh", async ({ page }) => {
  const id = await boardId(page);
  await page.route("**/api/boards/*/ai/chat", async (route) => {
    await page.request.post(`/api/boards/${id}/cards`, { data: { columnId: "col-backlog", title: "AI first" } });
    const two = await page.request.post(`/api/boards/${id}/cards`, {
      data: { columnId: "col-backlog", title: "AI second", priority: "high" },
    });
    await route.fulfill({ json: { text: "Added both cards.", board: await two.json() } });
  });
  await page.getByLabel("Message").fill("Add two cards");
  await page.getByRole("button", { name: "Send message" }).click();
  const column = page.getByTestId("column-col-backlog");
  await expect(column.getByText("AI first")).toBeVisible();
  await expect(column.getByText("AI second")).toBeVisible();
  await page.reload();
  await boardLoaded(page);
  await expect(column.getByText("AI second")).toBeVisible();
});

test("keeps chat usable on a narrow screen", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole("complementary", { name: "AI chat" })).toBeInViewport();
  await expect(page.getByRole("heading", { name: "Board chat" })).toBeVisible();
  await expect(page.getByLabel("Message")).toBeVisible();
  await expect(page.getByRole("button", { name: "Send message" })).toBeVisible();
});

test("reports AI errors without changing the board", async ({ page }) => {
  await page.getByLabel("Message").fill("Add a card");
  await page.getByRole("button", { name: "Send message" }).click();
  await expect(page.getByLabel("AI chat").getByRole("alert")).toBeVisible();
  await expect(page.locator('[data-testid^="card-"]')).toHaveCount(0);
});
