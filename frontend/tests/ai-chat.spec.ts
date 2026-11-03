import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await page.getByLabel("Username").fill("user");
  await page.getByLabel("Password").fill("password");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("heading", { name: "Board chat" })).toBeVisible();
});

test("shows an AI reply and keeps conversation during refresh", async ({ page }) => {
  await page.route("**/api/ai/chat", async (route) => {
    const board = await page.request.get("/api/board");
    await route.fulfill({ json: { text: "Your board has five columns.", board: await board.json() } });
  });
  await page.getByLabel("Message").fill("How many columns?");
  await page.getByRole("button", { name: "Send message" }).click();
  await expect(page.getByLabel("Conversation")).toContainText("Your board has five columns.");
  await page.reload();
  await expect(page.getByLabel("Conversation")).toContainText("Your board has five columns.");
  await page.getByRole("button", { name: "New conversation" }).click();
  await expect(page.getByLabel("Conversation")).not.toContainText("Your board has five columns.");
});

test("keeps chat usable on a narrow screen", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole("heading", { name: "Board chat" })).toBeVisible();
  await expect(page.getByLabel("Message")).toBeVisible();
  await expect(page.getByRole("button", { name: "Send message" })).toBeVisible();
});

test("shows multiple AI card changes immediately and after refresh", async ({ page }) => {
  const first = `AI first ${Date.now()}`;
  const second = `AI second ${Date.now()}`;
  await page.route("**/api/ai/chat", async (route) => {
    const one = await page.request.post("/api/board/cards", { data: { columnId: "col-backlog", title: first, details: "" } });
    expect(one.ok()).toBeTruthy();
    const two = await page.request.post("/api/board/cards", { data: { columnId: "col-backlog", title: second, details: "" } });
    expect(two.ok()).toBeTruthy();
    await route.fulfill({ json: { text: "Added both cards.", board: await two.json() } });
  });
  await page.getByLabel("Message").fill("Add two cards");
  await page.getByRole("button", { name: "Send message" }).click();
  const column = page.getByTestId("column-col-backlog");
  await expect(column.getByText(first)).toBeVisible();
  await expect(column.getByText(second)).toBeVisible();
  await page.reload();
  await expect(column.getByText(first)).toBeVisible();
  await expect(column.getByText(second)).toBeVisible();
  await column.getByRole("button", { name: `Delete ${first}` }).click();
  await column.getByRole("button", { name: `Delete ${second}` }).click();
});
