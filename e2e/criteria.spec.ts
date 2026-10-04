import { devices, expect, test, type Page } from "@playwright/test";
import { deleteActivityNamed, signInAsSuperAdmin, tapScore } from "./helpers";

// A criteria-based activity: points per criterion add up to 100; totals show scaled to 10 or as a percentage.
const NAME = `E2E Criteria ${Date.now().toString(36)}`;
const REALTIME = { timeout: 20_000 };

let adminPath = "";
let livePath = "";
let code = "";
let judge: Page;

test.describe.serial("criteria scoring", () => {
  test.beforeAll(async ({ browser }) => {
    judge = await (await browser.newContext({ ...devices["Pixel 7"] })).newPage();
  });

  test.afterAll(async () => {
    await judge?.context().close();
    await deleteActivityNamed(NAME);
  });

  test("the organizer sets criteria that must add up to 100", async ({ page }) => {
    await signInAsSuperAdmin(page);
    await page.goto("/admin/new");
    await page.getByLabel("Name", { exact: true }).fill(NAME);
    await page.getByRole("radio", { name: /^Criteria/ }).check();
    await page.getByLabel("Criterion 1 name").fill("Innovativeness");
    await page.getByLabel("Criterion 1 max points").fill("30");
    await page.getByLabel("Criterion 2 name").fill("Design");
    await page.getByLabel("Criterion 2 max points").fill("60");
    await page.getByRole("radio", { name: /1 decimal place/ }).check();
    await page.getByRole("radio", { name: /Scaled to 10/ }).check();
    await page.getByRole("button", { name: "Remove a judge" }).click();
    await page.getByRole("button", { name: "Remove a judge" }).click();
    await page.getByLabel("Judge 1 name").fill("Ana Cruz");
    await page.getByLabel("Entry names, one per line").fill("Agila");

    await expect(page.getByText("Total 90 of 100 points. The criteria must add up to 100.")).toBeVisible();
    await page.getByRole("button", { name: "Create activity" }).click();
    await expect(page.getByRole("alert").filter({ hasText: "add up to 90 points" })).toBeVisible();

    await page.getByLabel("Criterion 2 max points").fill("70");
    await expect(page.getByText("Total 100 of 100 points")).toBeVisible();
    await page.getByRole("button", { name: "Create activity" }).click();
    // Creating an activity uploads photos and writes several tables; allow for a slow network.
    await expect(page).toHaveURL(/\/admin\/[0-9a-f-]{36}$/, { timeout: 20_000 });
    await expect(page.getByText("Criteria: Innovativeness 30, Design 70. Totals out of 100, shown scaled to 10.")).toBeVisible();

    adminPath = new URL(page.url()).pathname;
    code = (await page.locator("p").filter({ hasText: /^Code [A-Z0-9]{6}$/ }).first().textContent())!.replace("Code ", "");
    livePath = new URL((await page.locator("code").allTextContents()).find((l) => l.includes("/live/"))!).pathname;
  });

  test("a judge scores each criterion on the keypad and the board shows the total", async ({ page, browser }) => {
    await judge.goto(`/judge/join/${code}`);
    const pairing = (await judge.locator("p").filter({ hasText: /^Pairing code [A-Z0-9]{4}$/ }).textContent())!.replace("Pairing code ", "");

    await signInAsSuperAdmin(page);
    await page.goto(`${adminPath}?tab=session`);
    await page.getByRole("button", { name: `Approve Ana Cruz's device ${pairing}` }).click();
    await page.getByRole("button", { name: "Start session" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Start session" }).click();
    await page.getByRole("button", { name: "Show first entry" }).click();
    await expect(judge.getByRole("heading", { level: 1 })).toHaveText("Agila", REALTIME);

    // Innovativeness is out of 30, so 35 can't go through.
    await expect(judge.getByRole("button", { name: /^Innovativeness/ })).toHaveAttribute("aria-pressed", "true");
    await tapScore(judge, "35");
    await expect(judge.getByRole("button", { name: "Next: Design" })).toBeDisabled();
    await judge.getByRole("button", { name: "Delete last digit" }).click();
    await judge.getByRole("button", { name: "Delete last digit" }).click();
    await tapScore(judge, "25");
    await judge.getByRole("button", { name: "Next: Design" }).click();
    await expect(judge.getByRole("button", { name: /^Design/ })).toHaveAttribute("aria-pressed", "true");
    await tapScore(judge, "62.5");
    await expect(judge.getByText("87.5", { exact: true }).first()).toBeVisible();

    await judge.getByRole("button", { name: "Submit score" }).click();
    const dialog = judge.getByRole("dialog");
    await expect(dialog).toContainText("Innovativeness");
    await expect(dialog).toContainText("87.5");
    await dialog.getByRole("button", { name: "Submit", exact: true }).click();
    await expect(judge.getByRole("status").filter({ hasText: "Saved" })).toHaveText("Saved 87.5 / 100 for Agila");

    // Scaled to 10: the judge's 87.5 shows as 8.75, and so does the average.
    const live = await (await browser.newContext()).newPage();
    await live.goto(livePath);
    const row = live.locator("li[data-entry]", { hasText: "Agila" });
    await expect(row).toContainText("8.75", REALTIME);

    await page.goto(`${adminPath}?tab=settings`);
    await page.getByRole("radio", { name: /As a percentage/ }).check();
    await expect(page.getByText("Totals are shown as percentages.")).toBeVisible();
    await expect(row).toContainText("87.50%", REALTIME);
    await expect(row).toContainText("87.5%");
    await live.context().close();
  });
});
