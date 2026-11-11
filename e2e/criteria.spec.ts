import { readFileSync } from "node:fs";
import { devices, expect, test, type Locator, type Page } from "@playwright/test";
import { ADMIN_PASSWORD, deleteActivityNamed, expectAccessible, exportFile, openJudgeLink, SAVED, screenPath, signInAsSuperAdmin, snap, tapScore, fillEntries, pickScoring } from "./helpers";

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
    // A guide for judges: what to look for, shown on their screen while they score the criterion. Closed, it says there
    // isn't one yet; opening it puts the cursor in it.
    const guide = page.getByRole("button", { name: /^Guide for judges on Innovativeness/ });
    await expect(guide).toHaveAttribute("aria-expanded", "false");
    await expect(guide).toContainText("None yet");
    await guide.click();
    await expect(page.getByLabel("Guide for judges on Innovativeness")).toBeFocused();
    await page.keyboard.type("Is the idea new?\nDoes it solve a real problem?");
    // Closed again, it shows how it starts.
    await guide.click();
    await expect(guide).toContainText("Is the idea new?");
    await page.getByLabel("Criterion 2 name").fill("Design");
    await page.getByLabel("Criterion 2 max points").fill("60");
    await page.getByRole("group", { name: "Judges give points in" }).getByRole("radio", { name: /1 decimal place/ }).check();
    // Totals as a percentage with four decimal places: the widest numbers the LED wall has to fit.
    await page.getByRole("radio", { name: /As a percentage/ }).check();
    // Results' decimal places are tucked under More options, which says what they are.
    await page.getByText("More options").click();
    await page.getByRole("group", { name: "Decimal places shown in results" }).getByRole("radio", { name: /^4 decimal places/ }).check();
    await page.getByRole("button", { name: "Remove judge 3" }).click();
    await page.getByRole("button", { name: "Remove judge 2" }).click();
    await page.getByLabel("Judge 1 first name").fill("Ana");
    await page.getByLabel("Judge 1 last name").fill("Cruz");
    await fillEntries(page, ["Agila"]);
    // This one scores live.
    await pickScoring(page, { method: "Criteria", decimals: "1 decimal place", live: true });

    // Like a score sheet's "lowest possible score", each criterion can have a lowest score, in points.
    await page.getByLabel("Criterion 1 lowest score").fill("21");
    await page.getByLabel("Criterion 2 lowest score").fill("49");
    await expect(page.getByText("Total 90 of 100 points. The criteria must add up to 100.")).toBeVisible();
    await page.getByLabel("Signatory 1 full name").fill("Maria Reyes");
    await page.getByRole("checkbox", { name: /I have their consent/ }).check();
    await page.getByRole("button", { name: "Create activity" }).click();
    await expect(page.getByRole("alert").filter({ hasText: "add up to 90 points" })).toBeVisible();

    await page.getByLabel("Criterion 2 max points").fill("70");
    await expect(page.getByText("Total 100 of 100 points")).toBeVisible();
    await page.getByRole("button", { name: "Create activity" }).click();
    // Creating an activity uploads photos and writes several tables; allow for a slow network.
    await expect(page).toHaveURL(/\/admin\/[0-9a-f-]{36}$/, { timeout: 20_000 });

    adminPath = new URL(page.url()).pathname;
    code = (await page.locator("p").filter({ hasText: /^Judge code [A-Z0-9]{6}$/ }).first().textContent())!.replace("Judge code ", "");
    await page.goto(`${adminPath}?tab=session`);
    livePath = await screenPath(page, "Open live results");
    await page.goto(`${adminPath}?tab=led`);
    ledPath = new URL((await page.locator("code").allTextContents()).find((l) => l.includes("/led/"))!).pathname;
  });

  test("a judge scores each criterion on the keypad and the board shows the total", async ({ page, browser }) => {
    await openJudgeLink(judge, code);
    const pairing = (await judge.locator("p").filter({ hasText: /^Pairing code [A-Z0-9]{4}$/ }).textContent())!.replace("Pairing code ", "");

    await signInAsSuperAdmin(page);
    await page.goto(`${adminPath}?tab=judges`);
    await page.getByRole("button", { name: `Approve Ana Cruz's device ${pairing}` }).click();
    await expect(page.getByText(/^Approved: /)).toBeVisible();
    await page.goto(`${adminPath}?tab=session`);
    await page.getByRole("button", { name: "Start session" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Start session" }).click();
    await page.getByRole("button", { name: "Show first entry" }).click();
    await expect(judge.getByRole("heading", { level: 1 })).toHaveText("Agila", REALTIME);
    // The criteria keypad meets WCAG 2.1 AA too.
    await expectAccessible(judge);

    // Innovativeness has a guide; Design has none. On a phone it starts closed, so the criteria stay by the keypad.
    const guide = judge.getByRole("button", { name: "Guide for Innovativeness" });
    await expect(guide).toHaveAttribute("aria-expanded", "false");
    await guide.click();
    await expect(judge.getByText(/^Is the idea new\?\s+Does it solve a real problem\?$/)).toBeVisible();

    // It scores live, so each score is final as it goes in: no notes to keep for a deliberation (see deliberation.spec.ts).
    await expect(judge.getByRole("button", { name: "Add notes" })).toHaveCount(0);

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
    // Under the lowest score: the judge is told what it is, and can't move on.
    await tapScore(judge, "20");
    await expect(judge.getByRole("status").filter({ hasText: "The lowest score for Innovativeness is 21." })).toBeVisible();
    await expect(judge.getByRole("button", { name: "Next: Design" })).toBeDisabled();
    // Left that way, the criterion is marked, as one above its maximum is.
    await judge.getByRole("button", { name: /^Design/ }).click();
    await expect(judge.getByRole("button", { name: /^Innovativeness/ })).toContainText("Too low");
    await judge.getByRole("button", { name: /^Innovativeness/ }).click();
    await judge.getByRole("button", { name: "Delete last digit" }).click();
    await judge.getByRole("button", { name: "Delete last digit" }).click();
    await tapScore(judge, "25");
    await judge.getByRole("button", { name: "Next: Design" }).click();
    await expect(judge.getByRole("button", { name: /^Design/ })).toHaveAttribute("aria-pressed", "true");
    await tapScore(judge, "62.5");
    await expect(judge.getByText("87.5", { exact: true }).first()).toBeVisible();

    await expect(judge.getByRole("button", { name: "Guide for Innovativeness" })).toHaveCount(0);

    // Before it goes in, each criterion's points are laid out to check.
    await judge.getByRole("button", { name: "Submit score" }).click();
    const dialog = judge.getByRole("dialog");
    await expect(dialog.getByRole("list", { name: "Points for each criterion" }).getByRole("listitem")).toHaveText([/^Innovativeness\s*25\.0\s*\/ 30$/, /^Design\s*62\.5\s*\/ 70$/]);
    // The event scores live, so the score goes in at once: no seconds to undo it.
    await expect(dialog).toContainText("Once you submit it, it's final, and it shows on the live results at once.");
    await dialog.getByRole("button", { name: "Submit", exact: true }).click();
    await expect(judge.getByRole("button", { name: "Undo" })).toHaveCount(0);
    await expect(judge.getByRole("status").filter({ hasText: "Saved" })).toHaveText("Saved 87.5 / 100 for Agila", SAVED);
    // The event scores live, so a submitted score is final: nothing to ask to correct.
    await expect(judge.getByRole("button", { name: "Ask to correct this score" })).toHaveCount(0);
    // Ana is the only judge and Agila the only entry, so with live scoring this score ends judging by itself. (The points
    // for each criterion under a score that leaves entries to judge: see event-timer.spec.ts.)
    await expect(judge.getByRole("heading", { level: 1 })).toHaveText("Judging has ended", REALTIME);
    // On a phone the count in the header opens the judge's scores, as the list beside the keypad does on a wider screen.
    await judge.getByRole("button", { name: /Show your scores/ }).click();
    const sheet = judge.getByRole("dialog", { name: "Your scores" });
    await expect(sheet.getByRole("listitem").first()).toContainText("87.5");
    await sheet.getByRole("button", { name: "Close" }).click();
    await expect(sheet).toBeHidden();

    // The judge's 87.5 and the average both show as percentages to four decimal places.
    const live = await (await browser.newContext()).newPage();
    await live.goto(livePath);
    const row = live.locator("li[data-entry]", { hasText: "Agila" });
    await expect(row).toContainText("87.5000%", REALTIME);
    await live.context().close();

    // Every score is in, so judging ended by itself (it scores live).
    await page.goto(`${adminPath}?tab=session`);
    await expect(page.getByRole("region", { name: "Judging has ended" })).toBeVisible();

    // How totals show is part of the scoring, so it's fixed now.
    await page.goto(`${adminPath}?tab=settings`);
    // The criteria are listed with their points and the total.
    await expect(page.getByRole("row", { name: "Innovativeness 21 to 30" })).toBeVisible();
    await expect(page.getByRole("row", { name: "Design 49 to 70" })).toBeVisible();
    await expect(page.getByRole("row", { name: "Total 100" })).toBeVisible();
    await expect(page.locator("dl")).toContainText("Totals shownAs a percentage");
    await expect(page.getByRole("radio")).toHaveCount(0);
  });

  test("the judges' score sheets download next to the results", async ({ page }) => {
    // Every score is in (Ana's for Agila), so both PDFs are ready on the desk: Ana's sheet lists her points per criterion.
    await signInAsSuperAdmin(page);
    await page.goto(`${adminPath}?tab=session`);
    const download = await exportFile(page, "Judges' score sheets (PDF)");
    expect(download.suggestedFilename()).toMatch(/^e2e-criteria-[a-z0-9]+-judges-score-sheets\.pdf$/);
    expect(readFileSync(await download.path()).subarray(0, 5).toString()).toBe("%PDF-");
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

  test("on a test site, Settings resets scores and deletes the activity", async ({ page }) => {
    await signInAsSuperAdmin(page);
    await page.goto(`${adminPath}?tab=settings`);
    await expect(page.getByRole("heading", { name: "Test site tools" })).toBeVisible();

    // Every score is in, so judging has ended by itself (it scores live). Deleting asks first.
    await page.getByRole("button", { name: "Delete activity" }).click();
    let dialog = page.getByRole("dialog");
    await expect(dialog).toContainText("permanently deletes");
    await dialog.getByRole("button", { name: "Cancel" }).click();

    // Resetting the scores, with the password, puts the session back to not started.
    await page.getByRole("button", { name: "Reset scores" }).click();
    dialog = page.getByRole("dialog");
    await dialog.getByLabel("Your password").fill(ADMIN_PASSWORD);
    await dialog.getByRole("button", { name: "Reset scores" }).click();
    await expect(dialog).toBeHidden();
    await expect(page.getByRole("link", { name: "Not started" })).toBeVisible();

    await page.getByRole("button", { name: "Delete activity" }).click();
    dialog = page.getByRole("dialog");
    await dialog.getByRole("textbox").fill(NAME);
    await dialog.getByRole("button", { name: "Delete activity" }).click();
    await expect(page).toHaveURL(/\/admin$/);
    await expect(page.getByRole("link", { name: NAME })).toHaveCount(0);
  });
});
