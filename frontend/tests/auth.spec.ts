import { expect, test } from "@playwright/test";
import { PASSWORD, boardLoaded, registerUser, signIn } from "./helpers";

test("rejects bad credentials and reveals no board", async ({ page }) => {
  await page.goto("/");
  await page.getByLabel("Username").fill("user");
  await page.getByLabel("Password").fill("wrong");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByText("Incorrect username or password.")).toBeVisible();
  await expect(page.getByLabel("Board name", { exact: true })).toHaveCount(0);
  expect((await page.request.get("/api/boards")).status()).toBe(401);
});

test("registers a member whose session survives a browser restart until logout", async ({ page, browser }) => {
  const username = await registerUser(page);
  await expect(page.getByLabel("Board name", { exact: true })).toHaveValue("My board");
  await expect(page.getByRole("button", { name: "Users" })).toHaveCount(0);

  const reopened = await browser.newContext({ storageState: await page.context().storageState() });
  const reopenedPage = await reopened.newPage();
  await reopenedPage.goto("/");
  await expect(reopenedPage.getByText(`Signed in as ${username}`)).toBeVisible();
  await reopenedPage.getByRole("button", { name: "Log out" }).click();
  await expect(reopenedPage.getByRole("heading", { name: "Sign in" })).toBeVisible();
  await reopenedPage.reload();
  await expect(reopenedPage.getByRole("heading", { name: "Sign in" })).toBeVisible();
  await reopened.close();
});

test("shows registration validation errors", async ({ page }) => {
  const username = await registerUser(page);
  await page.getByRole("button", { name: "Log out" }).click();
  await page.getByRole("button", { name: "Need an account? Create one" }).click();
  await page.getByLabel("Username").fill(username.toUpperCase());
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page.locator("form").getByRole("alert")).toHaveText("Username is already taken");
  await page.getByLabel("Username").fill("bad name!");
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page.locator("form").getByRole("alert")).toContainText("Username must be 3-32");
});

test("changes the password and deletes the account", async ({ page }) => {
  const username = await registerUser(page);
  await page.getByRole("button", { name: "Account" }).click();
  await page.getByLabel("Current password").fill("not-my-password");
  await page.getByLabel("New password").fill("brand-new-pass");
  await page.getByRole("button", { name: "Update password" }).click();
  const settings = page.getByRole("region", { name: "Account settings" });
  await expect(settings.getByRole("alert")).toHaveText("Current password is incorrect");
  await expect(page.getByText(`Signed in as ${username}`)).toBeVisible();

  await page.getByLabel("Current password").fill(PASSWORD);
  await page.getByRole("button", { name: "Update password" }).click();
  await expect(settings.getByRole("status")).toContainText("Password updated");
  await page.getByRole("button", { name: "Log out" }).click();
  await signIn(page, username, "brand-new-pass");
  await boardLoaded(page);

  await page.getByRole("button", { name: "Account" }).click();
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByLabel("Confirm with your password").fill("brand-new-pass");
  await page.getByRole("button", { name: "Delete my account" }).click();
  await expect(page.getByText("Your account has been deleted.")).toBeVisible();
  await page.getByLabel("Username").fill(username);
  await page.getByLabel("Password").fill("brand-new-pass");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByText("Incorrect username or password.")).toBeVisible();
});

test("keeps each user's boards private", async ({ page, browser }) => {
  await registerUser(page, "owner");
  const ownerBoards = await (await page.request.get("/api/boards")).json();
  const other = await browser.newContext();
  const otherPage = await other.newPage();
  await registerUser(otherPage, "other");
  const response = await otherPage.request.get(`/api/boards/${ownerBoards[0].id}`);
  expect(response.status()).toBe(404);
  await other.close();
});
