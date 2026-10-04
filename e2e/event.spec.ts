import { readFileSync } from "node:fs";
import { devices, expect, test, type Browser, type BrowserContextOptions, type Page } from "@playwright/test";
import {
  boardOrder,
  deleteActivityNamed,
  deleteOrganizerByEmail,
  expectAccessible,
  PHOTO,
  signInAsOrganizer,
  signInAsSuperAdmin,
  snap,
  submitScore,
  tapScore,
} from "./helpers";

// One event from account setup to teardown, against a real database. Each step builds on the last.
const RUN = Date.now().toString(36);
const NAME = `E2E ${RUN}`;
const ORGANIZER = { name: `E2E Organizer ${RUN}`, email: `e2e-${RUN}@example.com`, password: `e2e-pass-${RUN}` };
const OTHER = { name: `E2E Other ${RUN}`, email: `e2e-other-${RUN}@example.com`, password: `e2e-pass-other-${RUN}` };

let adminPath = "";
let livePath = "";
let ledPath = "";
let codes: string[] = [];

/** A page in its own context, the way a separate device would see the app. */
async function openDevice(browser: Browser, options: BrowserContextOptions = {}) {
  const context = await browser.newContext(options);
  return context.newPage();
}

/** Background colour of the LED output: chroma green for the overlay, navy for full screen. */
function ledBackground(led: Page) {
  return led.locator("main > div").first().evaluate((el) => getComputedStyle(el).backgroundColor);
}

async function createOrganizer(page: Page, organizer: typeof ORGANIZER, withPhoto: boolean) {
  await page.goto("/admin/organizers/new");
  await page.getByLabel("Organizer name").fill(organizer.name);
  await page.getByLabel("Email").fill(organizer.email);
  await page.getByLabel("Password").fill(organizer.password);
  if (withPhoto) {
    await page.getByLabel(`Photo for ${organizer.name}`).setInputFiles(PHOTO);
    await expect(page.locator('img[src^="blob:"]')).toHaveCount(1);
  }
  await page.getByRole("button", { name: "Create organizer" }).click();
  await expect(page).toHaveURL(/\/admin\/organizers$/);
  await expect(page.getByRole("link", { name: organizer.name })).toBeVisible();
}

test.describe.serial("a full event", () => {
  test.afterAll(async () => {
    await deleteActivityNamed(NAME);
    await deleteOrganizerByEmail(ORGANIZER.email);
    await deleteOrganizerByEmail(OTHER.email);
  });

  test("the super admin creates organizer accounts", async ({ page }) => {
    await signInAsSuperAdmin(page);
    await expect(page.getByText("Super admin", { exact: true })).toBeVisible();
    await page.getByRole("link", { name: "Organizers" }).click();
    await createOrganizer(page, ORGANIZER, true);
    await createOrganizer(page, OTHER, false);
    await snap(page, "organizers list");
    await expectAccessible(page);
  });

  test("an organizer signs in, sees their profile and creates an activity", async ({ page }) => {
    await signInAsOrganizer(page, ORGANIZER.email, ORGANIZER.password);
    const header = page.getByRole("banner");
    await expect(header).toContainText(ORGANIZER.name);
    await expect(header).toContainText(ORGANIZER.email);
    const photo = header.locator('img[src*="/organizer-photos/"]');
    await expect.poll(() => photo.evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth > 0)).toBe(true);
    await expect(page.getByText("No activities yet")).toBeVisible();
    await snap(page, "organizer signed in");

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

    const judgePhoto = page.locator('img[src*="/judge-photos/"]').first();
    await expect.poll(() => judgePhoto.evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth > 0)).toBe(true);
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

  test("the LED wall follows the display settings", async ({ page, browser }) => {
    const led = await openDevice(browser, { viewport: { width: 1920, height: 1080 } });
    await led.goto(ledPath);
    expect(await ledBackground(led)).toBe("rgb(0, 255, 0)");
    await expect(led.getByText("Agila", { exact: true })).toHaveCount(0);

    await signInAsOrganizer(page, ORGANIZER.email, ORGANIZER.password);
    await page.goto(`${adminPath}?tab=led`);
    await page.getByRole("button", { name: "Show first" }).click();
    // Only Ana has scored, so her 9.75 is both her score and the running average.
    await expect(led.getByText("Agila", { exact: true })).toBeVisible({ timeout: 20_000 });
    await expect(led.getByText("9.75", { exact: true })).toHaveCount(2);
    await expect(led.getByText("Rank 1")).toHaveCount(0);

    await page.getByRole("switch", { name: "Show scores only when every judge has scored" }).click();
    await expect(led.getByText("Scored", { exact: true })).toBeVisible({ timeout: 20_000 });
    await expect(led.getByText("9.75", { exact: true })).toHaveCount(0);
    await snap(led, "LED overlay, scores held");

    await page.getByLabel("Full screen").check();
    await expect.poll(() => ledBackground(led), { timeout: 20_000 }).toBe("rgb(11, 37, 69)");
    await expect(led.getByText("Agila", { exact: true })).toBeVisible();
    await expect(led.getByText("Scored", { exact: true })).toBeVisible();
    await snap(led, "LED full screen, scores held");
    await snap(page, "LED wall tab");
    await led.context().close();
  });

  test("a second judge completes the scores and the LED wall reveals them", async ({ browser }) => {
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
    await expect(live.locator("li[data-entry]").nth(0)).toContainText("Rank 1");
    await expect(live.locator("li[data-entry]").nth(2)).toContainText("8.63");
    await live.context().close();

    // Agila is still on the wall, full screen with scores held: now every judge is in, so all show.
    const led = await openDevice(browser, { viewport: { width: 1920, height: 1080 } });
    await led.goto(ledPath);
    await expect(led.getByText("9.50", { exact: true })).toBeVisible();
    await expect(led.getByText("9.25", { exact: true })).toBeVisible();
    await expect(led.getByText("Scored", { exact: true })).toHaveCount(0);
    await snap(led, "LED full screen, all scores in");
    await led.context().close();
  });

  test("clearing the full-screen LED wall shows the activity name", async ({ page, browser }) => {
    const led = await openDevice(browser, { viewport: { width: 1920, height: 1080 } });
    await led.goto(ledPath);
    await signInAsOrganizer(page, ORGANIZER.email, ORGANIZER.password);
    await page.goto(`${adminPath}?tab=led`);
    await page.getByRole("button", { name: "Clear screen" }).click();
    await expect(led.getByText("Agila", { exact: true })).toHaveCount(0, { timeout: 20_000 });
    await expect(led.getByText(NAME, { exact: true })).toBeVisible();
    await led.context().close();
  });

  test("hiding ranks switches the public board to running order", async ({ page, browser }) => {
    const live = await openDevice(browser);
    await live.goto(livePath);
    await expect(live.getByRole("status")).toHaveText("Live", { timeout: 30_000 });

    await signInAsOrganizer(page, ORGANIZER.email, ORGANIZER.password);
    await page.goto(`${adminPath}?tab=settings`);
    const toggle = page.getByRole("switch", { name: "Show ranks on the live results page" });
    await toggle.click();
    await expect(page.getByRole("status")).toHaveText("Rankings are hidden on the live results page.");
    await expect.poll(() => boardOrder(live), { timeout: 20_000 }).toEqual(["Agila", "Bagwis", "Kidlat"]);
    await toggle.click();
    await expect(page.getByRole("status")).toHaveText("Rankings are showing on the live results page.");
    await expect.poll(() => boardOrder(live), { timeout: 20_000 }).toEqual(["Agila", "Kidlat", "Bagwis"]);
    await live.context().close();
  });

  test("the results PDF downloads with a report ID", async ({ page }) => {
    await signInAsOrganizer(page, ORGANIZER.email, ORGANIZER.password);
    await page.goto(`${adminPath}?tab=settings`);
    await expect(page.getByText(/^Report ID LS-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}/)).toBeVisible();
    await snap(page, "settings with report ID");
    const [download] = await Promise.all([
      page.waitForEvent("download"),
      page.getByRole("link", { name: "Download results PDF" }).click(),
    ]);
    expect(download.suggestedFilename()).toMatch(/^e2e-[a-z0-9]+-results\.pdf$/);
    expect(readFileSync(await download.path()).subarray(0, 5).toString()).toBe("%PDF-");
  });

  test("another organizer can't see or export this activity", async ({ page }) => {
    await signInAsOrganizer(page, OTHER.email, OTHER.password);
    await expect(page.getByRole("link", { name: NAME })).toHaveCount(0);
    await page.goto(adminPath);
    await expect(page.getByRole("heading", { name: "This page doesn't exist" })).toBeVisible();
    expect((await page.request.get(`${adminPath}/export`)).status()).toBe(404);
  });

  test("the super admin sees every activity and who organizes it", async ({ page }) => {
    await signInAsSuperAdmin(page);
    const row = page.getByRole("row").filter({ hasText: NAME });
    await expect(row).toContainText(ORGANIZER.name);
    await page.goto(`${adminPath}?tab=settings`);
    await expect(page.getByLabel("Managed by").locator("option:checked")).toContainText(ORGANIZER.name);
  });

  test("the organizer resets scores and deletes the activity", async ({ page }) => {
    await signInAsOrganizer(page, ORGANIZER.email, ORGANIZER.password);
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

  test("the super admin deletes organizer accounts", async ({ page }) => {
    await signInAsSuperAdmin(page);
    for (const organizer of [ORGANIZER, OTHER]) {
      await page.goto("/admin/organizers");
      await page.getByRole("link", { name: organizer.name }).click();
      await expect(page.getByRole("heading", { level: 1 })).toHaveText(organizer.name);
      if (organizer === ORGANIZER) await snap(page, "organizer edit page");
      await page.getByRole("button", { name: "Delete organizer" }).click();
      const dialog = page.getByRole("dialog");
      await dialog.getByRole("textbox").fill(organizer.email);
      await dialog.getByRole("button", { name: "Delete organizer" }).click();
      await expect(page).toHaveURL(/\/admin\/organizers$/);
      await expect(page.getByRole("link", { name: organizer.name })).toHaveCount(0);
    }
  });
});
