import { readFileSync } from "node:fs";
import { devices, expect, test, type Page } from "@playwright/test";
import { ADMIN_PASSWORD, deleteActivityNamed, expectAccessible, openJudgeLink, SAVED, screenPath, signInAsSuperAdmin, snap, submitScore, tapScore } from "./helpers";

// An event without live scoring, scored to three decimal places. The audience sees no scores until the judges have
// deliberated and signed, and there's no LED wall; a judge corrects their own score, saying why, until they sign.
// Ana judges on a phone and draws her signature; Ben, the chair, judges on a laptop without a touchscreen and ticks (Sgd.).
const NAME = `E2E Deliberation ${Date.now().toString(36)}`;
const REALTIME = { timeout: 20_000 };

let adminPath = "";
let livePath = "";
let codes: string[] = [];
let ana: Page;
let ben: Page;

const pairingCode = async (judge: Page) =>
  (await judge.locator("p").filter({ hasText: /^Pairing code [A-Z0-9]{4}$/ }).textContent())!.replace("Pairing code ", "");

test.describe.serial("deliberation", () => {
  test.beforeAll(async ({ browser }) => {
    ana = await (await browser.newContext({ ...devices["Pixel 7"] })).newPage();
    ben = await (await browser.newContext({ viewport: { width: 1280, height: 800 } })).newPage();
  });

  test.afterAll(async () => {
    await ana?.context().close();
    await ben?.context().close();
    await deleteActivityNamed(NAME);
  });

  test("the organizer sets up an event without live scoring, scored to three decimal places", async ({ page }) => {
    await signInAsSuperAdmin(page);
    await page.goto("/admin/new");
    await page.getByLabel("Name", { exact: true }).fill(NAME);
    await page.getByRole("group", { name: "Judges score with" }).getByRole("radio", { name: /^3 decimal places/ }).check();
    // Live scoring is on unless turned off, and the form says what each choice means.
    const live = page.getByRole("checkbox", { name: /Show scores live/ });
    await expect(live).toBeChecked();
    await live.uncheck();
    await expect(page.getByText(/The audience sees no scores until the judges have deliberated and signed/)).toBeVisible();
    await page.getByRole("button", { name: "Remove judge 3" }).click();
    await page.getByLabel("Judge 1 first name").fill("Ana");
    await page.getByLabel("Judge 1 last name").fill("Cruz");
    await page.getByLabel("Judge 2 first name").fill("Ben");
    await page.getByLabel("Judge 2 last name").fill("Torres");
    await page.getByRole("radio", { name: "Chair of the board of judges: judge 2" }).check();
    await page.getByLabel("Entry names, one per line").fill("Agila\nBagwis");
    await page.getByRole("button", { name: "Create activity" }).click();
    await expect(page).toHaveURL(/\/admin\/[0-9a-f-]{36}$/, { timeout: 20_000 });

    adminPath = new URL(page.url()).pathname;
    codes = (await page.locator("p").filter({ hasText: /^Judge code [A-Z0-9]{6}$/ }).allTextContents()).map((t) => t.replace("Judge code ", ""));
    expect(codes).toHaveLength(2);
    // Settings says so, and it can still change before the session starts.
    await page.goto(`${adminPath}?tab=settings`);
    await expect(page.getByRole("switch", { name: "Show scores live" })).toHaveAttribute("aria-checked", "false");
    await page.goto(`${adminPath}?tab=session`);
    await expect(page.getByText(/Live scoring is off, so the judges deliberate and sign before the results show/)).toBeVisible();
    livePath = await screenPath(page, "Open live results");
  });

  test("judges score to three places, a judge corrects their own score with a reason, and the audience sees no scores", async ({ page }) => {
    await signInAsSuperAdmin(page);
    for (const [judge, code, name] of [
      [ana, codes[0], "Ana Cruz"],
      [ben, codes[1], "Ben Torres"],
    ] as const) {
      await openJudgeLink(judge, code);
      const pairing = await pairingCode(judge);
      await page.goto(`${adminPath}?tab=judges`);
      await page.getByRole("button", { name: `Approve ${name}'s device ${pairing}` }).click();
      await expect(judge.getByRole("heading", { level: 1 })).toHaveText("Waiting for the organizer to start", REALTIME);
    }
    // No LED wall without live scoring: its tab says why, and its page isn't there.
    await page.goto(`${adminPath}?tab=led`);
    await expect(page.getByRole("note")).toContainText("The LED wall is off for this event.");
    await page.goto(`${adminPath}?tab=session`);
    await page.getByRole("button", { name: "Start session" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Start session" }).click();
    await page.getByRole("button", { name: "Show first entry" }).click();

    await expect(ana.getByRole("heading", { level: 1 })).toHaveText("Agila", REALTIME);
    await expect(ana.getByText("Score from 1 to 10, up to 3 decimal places.")).toBeVisible();
    await submitScore(ana, "Agila", "8.125");
    await expect(ben.getByRole("heading", { level: 1 })).toHaveText("Agila", REALTIME);

    // Ana corrects 8.125 to 8.25 herself, saying why, while Ben is still typing his own score.
    await tapScore(ben, "9.5");
    await ana.getByRole("button", { name: "Correct this score" }).click();
    await expect(ana.getByText("Correcting your score", { exact: true })).toBeVisible();
    await tapScore(ana, "8.25");
    await ana.getByRole("button", { name: "Review correction" }).click();
    const fix = ana.getByRole("dialog", { name: "Change your score for Agila?" });
    await expect(fix).toContainText("8.125");
    await expect(fix).toContainText("8.250");
    // The reason is required: it's kept with the correction.
    await expect(fix.getByRole("button", { name: "Change score" })).toBeDisabled();
    await fix.getByLabel("Why does it need correcting?").fill("Misread my sheet: it says 8.25.");
    await fix.getByRole("button", { name: "Change score" }).click();
    await expect(ana.getByText("Corrected from 8.125.")).toBeVisible(REALTIME);
    // The organizer sees it, with its reason, but not the scores: those stay on the private tally until the judges sign.
    const corrections = page.getByRole("region", { name: "Score corrections" });
    await expect(corrections).toContainText("1 settled", REALTIME);
    await corrections.getByText("1 settled").click();
    await expect(corrections).toContainText("Ana Cruz, No. 1 Agila. Misread my sheet: it says 8.25.");
    await expect(corrections).not.toContainText("8.125 to 8.250");
    // Nor does the desk's page carry them for the browser to read: only which judge has scored which entry.
    const desk = await (await page.request.get(`${adminPath}?tab=session`)).text();
    expect(desk).not.toMatch(/value\\?"\s*:\s*8\.(125|25)\b/);
    expect(desk).toMatch(/scored\\?"\s*:\s*\[/);

    // No one else is asked: Ben scores without a vote landing on his screen.
    await ben.getByRole("button", { name: "Submit score" }).click();
    await ben.getByRole("dialog").getByRole("button", { name: "Submit", exact: true }).click();
    await expect(ben.getByRole("status").filter({ hasText: "Saved" })).toHaveText("Saved 9.500 for Agila", SAVED);
    await expect(ben.getByRole("dialog", { name: /asks to change their score/ })).toHaveCount(0);

    // The audience sees the entries and which judges have scored them, but no scores: the server doesn't send them.
    const audience = await (await page.context().browser()!.newContext()).newPage();
    await audience.goto(livePath);
    await expect(audience.getByText("A tick shows each score that's in. The scores themselves show here once the judges have deliberated and signed.")).toBeVisible();
    const agila = audience.locator("li[data-entry]", { hasText: "Agila" });
    await expect(agila).toContainText("2 of 2");
    await expect(agila.getByText("scored", { exact: true })).not.toHaveCount(0);
    await expect(audience.locator("li[data-entry]", { hasText: "Bagwis" })).toContainText("0 of 2");
    await expect(audience.getByText(/^2 of 4 scores in$/)).toBeVisible();
    // Not one value: no 8.125, nor the corrected score, nor any other number with decimal places.
    await expect(audience.getByText(/\d\.\d{3}/)).toHaveCount(0);
    await expectAccessible(audience);
    await audience.goto(livePath.replace("/live/", "/led/"));
    await expect(audience.getByRole("heading", { name: "This page doesn't exist" })).toBeVisible();

    await page.getByRole("button", { name: "Show next entry: Bagwis" }).click();
    await expect(ana.getByRole("heading", { level: 1 })).toHaveText("Bagwis", REALTIME);
    await submitScore(ana, "Bagwis", "7.75", "7.750");
    await expect(ben.getByRole("heading", { level: 1 })).toHaveText("Bagwis", REALTIME);
    await submitScore(ben, "Bagwis", "8", "8.000");

    // Every entry scored: the desk offers the deliberation, not the end of the session. So does the chair's screen.
    const controls = page.getByRole("group", { name: "Show controls" });
    await expect(controls.getByRole("button", { name: "Start deliberation" })).toBeVisible(REALTIME);
    await expect(page.getByRole("button", { name: "End session" })).toHaveCount(0);
    // No results PDF until the judges have signed.
    expect((await page.request.get(`${adminPath}/export`)).status()).toBe(409);
    const chair = ben.getByRole("region", { name: "Chair of the board of judges" });
    await chair.getByRole("button", { name: "Start deliberation" }).click();
    await ben.getByRole("dialog", { name: "Start the deliberation?" }).getByRole("button", { name: "Start deliberation" }).click();
    await expect(page.getByRole("heading", { name: "Deliberation" })).toBeVisible(REALTIME);
    await audience.context().close();
  });

  test("in the deliberation a tie in the ranking is broken by the chair before anyone signs", async () => {
    await expect(ben.getByRole("heading", { level: 1 })).toHaveText("Deliberation", REALTIME);
    // Ben corrects his Bagwis score from the list of every entry: 10 ties Bagwis with Agila for 1st (8.875 each).
    await ben.getByRole("button", { name: "Correct this score for Bagwis" }).click();
    await expect(ben.getByRole("heading", { level: 1 })).toHaveText("Bagwis");
    await tapScore(ben, "10");
    await ben.getByRole("button", { name: "Review correction" }).click();
    const fix = ben.getByRole("dialog", { name: "Change your score for Bagwis?" });
    await fix.getByLabel("Why does it need correcting?").fill("Meant 10, not 8.");
    await fix.getByRole("button", { name: "Change score" }).click();
    await expect(ben.getByRole("heading", { level: 1 })).toHaveText("Deliberation");
    await expect(ben.getByText("Corrected from 8.000.")).toBeVisible(REALTIME);

    // Every judge sees the tie at the top of their deliberation, and nobody signs until it's broken.
    await expect(ana.getByRole("heading", { name: "Tie for 1st", exact: true })).toBeVisible(REALTIME);
    await expect(ana.getByText("Agila and Bagwis have the same average. Ben Torres puts them in order before anyone signs.")).toBeVisible();
    await expect(ana.getByRole("status").filter({ hasText: "A tie in the ranking isn't broken yet" })).toBeVisible();
    await expectAccessible(ana);

    // Ben, the chair, puts Bagwis first and says why: the reason is required.
    await expect(ben.getByRole("heading", { name: "Tie for 1st", exact: true })).toBeVisible();
    await expect(ben.getByRole("button", { name: "Break the tie" })).toBeDisabled();
    await ben.getByRole("button", { name: "Move Bagwis up" }).click();
    await ben.getByLabel("Why they place in this order").fill("Bagwis had the stronger finish, as the panel agreed.");
    await ben.getByRole("button", { name: "Break the tie" }).click();
    const confirm = ben.getByRole("dialog", { name: "Break the tie for 1st?" });
    await expect(confirm).toContainText("1st Bagwis, 2nd Agila");
    await confirm.getByRole("button", { name: "Break the tie" }).click();
    await expect(ben.getByRole("heading", { name: "Tie for 1st, broken" })).toBeVisible(REALTIME);
    await expect(ana.getByRole("heading", { name: "Tie for 1st, broken" })).toBeVisible(REALTIME);
    await expect(ana.getByText("“Bagwis had the stronger finish, as the panel agreed.” Broken by Ben Torres.")).toBeVisible();
    // Now everyone can sign.
    await expect(ben.getByRole("checkbox", { name: /I've reviewed my scores and sign off on them/ })).toBeVisible();
  });

  test("while the judges deliberate, no entry can be added: no one could score it", async ({ page }) => {
    await signInAsSuperAdmin(page);
    await page.goto(`${adminPath}?tab=entries`);
    await expect(page.getByRole("note")).toHaveText("The judges are deliberating, so no entries can be added. Names can still be corrected.");
    await expect(page.getByLabel("Add entries, one per line")).toHaveCount(0);
  });

  test("each judge reviews their scores and signs, then the organizer signs the results to end it", async ({ page }) => {
    // Ana reviews: every entry with her score, her correction, and her notes.
    await expect(ana.getByRole("heading", { level: 1 })).toHaveText("Deliberation", REALTIME);
    const scores = ana.getByRole("list", { name: "Your scores" });
    await expect(scores.getByRole("listitem")).toHaveCount(2);
    await expect(scores.getByRole("listitem").first()).toContainText("8.250");
    await expect(scores.getByRole("listitem").first()).toContainText("Corrected from 8.125");
    await expect(ana.getByRole("button", { name: "Correct this score for Bagwis" })).toBeVisible();

    // On her phone she draws her signature.
    const sign = ana.getByRole("button", { name: "Sign", exact: true });
    await expect(sign).toBeDisabled();
    const pad = ana.getByRole("img", { name: "Signature box" });
    await pad.scrollIntoViewIfNeeded();
    const box = (await pad.boundingBox())!;
    await ana.mouse.move(box.x + box.width * 0.1, box.y + box.height * 0.7);
    await ana.mouse.down();
    for (let i = 1; i <= 12; i++) await ana.mouse.move(box.x + box.width * (0.1 + i * 0.06), box.y + box.height * (0.7 - (i % 2) * 0.3));
    await ana.mouse.up();
    await snap(ana, "deliberation signature drawn");
    await sign.click();
    await expect(ana.getByRole("status").filter({ hasText: "You've signed." })).toContainText("1 of 2 judges have signed.", REALTIME);
    await expect(ana.getByRole("img", { name: "Your signature" })).toBeVisible();
    // Signed, her scores stand: nothing left to correct.
    await expect(ana.getByRole("button", { name: /^Correct this score/ })).toHaveCount(0);

    // The desk shows the tie as broken; there's no End session button: the organizer signs the results instead.
    await signInAsSuperAdmin(page);
    await page.goto(`${adminPath}?tab=session`);
    await expect(page.getByRole("status").filter({ hasText: "of 2 judges have signed" })).toHaveText("1 of 2 judges have signed", REALTIME);
    await expect(page.getByRole("list", { name: "Ties in the ranking" })).toContainText("Tie for 1st, broken: Bagwis, then Agila.");
    await expect(page.getByRole("button", { name: "End session" })).toHaveCount(0);

    // Ben's laptop has no touchscreen: he ticks (Sgd.).
    await expect(ben.getByRole("heading", { level: 1 })).toHaveText("Deliberation", REALTIME);
    await expect(ben.getByRole("img", { name: "Signature box" })).toHaveCount(0);
    await ben.getByRole("checkbox", { name: /I've reviewed my scores and sign off on them/ }).check();
    await ben.getByRole("button", { name: "Sign", exact: true }).click();
    await expect(ben.getByRole("status").filter({ hasText: "You've signed." })).toBeVisible(REALTIME);

    // Everyone has signed: the results come up over the desk, and stay until the organizer signs them.
    const final = page.getByRole("dialog", { name: "Every judge has signed" });
    await expect(final).toBeVisible(REALTIME);
    await page.keyboard.press("Escape");
    await expect(final).toBeVisible();
    await expect(final.getByRole("row").nth(1)).toContainText("Bagwis");
    await expect(final.getByRole("row").nth(2)).toContainText("Agila");
    await expect(final.getByRole("list", { name: "Ties the chair broke" })).toContainText("Tie for 1st: Bagwis, then Agila.");
    await expectAccessible(page);
    await snap(page, "organizer signs the results");
    const end = final.getByRole("button", { name: "Sign and end the session" });
    await expect(end).toBeDisabled();
    await final.getByRole("checkbox", { name: /I've checked the results and sign them/ }).check();
    await final.getByLabel("Your password").fill(ADMIN_PASSWORD);
    await end.click();
    await expect(page.getByText("Signed by every judge after deliberating, and by Super admin")).toBeVisible(REALTIME);
    await expect(final).toBeHidden();

    await page.goto(livePath);
    const agila = page.locator("li[data-entry]", { hasText: "Agila" });
    await expect(agila).toContainText("8.250");
    // (8.250 + 9.500) / 2.
    await expect(agila).toContainText("8.88");

    await page.goto(`${adminPath}?tab=session`);
    const [download] = await Promise.all([page.waitForEvent("download"), page.getByRole("link", { name: "Download results PDF" }).click()]);
    expect(readFileSync(await download.path()).subarray(0, 5).toString()).toBe("%PDF-");
  });

  test("the organizer can deliberate again, with their password", async ({ page }) => {
    await signInAsSuperAdmin(page);
    await page.goto(`${adminPath}?tab=session`);
    await expect(page.getByRole("button", { name: "Reopen session" })).toHaveCount(0);
    await page.getByRole("button", { name: "Redeliberate" }).click();
    const again = page.getByRole("dialog", { name: "Deliberate again?" });
    await again.getByLabel("Your password").fill(ADMIN_PASSWORD);
    await again.getByRole("button", { name: "Redeliberate" }).click();
    // Everyone signs again: the judges' signatures are cleared, and their screens go back to their scores.
    await expect(page.getByRole("status").filter({ hasText: "of 2 judges have signed" })).toHaveText("0 of 2 judges have signed", REALTIME);
    await expect(ana.getByRole("heading", { level: 1 })).toHaveText("Deliberation", REALTIME);
    await expect(ana.getByRole("button", { name: "Sign", exact: true })).toBeVisible();
    // The results come off the live results page until the session ends again.
    await page.goto(livePath);
    await expect(page.getByText("A tick shows each score that's in.", { exact: false })).toBeVisible();
  });
});
