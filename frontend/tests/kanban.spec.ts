import { expect, test, type Page } from "@playwright/test";

const signIn = async (page: Page) => {
  await page.goto("/");
  await page.getByLabel("Username").fill("user");
  await page.getByLabel("Password").fill("password");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("heading", { name: "Kanban Studio" })).toBeVisible();
};

const addCard = async (page: Page, title: string) => {
  const column = page.getByTestId("column-col-backlog");
  await column.getByRole("button", { name: "Add a card" }).click();
  await column.getByPlaceholder("Card title").fill(title);
  await column.getByPlaceholder("Details").fill("Added in browser test");
  await column.getByRole("button", { name: "Add card" }).click();
  await expect(column.getByText(title)).toBeVisible();
};

test("loads five columns after sign-in and refresh", async ({ page }) => {
  await signIn(page);
  await expect(page.locator('[data-testid^="column-"]')).toHaveCount(5);
  await page.reload();
  await expect(page.locator('[data-testid^="column-"]')).toHaveCount(5);
});

test("renames a column and retains the title after refresh", async ({ page }) => {
  await signIn(page);
  const title = page.getByTestId("column-col-backlog").getByRole("textbox", { name: "Column title" });
  const original = await title.inputValue();
  await title.fill("Browser Ideas");
  await title.press("Tab");
  await expect(title).toHaveValue("Browser Ideas");
  await expect(page.getByText("Saving...")).toHaveCount(0);
  await page.reload();
  await expect(page.getByTestId("column-col-backlog").getByRole("textbox", { name: "Column title" })).toHaveValue("Browser Ideas");
  await page.getByTestId("column-col-backlog").getByRole("textbox", { name: "Column title" }).fill(original);
  await page.getByTestId("column-col-backlog").getByRole("textbox", { name: "Column title" }).press("Tab");
  await expect(page.getByText("Saving...")).toHaveCount(0);
});

test("adds, edits, and deletes a persistent card", async ({ page }) => {
  await signIn(page);
  const title = `Browser card ${Date.now()}`;
  await addCard(page, title);
  await page.reload();
  await expect(page.getByText(title)).toBeVisible();

  await page.getByRole("button", { name: `Edit ${title}` }).click();
  await page.getByLabel("Edit card title").fill(`${title} edited`);
  await page.getByLabel("Edit card details").fill("Updated notes");
  await page.getByRole("button", { name: "Save card" }).click();
  await expect(page.getByText(`${title} edited`)).toBeVisible();
  await page.reload();
  await expect(page.getByText("Updated notes")).toBeVisible();

  await page.getByRole("button", { name: `Delete ${title} edited` }).click();
  await expect(page.getByText(`${title} edited`)).toHaveCount(0);
  await page.reload();
  await expect(page.getByText(`${title} edited`)).toHaveCount(0);
});

test("drags a card to another column and keeps the move after refresh", async ({ page }) => {
  await signIn(page);
  const title = `Dragged card ${Date.now()}`;
  await addCard(page, title);
  const handle = page.getByRole("button", { name: `Drag ${title}` });
  const target = page.getByTestId("column-col-review");
  const handleBox = await handle.boundingBox();
  const targetBox = await target.boundingBox();
  if (!handleBox || !targetBox) throw new Error("Unable to resolve drag coordinates");

  await page.mouse.move(handleBox.x + handleBox.width / 2, handleBox.y + handleBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(targetBox.x + targetBox.width / 2, targetBox.y + 120, { steps: 12 });
  await page.mouse.up();
  await expect(target.getByText(title)).toBeVisible();
  await page.reload();
  await expect(page.getByTestId("column-col-review").getByText(title)).toBeVisible();
  await page.getByRole("button", { name: `Delete ${title}` }).click();
});

test("reorders cards within a column", async ({ page }) => {
  await signIn(page);
  const first = `First reorder ${Date.now()}`;
  const second = `Second reorder ${Date.now()}`;
  await addCard(page, first);
  await addCard(page, second);
  const handleBox = await page.getByRole("button", { name: `Drag ${second}` }).boundingBox();
  const targetBox = await page.getByText(first).locator("xpath=ancestor::article").boundingBox();
  if (!handleBox || !targetBox) throw new Error("Unable to resolve drag coordinates");

  await page.mouse.move(handleBox.x + handleBox.width / 2, handleBox.y + handleBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(targetBox.x + targetBox.width / 2, targetBox.y + 15, { steps: 12 });
  await page.mouse.up();
  const relativeOrder = async () => {
    const titles = await page.getByTestId("column-col-backlog").locator("article h4").allTextContents();
    return titles.indexOf(second) - titles.indexOf(first);
  };
  await expect.poll(relativeOrder).toBeLessThan(0);
  await page.reload();
  await expect.poll(relativeOrder).toBeLessThan(0);
  await page.getByRole("button", { name: `Delete ${first}` }).click();
  await page.getByRole("button", { name: `Delete ${second}` }).click();
});

test("sign-in survives browser restart and logout removes access", async ({ page, browser }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
  await page.getByLabel("Username").fill("user");
  await page.getByLabel("Password").fill("wrong");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByText("Incorrect username or password.")).toBeVisible();

  await page.getByLabel("Password").fill("password");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("heading", { name: "Kanban Studio" })).toBeVisible();
  const browserState = await page.context().storageState();
  const reopened = await browser.newContext({ storageState: browserState });
  const reopenedPage = await reopened.newPage();
  await reopenedPage.goto("/");
  await expect(reopenedPage.getByRole("heading", { name: "Kanban Studio" })).toBeVisible();
  await reopenedPage.getByRole("button", { name: "Log out" }).click();
  await expect(reopenedPage.getByRole("heading", { name: "Sign in" })).toBeVisible();
  await reopenedPage.reload();
  await expect(reopenedPage.getByRole("heading", { name: "Sign in" })).toBeVisible();
  await reopened.close();
});
