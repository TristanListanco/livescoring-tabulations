import { readFileSync } from "node:fs";
import { devices, expect, test, type Browser, type BrowserContextOptions } from "@playwright/test";
import { boardOrder, deleteActivityNamed, expectAccessible, PHOTO, signInAsAdmin, submitScore, tapScore } from "./helpers";

// One event from setup to teardown, against a real database. Each step builds on the last.
const NAME = `E2E ${Date.now().toString(36)}`;

let adminPath = "";
let livePath = "";
let ledPath = "";
let codes: string[] = [];

/** A page in its own context, the way a separate device would see the app. */
async function openDevice(browser: Browser, options: BrowserContextOptions = {}) {
  const context = await browser.newContext(options);
  return context.newPage();
}

test.describe.serial("a full event", () => {
  test.afterAll(async () => {
    await deleteActivityNamed(NAME);
  });

  test("admin creates an activity with judges, a photo and entries", async ({ page }) => {
    await signInAsAdmin(page);
    await page.getByRole("link", { name: "New activity" }).first().click();

    await page.getByLabel("Name", { exact: true }).fill(NAME);
    await page.getByRole("button", { name: "Remove a judge" }).click();
    await page.getByLabel("Judge 1 name").fill("Ana Cruz");
    await page.getByLabel("Judge 2 name").fill("Ben Torres");
    await page.getByLabel("Photo for Ana Cruz").setInputFiles(PHOTO);
    await expect(page.locator('img[src^="blob:"]')).toHaveCount(1);
    await page.getByLabel("Entry names, one per line").fill("Agila\nBagwis\nKidlat");
    await page.getByRole("button", { name: "Create activity" }).click();

    await expect(page).toHaveURL(/\/admin\/[0-9a-f-]{36}$/);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(NAME);
    adminPath = new URL(page.url()).pathname;

    const codeTexts = await page.locator("p").filter({ hasText: /^Code [A-Z0-9]{6}$/ }).allTextContents();
    codes = codeTexts.map((t) => t.replace("Code ", ""));
    expect(codes).toHaveLength(2);

    const links = await page.locator("code").allTextContents();
    livePath = new URL(links.find((l) => l.includes("/live/"))!).pathname;
    ledPath = new URL(links.find((l) => l.includes("/led/"))!).pathname;

    // The photo went to storage and is publicly readable.
    const photo = page.locator('img[src*="/judge-photos/"]').first();
    await expect(photo).toBeVisible();
    await expect.poll(() => photo.evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth > 0)).toBe(true);

    await expectAccessible(page);
  });

  test("a judge scores on a phone while the public board updates live", async ({ browser }) => {
    const live = await openDevice(browser);
    await live.goto(livePath);
    await expect(live.getByRole("status")).toHaveText("Live", { timeout: 30_000 });

    const judge = await openDevice(browser, { ...devices["Pixel 7"] });
    await judge.goto(`/judge/join/${codes[0]}`);
    await expect(judge).toHaveURL(/\/judge\/score$/);

    // The keypad accepts 11, but it's out of range, so it can't be submitted.
    await expect(judge.getByRole("heading", { level: 1 })).toHaveText("Agila");
    await tapScore(judge, "11");
    await expect(judge.getByRole("button", { name: "Submit score" })).toBeDisabled();
    await judge.getByRole("button", { name: "Clear" }).click();

    await submitScore(judge, "Agila", "9.75");
    await expect(live.locator("li[data-entry]", { hasText: "Agila" })).toContainText("9.75", { timeout: 20_000 });

    await submitScore(judge, "Bagwis", "8.5", "8.50");
    await submitScore(judge, "Kidlat", "9", "9.00");
    await expect(judge.getByText("You've scored every entry. Thank you!")).toBeVisible();

    // Submitted scores are final.
    await judge.getByRole("button", { name: /Agila/ }).click();
    await expect(judge.getByText("Submitted. Scores can't be changed after submitting.")).toBeVisible();
    await expect(judge.getByRole("button", { name: "5", exact: true })).toHaveCount(0);

    await expectAccessible(judge);
    await expectAccessible(live);
    await judge.context().close();
    await live.context().close();
  });

  test("a second judge signs in by typing their code and the board ranks entries", async ({ browser }) => {
    const judge = await openDevice(browser, { viewport: { width: 1180, height: 820 }, hasTouch: true });
    await judge.goto("/judge");
    await judge.getByLabel("Judge code").fill(codes[1].toLowerCase());
    await judge.getByRole("button", { name: "Start judging" }).click();
    await expect(judge).toHaveURL(/\/judge\/score$/);

    await submitScore(judge, "Agila", "9.25");
    await submitScore(judge, "Bagwis", "8.75");
    await submitScore(judge, "Kidlat", "9.5", "9.50");
    await judge.context().close();

    // Averages: Agila 9.50, Kidlat 9.25, Bagwis 8.625 shown as 8.63.
    const live = await openDevice(browser);
    await live.goto(livePath);
    await expect.poll(() => boardOrder(live)).toEqual(["Agila", "Kidlat", "Bagwis"]);
    const rows = live.locator("li[data-entry]");
    await expect(rows.nth(0)).toContainText("Rank 1");
    await expect(rows.nth(0)).toContainText("9.50");
    await expect(rows.nth(2)).toContainText("8.63");
    await live.context().close();
  });

  test("hiding ranks switches the public board to running order", async ({ page, browser }) => {
    const live = await openDevice(browser);
    await live.goto(livePath);
    await expect(live.getByRole("status")).toHaveText("Live", { timeout: 30_000 });

    await signInAsAdmin(page);
    await page.goto(`${adminPath}?tab=settings`);
    const toggle = page.getByRole("switch", { name: "Show ranks on the live results page" });
    await expect(toggle).toHaveAttribute("aria-checked", "true");

    await toggle.click();
    await expect(page.getByRole("status")).toHaveText("Rankings are hidden on the live results page.");
    await expect.poll(() => boardOrder(live), { timeout: 20_000 }).toEqual(["Agila", "Bagwis", "Kidlat"]);
    await expect(live.locator("li[data-entry]", { hasText: "Rank" })).toHaveCount(0);

    await toggle.click();
    await expect(page.getByRole("status")).toHaveText("Rankings are showing on the live results page.");
    await expect.poll(() => boardOrder(live), { timeout: 20_000 }).toEqual(["Agila", "Kidlat", "Bagwis"]);
    await live.context().close();
  });

  test("the results PDF downloads once all scores are in", async ({ page }) => {
    await signInAsAdmin(page);
    await page.goto(`${adminPath}?tab=settings`);
    const [download] = await Promise.all([
      page.waitForEvent("download"),
      page.getByRole("link", { name: "Download results PDF" }).click(),
    ]);
    expect(download.suggestedFilename()).toMatch(/^e2e-[a-z0-9]+-results\.pdf$/);
    expect(readFileSync(await download.path()).subarray(0, 5).toString()).toBe("%PDF-");
  });

  test("the admin puts entries on the LED wall", async ({ page, browser }) => {
    const led = await openDevice(browser, { viewport: { width: 1920, height: 1080 } });
    await led.goto(ledPath);
    await expect(led.getByText("Agila", { exact: true })).toHaveCount(0);

    await signInAsAdmin(page);
    await page.goto(`${adminPath}?tab=led`);
    await page.getByRole("button", { name: "Show first" }).click();
    await expect(led.getByText("Agila", { exact: true })).toBeVisible({ timeout: 20_000 });
    await expect(led.getByText("9.50", { exact: true })).toBeVisible();
    await expect(led.getByText("Rank 1", { exact: true })).toBeVisible();

    await page.getByRole("button", { name: "Next" }).click();
    await expect(led.getByText("Bagwis", { exact: true })).toBeVisible({ timeout: 20_000 });

    await page.getByRole("button", { name: "Clear screen" }).click();
    await expect(led.getByText("Bagwis", { exact: true })).toHaveCount(0, { timeout: 20_000 });
    await led.context().close();
  });

  test("developer tools reset scores and delete the activity", async ({ page }) => {
    await signInAsAdmin(page);
    await page.goto(`${adminPath}?tab=developer`);

    await page.getByRole("button", { name: "Reset scores" }).click();
    let dialog = page.getByRole("dialog");
    await expect(dialog.getByRole("button", { name: "Delete all scores" })).toBeDisabled();
    await dialog.getByRole("textbox").fill("RESET");
    await dialog.getByRole("button", { name: "Delete all scores" }).click();
    await expect(page.getByRole("status")).toHaveText("All scores were deleted.");
    await expect(page.getByText("0 of 6 scores in")).toBeVisible();

    await page.getByRole("button", { name: "Delete activity" }).click();
    dialog = page.getByRole("dialog");
    await dialog.getByRole("textbox").fill(NAME);
    await dialog.getByRole("button", { name: "Delete activity" }).click();
    await expect(page).toHaveURL(/\/admin$/);
    await expect(page.getByRole("link", { name: NAME })).toHaveCount(0);
  });
});
