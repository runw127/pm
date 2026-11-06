import { expect, test } from "@playwright/test";
import { addCard, boardLoaded, registerUser } from "./helpers";

test("assigned cards from shared boards appear in My work and open on their board", async ({ page, browser }) => {
  await registerUser(page, "lead");
  const name = page.getByLabel("Board name", { exact: true });
  await name.fill("Launch");
  await name.press("Enter");
  await expect(page.getByText("Saving...")).toHaveCount(0);

  const memberContext = await browser.newContext();
  const memberPage = await memberContext.newPage();
  const member = await registerUser(memberPage, "doer");
  await page.getByRole("button", { name: "Members (1)" }).click();
  await page.getByLabel("Share with username").fill(member);
  await page.getByRole("button", { name: "Share" }).click();
  await expect(page.getByRole("button", { name: "Members (2)" })).toBeVisible();

  await addCard(page, "Overdue task", { dueDate: "2020-01-15", priority: "high" });
  await addCard(page, "Later task", { dueDate: "2099-06-01", columnId: "col-review" });
  await addCard(page, "Done task", { columnId: "col-done" });
  for (const title of ["Overdue task", "Later task", "Done task"]) {
    const testId = await page.locator("article", { hasText: title }).getAttribute("data-testid");
    const card = page.getByTestId(testId!);
    await card.getByRole("button", { name: `Edit ${title}` }).click();
    await card.getByLabel("Assignee").selectOption({ label: member });
    await card.getByRole("button", { name: "Save card" }).click();
    await expect(card.getByText(`@${member}`)).toBeVisible();
  }

  await memberPage.reload();
  await boardLoaded(memberPage);
  await memberPage.getByRole("button", { name: "My work" }).click();
  const work = memberPage.getByRole("region", { name: "My work" });
  await expect(work.getByRole("region", { name: "Overdue" })).toContainText("Overdue task");
  await expect(work.getByRole("region", { name: "Upcoming" })).toContainText("Launch · Review");
  await expect(work.getByText("Done task")).toHaveCount(0);

  await work.getByRole("button", { name: /Later task/ }).click();
  await expect(memberPage.getByLabel("Board name", { exact: true })).toHaveValue("Launch");
  const dialog = memberPage.getByRole("dialog", { name: "Card Later task" });
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "Close" }).click();
  await expect(dialog).toHaveCount(0);

  await memberPage.getByRole("button", { name: "My work" }).click();
  await work.getByRole("button", { name: /Later task/ }).click();
  await expect(dialog).toBeVisible();
  await memberContext.close();
});
