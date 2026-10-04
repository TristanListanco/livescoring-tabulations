import { devices, expect, test, type Locator, type Page } from "@playwright/test";
import { deleteActivityNamed, signInAsSuperAdmin, snap, tapScore } from "./helpers";

// A criteria-based activity: points per criterion add up to 100; totals show scaled to 10 or as a percentage.
const NAME = `E2E Criteria ${Date.now().toString(36)}`;
const REALTIME = { timeout: 20_000 };

let adminPath = "";
let livePath = "";
let ledPath = "";

/** Shrunk text stays inside the box it was fitted to, whole: no overflow and nothing cut off. */
function fitsItsBox(text: Locator) {
  return text.evaluate((el) => {
    const box = el.parentElement!.getBoundingClientRect();
    const own = el.getBoundingClientRect();
    return el.scrollWidth <= el.clientWidth + 1 && own.left >= box.left - 1 && own.right <= box.right + 1 && box.width > 0;
  });
}
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
    // Totals as a percentage with four decimal places: the widest numbers the LED wall has to fit.
    await page.getByRole("radio", { name: /As a percentage/ }).check();
    await page.getByLabel("Decimal places shown in results").fill("4");
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
    await expect(page.getByText("Criteria: Innovativeness 30, Design 70. Totals out of 100, shown as a percentage.")).toBeVisible();

    adminPath = new URL(page.url()).pathname;
    code = (await page.locator("p").filter({ hasText: /^Code [A-Z0-9]{6}$/ }).first().textContent())!.replace("Code ", "");
    const links = await page.locator("code").allTextContents();
    livePath = new URL(links.find((l) => l.includes("/live/"))!).pathname;
    ledPath = new URL(links.find((l) => l.includes("/led/"))!).pathname;
  });

  test("a judge scores each criterion on the keypad and the board shows the total", async ({ page, browser }) => {
    await judge.goto(`/judge/join/${code}`);
    const pairing = (await judge.locator("p").filter({ hasText: /^Pairing code [A-Z0-9]{4}$/ }).textContent())!.replace("Pairing code ", "");

    await signInAsSuperAdmin(page);
    await page.goto(`${adminPath}?tab=access`);
    await page.getByRole("button", { name: `Approve Ana Cruz's device ${pairing}` }).click();
    await expect(page.getByText(/^Approved: /)).toBeVisible();
    await page.goto(`${adminPath}?tab=session`);
    await page.getByRole("button", { name: "Start session" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Start session" }).click();
    await page.getByRole("button", { name: "Show first entry" }).click();
    await expect(judge.getByRole("heading", { level: 1 })).toHaveText("Agila", REALTIME);

    // Innovativeness is out of 30, so 35 can't go through, and the judge is told why straight away.
    await expect(judge.getByRole("button", { name: /^Innovativeness/ })).toHaveAttribute("aria-pressed", "true");
    await tapScore(judge, "35");
    // Next.js has its own (empty) alert for route announcements, so look for this one by its text.
    const tooHigh = judge.getByRole("alert").filter({ hasText: "above the maximum" });
    await expect(tooHigh).toHaveText("Innovativeness: 35 is above the maximum of 30. Delete it and type a lower score.");
    await expect(judge.getByRole("button", { name: /^Innovativeness/ })).toContainText("Too high");
    await expect(judge.getByRole("button", { name: "Next: Design" })).toBeDisabled();
    await snap(judge, "criteria keypad above the max");
    await judge.getByRole("button", { name: "Delete last digit" }).click();
    await judge.getByRole("button", { name: "Delete last digit" }).click();
    await expect(tooHigh).toHaveCount(0);
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

    // The judge's 87.5 and the average both show as percentages to four decimal places.
    const live = await (await browser.newContext()).newPage();
    await live.goto(livePath);
    const row = live.locator("li[data-entry]", { hasText: "Agila" });
    await expect(row).toContainText("87.5000%", REALTIME);
    await live.context().close();

    // How totals show is part of the scoring, so it's fixed now.
    await page.goto(`${adminPath}?tab=settings`);
    await expect(page.locator("dl")).toContainText("Totals shownAs a percentage");
    await expect(page.getByRole("radio")).toHaveCount(0);
  });

  test("long percentages shrink to fit the LED wall instead of overflowing", async ({ page, browser }) => {
    // Agila went on the LED wall when the judges were shown it.
    const led = await (await browser.newContext({ viewport: { width: 1920, height: 1080 } })).newPage();
    await led.goto(ledPath);
    await signInAsSuperAdmin(page);
    await page.goto(`${adminPath}?tab=led`);

    // Ana's total and the average are both 87.5000%: wider than their tiles at full size.
    const values = led.getByText("87.5000%", { exact: true });
    await expect(values).toHaveCount(2, REALTIME);
    for (const value of await values.all()) expect(await fitsItsBox(value)).toBe(true);
    await snap(led, "LED overlay with long percentages");

    await page.getByLabel("Full screen").check();
    await expect(led.locator("main > div").first()).toHaveCSS("background-color", "rgb(11, 37, 69)", REALTIME);
    await expect(values).toHaveCount(2);
    for (const value of await values.all()) expect(await fitsItsBox(value)).toBe(true);
    await snap(led, "LED full screen with long percentages");
    await led.context().close();
  });
});
