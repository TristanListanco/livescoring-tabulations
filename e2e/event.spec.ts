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
// The organizer drives judging: judges wait for the session to start and score the entry they're shown.
const RUN = Date.now().toString(36);
const NAME = `E2E ${RUN}`;
const ORGANIZER = { name: `E2E Organizer ${RUN}`, email: `e2e-${RUN}@example.com`, password: `e2e-pass-${RUN}` };
const OTHER = { name: `E2E Other ${RUN}`, email: `e2e-other-${RUN}@example.com`, password: `e2e-pass-other-${RUN}` };
const REALTIME = { timeout: 20_000 };

let adminPath = "";
let livePath = "";
let ledPath = "";
let codes: string[] = [];

// Devices that stay open through the event, like real judges' phones and the venue screen.
let judge1: Page;
let judge2: Page;
let live: Page;
// Someone else who got hold of Ana's QR code.
let intruder: Page;

/** A page in its own context, the way a separate device would see the app. */
async function openDevice(browser: Browser, options: BrowserContextOptions = {}) {
  const context = await browser.newContext(options);
  return context.newPage();
}

const heading = (page: Page) => page.getByRole("heading", { level: 1 });

/** The pairing code a waiting device shows, for the organizer to match. */
async function pairingCode(page: Page) {
  const text = await page.locator("p").filter({ hasText: /^Pairing code [A-Z0-9]{4}$/ }).textContent();
  return text!.replace("Pairing code ", "");
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

/** The organizer's Session tab, signed in. */
async function openSession(page: Page) {
  await signInAsOrganizer(page, ORGANIZER.email, ORGANIZER.password);
  await page.goto(`${adminPath}?tab=session`);
}

/** The organizer's Access tab, where judges' devices are approved. */
async function openAccess(page: Page) {
  await signInAsOrganizer(page, ORGANIZER.email, ORGANIZER.password);
  await page.goto(`${adminPath}?tab=access`);
}

test.describe.serial("a full event", () => {
  test.beforeAll(async ({ browser }) => {
    judge1 = await openDevice(browser, { ...devices["Pixel 7"] });
    judge2 = await openDevice(browser, { viewport: { width: 1180, height: 820 }, hasTouch: true });
    live = await openDevice(browser);
    intruder = await openDevice(browser, { ...devices["iPhone 13"] });
  });

  test.afterAll(async () => {
    for (const page of [judge1, judge2, live, intruder]) await page?.context().close();
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
    await expectAccessible(page);

    // Signatories print on the organizer's results PDFs.
    await page.getByRole("link", { name: ORGANIZER.name }).click();
    await page.getByRole("button", { name: "Add signatory" }).click();
    await page.getByLabel("Signatory 1 full name").fill("Maria Reyes");
    await page.getByLabel("Signatory 1 designation").fill("Chair, Board of Tabulators");
    // A row left empty isn't saved, and disappears once the rest are.
    await page.getByRole("button", { name: "Add signatory" }).click();
    await expect(page.getByLabel("Signatory 2 full name")).toBeVisible();
    await page.getByRole("button", { name: "Save signatories" }).click();
    await expect(page.getByText("Saved. 1 signatory prints on the results PDF.")).toBeVisible();
    await expect(page.getByLabel("Signatory 2 full name")).toHaveCount(0);
  });

  test("an organizer signs in, sees their profile and creates an activity", async ({ page }) => {
    await signInAsOrganizer(page, ORGANIZER.email, ORGANIZER.password);
    const header = page.getByRole("banner");
    await expect(header).toContainText(ORGANIZER.name);
    await expect(header).toContainText(ORGANIZER.email);
    const photo = header.locator('img[src*="/organizer-photos/"]');
    await expect.poll(() => photo.evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth > 0)).toBe(true);
    await expect(page.getByText("No activities yet")).toBeVisible();
    await page.getByRole("link", { name: /Your profile|E2E Organizer/ }).first().click();
    await expect(page).toHaveURL(/\/admin\/profile$/);
    await expect(page.getByLabel("Signatory 1 full name")).toHaveValue("Maria Reyes");
    await page.goto("/admin");

    await page.getByRole("link", { name: "New activity" }).first().click();
    await page.getByLabel("Name", { exact: true }).fill(NAME);
    await page.getByRole("button", { name: "Remove a judge" }).click();
    await page.getByLabel("Judge 1 first name").fill("Ana");
    await page.getByLabel("Judge 1 last name").fill("Cruz");
    await page.getByLabel("Judge 2 first name").fill("Ben");
    await page.getByLabel("Judge 2 last name").fill("Torres");
    // Ben chairs the board of judges: he can move entries from his own screen. Picking a chair is required.
    await page.getByRole("radio", { name: "Chair of the board of judges: judge 2" }).check();
    await page.getByLabel("Photo for Ana Cruz").setInputFiles(PHOTO);
    await expect(page.locator('img[src^="blob:"]')).toHaveCount(1);
    await page.getByLabel("Entry names, one per line").fill("Agila\nBagwis\nKidlat");
    await page.getByRole("button", { name: "Create activity" }).click();

    // Creating an activity uploads photos and writes several tables; allow for a slow network.
    await expect(page).toHaveURL(/\/admin\/[0-9a-f-]{36}$/, { timeout: 20_000 });
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(NAME);
    await expect(page.getByRole("link", { name: "Not started" })).toBeVisible();
    adminPath = new URL(page.url()).pathname;

    const codeTexts = await page.locator("p").filter({ hasText: /^Code [A-Z0-9]{6}$/ }).allTextContents();
    codes = codeTexts.map((t) => t.replace("Code ", ""));
    expect(codes).toHaveLength(2);
    // Judges' codes show without copy buttons or links; the header has no live results button or rules line.
    await expect(page.getByRole("button", { name: "Copy link" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Copy code" })).toHaveCount(0);
    await expect(page.getByRole("link", { name: "Open live results" })).toHaveCount(0);
    await expect(page.getByText(/^Scores from 1 to 10/)).toHaveCount(0);
    await expectAccessible(page);
    await page.goto(`${adminPath}?tab=led`);
    ledPath = new URL((await page.locator("code").allTextContents()).find((l) => l.includes("/led/"))!).pathname;
    // The public live results link and its QR code are in the Session tab.
    await page.goto(`${adminPath}?tab=session`);
    livePath = new URL((await page.locator("code").allTextContents()).find((l) => l.includes("/live/"))!).pathname;
    await expect(page.getByRole("img", { name: "QR code for the live results page" })).toBeVisible();
  });

  test("only the device the organizer approves can judge", async ({ page }) => {
    await judge1.goto(`/judge/join/${codes[0]}`);
    await expect(judge1).toHaveURL(/\/judge\/score$/);
    await expect(heading(judge1)).toHaveText("Waiting for the organizer to approve this device");
    await expect(judge1.getByRole("button", { name: "5", exact: true })).toHaveCount(0);
    const code1 = await pairingCode(judge1);
    await snap(judge1, "judge device waiting for approval");
    await expectAccessible(judge1);

    await judge2.goto("/judge");
    await judge2.getByLabel("Judge code").fill(codes[1].toLowerCase());
    await judge2.getByRole("button", { name: "Start judging" }).click();
    await expect(heading(judge2)).toHaveText("Waiting for the organizer to approve this device");
    const code2 = await pairingCode(judge2);

    // Someone else scans Ana's QR code too: their request shows a different pairing code.
    await intruder.goto(`/judge/join/${codes[0]}`);
    const intruderCode = await pairingCode(intruder);
    expect(intruderCode).not.toBe(code1);

    // Devices are approved from the Access tab, next to each judge's code.
    await openAccess(page);
    await expect(page.getByRole("link", { name: "3 devices waiting for approval" })).toBeVisible();
    await expect(page.getByText("3 devices are waiting for approval.")).toBeVisible();
    await page.getByRole("button", { name: `Approve Ana Cruz's device ${code1}` }).click();
    await page.getByRole("button", { name: `Approve Ben Torres's device ${code2}` }).click();
    await expect(heading(judge1)).toHaveText("Waiting for the organizer to start", REALTIME);
    await expect(heading(judge2)).toHaveText("Waiting for the organizer to start", REALTIME);

    // Approving Ana's phone signed out every other device for her, including the intruder's.
    await expect(heading(intruder)).toHaveText("This device isn't approved", REALTIME);
    await expect(page.getByRole("button", { name: `Approve Ana Cruz's device ${intruderCode}` })).toHaveCount(0);
    await expect(page.getByText("Approved: Android phone · Chrome")).toBeVisible();
    await expect(page.getByRole("listitem").filter({ hasText: "Ben Torres" }).first()).toContainText("Chair");
    await snap(page, "access tab, judge devices");

    await live.goto(livePath);
    await expect(live.getByRole("status")).toHaveText("Live", { timeout: 30_000 });
  });

  test("starting the session opens the judges' screens and locks the panel", async ({ page }) => {
    await openSession(page);
    await page.getByRole("button", { name: "Start session" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Start session" }).click();
    await expect(page.getByText("Session: Live")).toBeVisible();
    await expect(heading(judge1)).toHaveText("Waiting for the first entry", REALTIME);
    // Ben chairs the board of judges, so instead of waiting he can show the first entry himself.
    await expect(heading(judge2)).toHaveText("Ready for the first entry", REALTIME);
    await expect(judge2.getByRole("region", { name: "Chair of the board of judges" }).getByRole("button", { name: "Show first entry: Agila" })).toBeEnabled();

    // Judges are locked; entries can be added and renamed, but not reordered.
    await page.goto(`${adminPath}?tab=judges`);
    await expect(page.getByRole("note")).toHaveText("Judges can't change once the session has started.");
    await expect(page.getByLabel("First name")).toHaveCount(0);
    // The chair is shown in the panel, fixed since the activity was created.
    await expect(page.getByRole("listitem").filter({ hasText: "Chair of the board of judges" })).toHaveCount(1);
    await expect(page.getByRole("listitem").filter({ hasText: "Chair of the board of judges" })).toContainText("Ben Torres");
    await expect(page.getByLabel("Add a judge")).toHaveCount(0);

    await page.goto(`${adminPath}?tab=entries`);
    await expect(page.getByRole("button", { name: "Move Agila down" })).toBeDisabled();
    // Photos can still change: they're only for the LED wall.
    await page.getByLabel("Photo for Agila").setInputFiles(PHOTO);
    await expect(page.getByRole("button", { name: "Remove photo" })).toBeVisible();
    await page.getByLabel("Add entries, one per line").fill("Dalisay");
    await page.getByRole("button", { name: "Add entries" }).click();
    await expect(page.getByText("Dalisay added.")).toBeVisible();
    const dalisay = page.getByRole("listitem").filter({ has: page.getByRole("button", { name: "Move Dalisay up" }) });
    await dalisay.getByRole("button", { name: "Remove" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Remove entry" }).click();
    await expect(page.getByRole("button", { name: "Move Dalisay up" })).toHaveCount(0);
  });

  test("judges score the entry the organizer shows, and nothing else", async ({ page }) => {
    await openSession(page);
    await page.getByRole("button", { name: "Show first entry" }).click();
    await expect(heading(judge1)).toHaveText("Agila", REALTIME);
    await expect(heading(judge2)).toHaveText("Agila", REALTIME);
    // Judges can't pick entries themselves.
    await expect(judge2.getByRole("button", { name: /Bagwis/ })).toHaveCount(0);

    // The keypad accepts 11, but it's out of range: the judge is told straight away and can't submit it.
    await tapScore(judge1, "11");
    await expect(judge1.getByRole("alert").filter({ hasText: "above the maximum" })).toHaveText(
      "11 is above the maximum of 10. Clear it and type a lower score.",
    );
    await expect(judge1.getByRole("button", { name: "Submit score" })).toBeDisabled();
    await snap(judge1, "judge typed a score above the max");
    await judge1.getByRole("button", { name: "Clear" }).click();

    await submitScore(judge1, "Agila", "9.75");
    await expect(heading(judge1)).toHaveText("Waiting for the next entry");
    await expect(live.locator("li[data-entry]", { hasText: "Agila" })).toContainText("9.75", REALTIME);
    // The live results call judges by their first names.
    await expect(live.getByText("Ana", { exact: true }).first()).toBeVisible();
    await expect(live.getByText("Ana Cruz")).toHaveCount(0);
    await expect(page.getByText("1 of 2 judges have scored.")).toBeVisible(REALTIME);
    await snap(judge1, "judge waiting for the next entry");
    await snap(page, "session tab, one judge in");
    await expectAccessible(judge1);
  });

  test("the LED wall follows the display settings", async ({ page, browser }) => {
    const led = await openDevice(browser, { viewport: { width: 1920, height: 1080 } });
    await led.goto(ledPath);
    expect(await ledBackground(led)).toBe("rgb(0, 255, 0)");

    await signInAsOrganizer(page, ORGANIZER.email, ORGANIZER.password);
    await page.goto(`${adminPath}?tab=led`);
    // Showing judges Agila put it on the LED wall too. Judges go by their first names there.
    await expect(led.getByText("Agila", { exact: true })).toBeVisible(REALTIME);
    await expect(led.getByText("Ana", { exact: true })).toBeVisible();
    await expect(led.getByText("Ben", { exact: true })).toBeVisible();
    await expect(led.getByText("Ana Cruz", { exact: true })).toHaveCount(0);
    // Only Ana has scored, so her 9.75 is both her score and the running average.
    await expect(led.getByText("9.75", { exact: true })).toHaveCount(2);
    // Agila's photo sits beside the name.
    await expect.poll(() => led.locator("img[data-entry-photo]").evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth > 0)).toBe(true);

    await page.getByRole("switch", { name: "Show scores only when every judge has scored" }).click();
    await expect(led.getByText("Scored", { exact: true })).toBeVisible(REALTIME);
    await expect(led.getByText("9.75", { exact: true })).toHaveCount(0);

    await page.getByLabel("Full screen").check();
    await expect.poll(() => ledBackground(led), REALTIME).toBe("rgb(11, 37, 69)");
    await expect(led.getByText("Scored", { exact: true })).toBeVisible();
    await expect(led.locator("img[data-entry-photo]")).toBeVisible();

    // Entries and scores can wipe in instead of fading.
    await expect(led.locator('[data-transition="fade"]')).toHaveCount(1);
    await page.getByLabel("Wipe").check();
    await expect(led.locator('[data-transition="wipe"]')).toHaveCount(1, REALTIME);
    await led.context().close();
  });

  test("the organizer moves through the entries as the judges finish", async ({ page, browser }) => {
    await openSession(page);
    await submitScore(judge2, "Agila", "9.25");
    await expect(page.getByText("Every judge has scored Agila.")).toBeVisible(REALTIME);

    // Agila is on the full-screen LED wall with scores held: now every judge is in, so all show.
    const led = await openDevice(browser, { viewport: { width: 1920, height: 1080 } });
    await led.goto(ledPath);
    await expect(led.getByText("9.50", { exact: true })).toBeVisible();
    await expect(led.getByText("Scored", { exact: true })).toHaveCount(0);

    // The LED wall moves with the judges.
    await page.getByRole("button", { name: "Show next entry: Bagwis" }).click();
    await expect(heading(judge1)).toHaveText("Bagwis", REALTIME);
    await expect(led.getByText("Bagwis", { exact: true })).toBeVisible(REALTIME);
    await submitScore(judge1, "Bagwis", "8.5", "8.50");
    await expect(heading(judge2)).toHaveText("Bagwis", REALTIME);
    await submitScore(judge2, "Bagwis", "8.75");
    await expect(page.getByText("Every judge has scored Bagwis.")).toBeVisible(REALTIME);

    // Ben, the chair, moves to the next entry from his own screen. Ana can't.
    await expect(heading(judge2)).toHaveText("Your score is in");
    const chair = judge2.getByRole("region", { name: "Chair of the board of judges" });
    await expect(chair.getByRole("status")).toHaveText("Every judge has scored Bagwis.", REALTIME);
    await snap(judge2, "chair after scoring");
    await expect(judge1.getByRole("button", { name: /^Next/ })).toHaveCount(0);
    await chair.getByRole("button", { name: "Next: Kidlat" }).click();
    await expect(heading(judge1)).toHaveText("Kidlat", REALTIME);
    await expect(led.getByText("Kidlat", { exact: true })).toBeVisible(REALTIME);
    await expect(page.getByText("Now judging: No. 3")).toBeVisible(REALTIME);
    await led.context().close();
    await submitScore(judge1, "Kidlat", "9", "9.00");
    await expect(heading(judge2)).toHaveText("Kidlat", REALTIME);
    await submitScore(judge2, "Kidlat", "9.5", "9.50");
    await expect(page.getByText(/That was the last entry/)).toBeVisible(REALTIME);
    await expect(page.getByRole("button", { name: "No more entries" })).toBeDisabled();

    // Averages: Agila 9.50, Kidlat 9.25, Bagwis 8.625 shown as 8.63.
    await expect.poll(() => boardOrder(live), REALTIME).toEqual(["Agila", "Kidlat", "Bagwis"]);
    await expect(live.locator("li[data-entry]").nth(0)).toContainText("Rank 1");
    await expect(live.locator("li[data-entry]").nth(2)).toContainText("8.63");
    await snap(page, "session tab, last entry done");
  });

  test("hiding ranks switches the public board to running order", async ({ page }) => {
    await signInAsOrganizer(page, ORGANIZER.email, ORGANIZER.password);
    await page.goto(`${adminPath}?tab=settings`);
    const toggle = page.getByRole("switch", { name: "Show ranks on the live results page" });
    await toggle.click();
    await expect(page.getByRole("status")).toHaveText("Rankings are hidden on the live results page.");
    await expect.poll(() => boardOrder(live), REALTIME).toEqual(["Agila", "Bagwis", "Kidlat"]);
    await toggle.click();
    await expect(page.getByRole("status")).toHaveText("Rankings are showing on the live results page.");
    await expect.poll(() => boardOrder(live), REALTIME).toEqual(["Agila", "Kidlat", "Bagwis"]);
  });

  test("scoring can't be changed once the activity is created", async ({ page }) => {
    await signInAsOrganizer(page, ORGANIZER.email, ORGANIZER.password);
    await page.goto(`${adminPath}?tab=settings`);
    const scoring = page.locator("dl");
    await expect(scoring).toContainText("Simple, scores from 1 to 10");
    await expect(scoring).toContainText("Results show2 decimal places");
    for (const field of ["Min score", "Max score", "Decimal places shown in results"]) await expect(page.getByLabel(field)).toHaveCount(0);
    await expect(page.getByRole("radio")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Save name" })).toBeVisible();
  });

  test("the admin panel has a dark mode, remembered in this browser", async ({ page }) => {
    await signInAsOrganizer(page, ORGANIZER.email, ORGANIZER.password);
    await page.goto(`${adminPath}?tab=access`);
    const toggle = page.getByRole("button", { name: "Dark mode" });
    const panel = page.locator("[data-admin-theme]");
    await expect(toggle).toHaveAttribute("aria-pressed", "false");
    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-pressed", "true");
    await expect(panel).toHaveCSS("background-color", "rgb(11, 23, 40)");
    await expectAccessible(page);
    await snap(page, "access tab, dark mode");

    await page.goto(`${adminPath}?tab=session`);
    await expect(panel).toHaveCSS("background-color", "rgb(11, 23, 40)");
    await expectAccessible(page);
    await snap(page, "session tab, dark mode");
  });

  test("the results PDF downloads with a report ID", async ({ page }) => {
    await signInAsOrganizer(page, ORGANIZER.email, ORGANIZER.password);
    await page.goto(`${adminPath}?tab=settings`);
    await expect(page.getByText(/^Report ID LS-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}/)).toBeVisible();
    const [download] = await Promise.all([
      page.waitForEvent("download"),
      page.getByRole("link", { name: "Download results PDF" }).click(),
    ]);
    expect(download.suggestedFilename()).toMatch(/^e2e-[a-z0-9]+-results\.pdf$/);
    expect(readFileSync(await download.path()).subarray(0, 5).toString()).toBe("%PDF-");
  });

  test("ending the session closes the judges' screens", async ({ page }) => {
    await openSession(page);
    // Ending takes the organizer's password.
    await page.getByRole("button", { name: "End session" }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByRole("button", { name: "End session" })).toBeDisabled();
    await dialog.getByLabel("Your password").fill("not the password");
    await dialog.getByRole("button", { name: "End session" }).click();
    await expect(dialog.getByRole("alert")).toHaveText("That password isn't right.");
    await dialog.getByLabel("Your password").fill(ORGANIZER.password);
    await dialog.getByRole("button", { name: "End session" }).click();
    await expect(page.getByText("Session: Ended")).toBeVisible();
    await expect(heading(judge1)).toHaveText("Judging has ended", REALTIME);
    await expect(heading(judge2)).toHaveText("Judging has ended", REALTIME);

    // The running order says every entry was judged, with nothing left to judge.
    const order = page.getByRole("region", { name: "Running order" });
    await expect(order.getByText("Judged", { exact: true })).toHaveCount(3);
    await expect(order.getByText("Now judging", { exact: true })).toHaveCount(0);
    await expect(order.getByRole("button", { name: "Judge now" })).toHaveCount(0);

    // Entries can't change once judging has ended.
    await page.goto(`${adminPath}?tab=entries`);
    await expect(page.getByRole("note")).toHaveText("Judging has ended, so entries can't be changed.");
    await expect(page.getByLabel("Entry 1 name")).toBeDisabled();
    await expect(page.getByLabel("Add entries, one per line")).toHaveCount(0);
  });

  test("another organizer can't see or export this activity", async ({ page }) => {
    await signInAsOrganizer(page, OTHER.email, OTHER.password);
    await expect(page.getByRole("link", { name: NAME })).toHaveCount(0);
    await page.goto(adminPath);
    await expect(page.getByRole("heading", { name: "This page doesn't exist" })).toBeVisible();
    expect((await page.request.get(`${adminPath}/export`)).status()).toBe(404);
  });

  test("the super admin sees only the name of an organizer's activity", async ({ page }) => {
    await signInAsSuperAdmin(page);
    const theirs = page.getByRole("region", { name: "Organizers' activities" });
    await expect(theirs.getByRole("row").filter({ hasText: NAME })).toContainText(ORGANIZER.name);
    await expect(page.getByRole("link", { name: NAME })).toHaveCount(0);
    await expect(theirs).not.toContainText("Scores in");

    // Not openable or exportable by address either.
    await page.goto(`${adminPath}?tab=settings`);
    await expect(page.getByRole("heading", { name: "This page doesn't exist" })).toBeVisible();
    expect((await page.request.get(`${adminPath}/export`)).status()).toBe(404);

    // The organizer's page lists it by name, without a link.
    await page.goto("/admin/organizers");
    await page.getByRole("link", { name: ORGANIZER.name }).click();
    await expect(page.getByRole("listitem").filter({ hasText: NAME })).toBeVisible();
    await expect(page.getByRole("link", { name: NAME })).toHaveCount(0);
  });

  test("resetting scores puts the session back to not started, then the activity is deleted", async ({ page }) => {
    await signInAsOrganizer(page, ORGANIZER.email, ORGANIZER.password);
    await page.goto(`${adminPath}?tab=developer`);

    await page.getByRole("button", { name: "Reset scores" }).click();
    let dialog = page.getByRole("dialog");
    await expect(dialog.getByRole("button", { name: "Delete all scores" })).toBeDisabled();
    await dialog.getByRole("textbox").fill("RESET");
    await dialog.getByRole("button", { name: "Delete all scores" }).click();
    await expect(page.getByRole("status")).toHaveText("All scores were deleted and the session is back to not started.");
    await expect(page.getByText("0 of 6 scores in")).toBeVisible();
    await expect(page.getByRole("link", { name: "Not started" })).toBeVisible();
    await expect(heading(judge1)).toHaveText("Waiting for the organizer to start", REALTIME);

    // Deleting the activity is in Settings; on the live site there's no Developer tab at all.
    await page.goto(`${adminPath}?tab=settings`);
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
      await page.getByRole("button", { name: "Delete organizer" }).click();
      const dialog = page.getByRole("dialog");
      await dialog.getByRole("textbox").fill(organizer.email);
      await dialog.getByRole("button", { name: "Delete organizer" }).click();
      await expect(page).toHaveURL(/\/admin\/organizers$/);
      await expect(page.getByRole("link", { name: organizer.name })).toHaveCount(0);
    }
  });
});
