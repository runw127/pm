import { expect, type Page } from "@playwright/test";

let counter = 0;

export const uniqueName = (prefix: string) =>
  `${prefix}-${Date.now().toString(36)}${(counter++).toString(36)}${Math.random().toString(36).slice(2, 6)}`.slice(0, 32);

export const PASSWORD = "e2e-password";

export const boardLoaded = async (page: Page) => {
  await expect(page.getByLabel("Board name", { exact: true })).toBeVisible();
  await expect(page.getByText("Saving...")).toHaveCount(0);
};

/** Create a fresh member account through the UI and land on their default board. */
export const registerUser = async (page: Page, prefix = "member") => {
  const username = uniqueName(prefix);
  await page.goto("/");
  await page.getByRole("button", { name: "Need an account? Create one" }).click();
  await page.getByLabel("Username").fill(username);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page.getByText(`Signed in as ${username}`)).toBeVisible();
  await boardLoaded(page);
  return username;
};

export const signIn = async (page: Page, username: string, password: string) => {
  await page.goto("/");
  await page.getByLabel("Username").fill(username);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByText(`Signed in as ${username}`)).toBeVisible();
};

export const addCard = async (
  page: Page,
  title: string,
  options: { columnId?: string; details?: string; priority?: string; dueDate?: string; labels?: string } = {}
) => {
  const column = page.getByTestId(`column-${options.columnId ?? "col-backlog"}`);
  await column.getByRole("button", { name: "Add a card" }).click();
  await column.getByPlaceholder("Card title").fill(title);
  if (options.details) await column.getByPlaceholder("Details").fill(options.details);
  if (options.priority) await column.getByLabel("Priority").selectOption(options.priority);
  if (options.dueDate) await column.getByLabel("Due date").fill(options.dueDate);
  if (options.labels) await column.getByLabel("Labels").fill(options.labels);
  await column.getByRole("button", { name: "Add card" }).click();
  await expect(column.getByRole("heading", { name: title })).toBeVisible();
  await expect(page.getByText("Saving...")).toHaveCount(0);
};

export const columnTitles = (page: Page) =>
  page.locator('[data-testid^="column-"]').getByLabel("Column title").evaluateAll(
    (inputs) => inputs.map((input) => (input as HTMLInputElement).value)
  );

export const boardPicker = (page: Page) => page.getByRole("combobox", { name: "Board", exact: true });

/** Switch boards from the header picker; `shared` picks from "Shared with you". */
export const selectBoard = async (page: Page, name: string, shared = false) => {
  const group = shared ? 'optgroup[label="Shared with you"] ' : "";
  const value = await boardPicker(page).locator(`${group}option`, { hasText: name }).first().getAttribute("value");
  await boardPicker(page).selectOption(value!);
  await expect(page.getByLabel("Board name", { exact: true })).toHaveValue(name);
};

export const openChat = async (page: Page) => {
  await page.getByRole("button", { name: "AI chat" }).click();
  await expect(page.getByRole("heading", { name: "Board chat" })).toBeVisible();
};
