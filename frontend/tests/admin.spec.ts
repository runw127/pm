import { expect, test } from "@playwright/test";
import { registerUser, signIn } from "./helpers";

test("the default admin manages member accounts", async ({ page, browser }) => {
  const memberContext = await browser.newContext();
  const memberPage = await memberContext.newPage();
  const member = await registerUser(memberPage, "managed");

  await signIn(page, "user", "password");
  await page.getByRole("button", { name: "Users" }).click();
  const table = page.getByRole("region", { name: "User management" });
  const row = table.getByRole("row", { name: new RegExp(member) });
  await expect(row).toContainText("Member");
  await expect(row).toContainText("1");

  await row.getByRole("button", { name: `Make ${member} admin` }).click();
  await expect(row).toContainText("Admin");
  await memberPage.reload();
  await expect(memberPage.getByRole("button", { name: "Users" })).toBeVisible();
  await row.getByRole("button", { name: `Revoke admin for ${member}` }).click();
  await expect(row).toContainText("Member");

  await row.getByRole("button", { name: `Reset password for ${member}` }).click();
  await row.getByLabel(`New password for ${member}`).fill("admin-reset-1");
  await row.getByRole("button", { name: "Save password" }).click();
  await expect(page.getByRole("status")).toHaveText(`Password reset for ${member}.`);
  await memberPage.reload();
  await expect(memberPage.getByRole("heading", { name: "Sign in" })).toBeVisible();
  await signIn(memberPage, member, "admin-reset-1");

  page.once("dialog", (dialog) => dialog.accept());
  await row.getByRole("button", { name: `Delete ${member}` }).click();
  await expect(table.getByRole("row", { name: new RegExp(member) })).toHaveCount(0);
  await memberPage.reload();
  await expect(memberPage.getByRole("heading", { name: "Sign in" })).toBeVisible();
  await memberContext.close();
});

test("members cannot reach admin routes", async ({ page }) => {
  await registerUser(page);
  expect((await page.request.get("/api/admin/users")).status()).toBe(403);
});
