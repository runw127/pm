import { expect, test, type Page } from "@playwright/test";
import { addCard, boardLoaded, columnTitles, registerUser } from "./helpers";

test.beforeEach(async ({ page }) => {
  await registerUser(page);
});

const order = async (page: Page, columnId: string) =>
  page.getByTestId(`column-${columnId}`).locator("article h4").allTextContents();

const drag = async (page: Page, title: string, target: { x: number; y: number }) => {
  const handle = await page.getByRole("button", { name: `Drag ${title}` }).boundingBox();
  if (!handle) throw new Error("Unable to resolve drag handle");
  await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2);
  await page.mouse.down();
  await page.mouse.move(target.x, target.y, { steps: 12 });
  await page.mouse.up();
  await expect(page.getByText("Saving...")).toHaveCount(0);
};

test("starts with five columns and keeps renamed columns after refresh", async ({ page }) => {
  expect(await columnTitles(page)).toEqual(["Backlog", "Discovery", "In Progress", "Review", "Done"]);
  const title = page.getByTestId("column-col-backlog").getByLabel("Column title");
  await title.fill("Ideas");
  await title.press("Tab");
  await expect(page.getByText("Saving...")).toHaveCount(0);
  await page.reload();
  await boardLoaded(page);
  await expect(page.getByTestId("column-col-backlog").getByLabel("Column title")).toHaveValue("Ideas");
});

test("adds a card with details, priority, due date, and labels, then edits and deletes it", async ({ page }) => {
  await addCard(page, "Plan launch", { details: "Draft the plan", priority: "high", dueDate: "2020-01-01", labels: "launch, ops" });
  const cardId = await page.locator("article", { hasText: "Plan launch" }).getAttribute("data-testid");
  const card = page.getByTestId(cardId!);
  await expect(card.getByText("high")).toBeVisible();
  await expect(card.getByText("Overdue 2020-01-01")).toBeVisible();
  await expect(card.getByText("#launch")).toBeVisible();
  await expect(page.getByLabel("Board summary")).toContainText("Overdue1");

  await page.reload();
  await boardLoaded(page);
  await page.getByRole("button", { name: "Edit Plan launch" }).click();
  await card.getByLabel("Card title").fill("Plan launch v2");
  await card.getByLabel("Priority").selectOption("low");
  await card.getByLabel("Due date").fill("");
  await card.getByLabel("Labels").fill("ops");
  await card.getByRole("button", { name: "Save card" }).click();
  await expect(card.getByRole("heading", { name: "Plan launch v2" })).toBeVisible();
  await expect(card.getByText("low")).toBeVisible();
  await expect(card.getByText(/Overdue/)).toHaveCount(0);
  await expect(card.getByText("#launch")).toHaveCount(0);

  await page.reload();
  await boardLoaded(page);
  await expect(card.getByText("#ops")).toBeVisible();
  await page.getByRole("button", { name: "Archive Plan launch v2" }).click();
  await expect(page.getByRole("heading", { name: "Plan launch v2" })).toHaveCount(0);
  await page.reload();
  await boardLoaded(page);
  await expect(page.getByRole("heading", { name: "Plan launch v2" })).toHaveCount(0);

  await page.getByRole("button", { name: "Archived" }).click();
  const archive = page.getByRole("region", { name: "Archived cards" });
  await archive.getByRole("button", { name: "Restore Plan launch v2" }).click();
  await expect(page.getByTestId("column-col-backlog").getByRole("heading", { name: "Plan launch v2" })).toBeVisible();
  await expect(archive.getByText("No archived cards.")).toBeVisible();

  await page.getByRole("button", { name: "Archive Plan launch v2" }).click();
  page.once("dialog", (dialog) => dialog.accept());
  await archive.getByRole("button", { name: "Delete Plan launch v2 permanently" }).click();
  await expect(archive.getByText("No archived cards.")).toBeVisible();
  await page.reload();
  await boardLoaded(page);
  await expect(page.getByText("Plan launch v2")).toHaveCount(0);
});

test("drags a card to another column and keeps the move after refresh", async ({ page }) => {
  await addCard(page, "Dragged card");
  const target = await page.getByTestId("column-col-review").boundingBox();
  if (!target) throw new Error("Missing column");
  await drag(page, "Dragged card", { x: target.x + target.width / 2, y: target.y + 120 });
  await expect(page.getByTestId("column-col-review").getByText("Dragged card")).toBeVisible();
  await page.reload();
  await boardLoaded(page);
  await expect(page.getByTestId("column-col-review").getByText("Dragged card")).toBeVisible();
});

test("reorders cards within a column by pointer and keyboard", async ({ page }) => {
  await addCard(page, "First");
  await addCard(page, "Second");
  const first = await page.locator("article", { hasText: "First" }).boundingBox();
  if (!first) throw new Error("Missing card");
  await drag(page, "Second", { x: first.x + first.width / 2, y: first.y + 15 });
  await expect.poll(() => order(page, "col-backlog")).toEqual(["Second", "First"]);
  await page.reload();
  await boardLoaded(page);
  await expect.poll(() => order(page, "col-backlog")).toEqual(["Second", "First"]);

  const secondId = (await page.locator("article", { hasText: "Second" }).getAttribute("data-testid"))!.replace("card-", "");
  const handle = page.getByRole("button", { name: "Drag First" });
  await handle.focus();
  await page.keyboard.press("Space");
  await expect(handle).toHaveAttribute("aria-pressed", "true");
  // dnd-kit measures drop targets just after the drag activates; an arrow key sent before that
  // does nothing, so press until the move over "Second" is announced. "Second" is the top card,
  // so extra presses cannot overshoot.
  await expect(async () => {
    await page.keyboard.press("ArrowUp");
    await expect(page.getByText(`was moved over droppable area ${secondId}.`)).toHaveCount(1, { timeout: 500 });
  }).toPass();
  await page.keyboard.press("Space");
  await expect.poll(() => order(page, "col-backlog")).toEqual(["First", "Second"]);
  await page.reload();
  await boardLoaded(page);
  await expect.poll(() => order(page, "col-backlog")).toEqual(["First", "Second"]);
});

test("adds, reorders, and deletes columns", async ({ page }) => {
  await page.getByLabel("New column title").fill("Blocked");
  await page.getByRole("button", { name: "Add column" }).click();
  await expect.poll(() => columnTitles(page)).toEqual(["Backlog", "Discovery", "In Progress", "Review", "Done", "Blocked"]);

  await page.getByRole("button", { name: "Move Blocked left" }).click();
  await expect.poll(() => columnTitles(page)).toEqual(["Backlog", "Discovery", "In Progress", "Review", "Blocked", "Done"]);
  await page.getByRole("button", { name: "Move Backlog right" }).click();
  await expect.poll(() => columnTitles(page)).toEqual(["Discovery", "Backlog", "In Progress", "Review", "Blocked", "Done"]);

  await addCard(page, "Lost with column", { columnId: "col-review" });
  page.once("dialog", (dialog) => {
    expect(dialog.message()).toBe('Delete "Review" and its 1 card(s)?');
    void dialog.accept();
  });
  await page.getByRole("button", { name: "Delete column Review" }).click();
  await expect.poll(() => columnTitles(page)).toEqual(["Discovery", "Backlog", "In Progress", "Blocked", "Done"]);
  await expect(page.getByText("Lost with column")).toHaveCount(0);

  await page.reload();
  await boardLoaded(page);
  expect(await columnTitles(page)).toEqual(["Discovery", "Backlog", "In Progress", "Blocked", "Done"]);
});

test("filters cards by search, priority, and label", async ({ page }) => {
  await addCard(page, "Write docs", { labels: "docs" });
  await addCard(page, "Fix login bug", { priority: "high", labels: "bug" });
  await addCard(page, "Polish styles", { columnId: "col-progress", priority: "low" });

  await page.getByLabel("Search cards").fill("login");
  await expect(page.getByText("Fix login bug")).toBeVisible();
  await expect(page.getByText("Write docs")).toHaveCount(0);
  await expect(page.getByTestId("column-col-backlog")).toContainText("1 of 2");
  await page.getByRole("button", { name: "Clear filters" }).click();

  await page.getByLabel("Filter by priority").selectOption("low");
  await expect(page.getByText("Polish styles")).toBeVisible();
  await expect(page.getByText("Fix login bug")).toHaveCount(0);
  await page.getByLabel("Filter by priority").selectOption("");

  await page.getByLabel("Filter by label").selectOption("docs");
  await expect(page.getByText("Write docs")).toBeVisible();
  await expect(page.getByText("Polish styles")).toHaveCount(0);
});
