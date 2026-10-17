import { readFileSync } from "node:fs";
import { devices, expect, test, type Page } from "@playwright/test";
import { ADMIN_PASSWORD, deleteActivityNamed, expectAccessible, SAVED, screenPath, signInAsSuperAdmin, snap, submitScore, tapScore } from "./helpers";

// An event without live scoring, scored to three decimal places. The audience sees no scores until the judges have
// deliberated and signed; a judge can ask to correct a score, and the others vote on the reason without seeing the values.
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

  test("judges score to three places, a correction is voted on without its values, and the audience sees no scores", async ({ page }) => {
    await signInAsSuperAdmin(page);
    for (const [judge, code, name] of [
      [ana, codes[0], "Ana Cruz"],
      [ben, codes[1], "Ben Torres"],
    ] as const) {
      await judge.goto(`/judge/join/${code}`);
      const pairing = await pairingCode(judge);
      await page.goto(`${adminPath}?tab=judges`);
      await page.getByRole("button", { name: `Approve ${name}'s device ${pairing}` }).click();
      await expect(judge.getByRole("heading", { level: 1 })).toHaveText("Waiting for the organizer to start", REALTIME);
    }
    await page.goto(`${adminPath}?tab=session`);
    await page.getByRole("button", { name: "Start session" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Start session" }).click();
    await page.getByRole("button", { name: "Show first entry" }).click();

    await expect(ana.getByRole("heading", { level: 1 })).toHaveText("Agila", REALTIME);
    await expect(ana.getByText("Score from 1 to 10, up to 3 decimal places.")).toBeVisible();
    await submitScore(ana, "Agila", "8.125");
    await expect(ben.getByRole("heading", { level: 1 })).toHaveText("Agila", REALTIME);

    // Ana corrects 8.125 to 8.25 while Ben is still typing his own score.
    await tapScore(ben, "9.5");
    await ana.getByRole("button", { name: "Ask to correct this score" }).click();
    await expect(ana.getByText("Correcting your score", { exact: true })).toBeVisible();
    await tapScore(ana, "8.25");
    await ana.getByRole("button", { name: "Review correction" }).click();
    const ask = ana.getByRole("dialog", { name: "Ask to change your score for Agila?" });
    // She sees her own scores, before and after.
    await expect(ask).toContainText("8.125");
    await expect(ask).toContainText("8.250");
    await expect(ask.getByRole("button", { name: "Ask the judges" })).toBeDisabled();
    await ask.getByLabel("Why does it need correcting?").fill("Misread my sheet: it says 8.25.");
    await ask.getByRole("button", { name: "Ask the judges" }).click();
    await expect(ana.getByText("You asked to change it to 8.250.")).toBeVisible();
    // The organizer sees the values; the score changes only if Ben agrees.
    const corrections = page.getByRole("region", { name: "Score corrections" });
    await expect(corrections).toContainText("Ana Cruz asks to change their score for No. 1 Agila: 8.125 to 8.250", REALTIME);
    await expect(corrections).toContainText("0 of 1 judge has agreed");
    // Ben's vote doesn't land on his keypad while he's typing, nor during his five seconds to undo.
    const vote = ben.getByRole("dialog", { name: "Ana Cruz asks to change their score for No. 1 Agila" });
    await expect(ben.getByRole("status").filter({ hasText: "asks to correct" })).toHaveText(
      "Ana Cruz asks to correct a score. You'll vote once your score is in.",
      REALTIME,
    );
    await expect(vote).toHaveCount(0);
    await ben.getByRole("button", { name: "Submit score" }).click();
    await ben.getByRole("dialog").getByRole("button", { name: "Submit", exact: true }).click();
    await expect(ben.getByRole("button", { name: "Undo" })).toBeVisible();
    await expect(vote).toHaveCount(0);
    // Then he votes on her reason. Scores stay private: he never sees hers.
    await expect(vote).toBeVisible(SAVED);
    await expect(ben.getByRole("status").filter({ hasText: "Saved" })).toHaveText("Saved 9.500 for Agila");
    await expect(vote).toContainText("Misread my sheet: it says 8.25.");
    await expect(vote).toContainText("Scores stay private, so you see only the reason.");
    // (Her reason can say what she meant; her score itself never reaches his screen.)
    await expect(vote.getByText("8.125")).toHaveCount(0);
    await expectAccessible(ben);
    await snap(ben, "vote without the scores");
    // It can't be put off.
    await ben.keyboard.press("Escape");
    await expect(vote).toBeVisible();
    await vote.getByRole("button", { name: /^Agree/ }).click();
    await expect(vote).toBeHidden();
    await expect(ben.getByRole("status").filter({ hasText: "You agreed" })).toHaveText("You agreed to Ana Cruz's correction.");
    await expect(ana.getByText("Corrected from 8.125: every other judge agreed.")).toBeVisible(REALTIME);
    await expect(corrections).toContainText("1 settled", REALTIME);

    // The audience sees the entries, but no scores: the server doesn't send them.
    const audience = await (await page.context().browser()!.newContext()).newPage();
    await audience.goto(livePath);
    await expect(audience.getByText("The results show here once the judges have deliberated and signed.")).toBeVisible();
    await expect(audience.getByText("Agila")).toBeVisible();
    await expect(audience.getByText("8.125")).toHaveCount(0);
    await expect(audience.getByText(/scores in/)).toHaveCount(0);
    await expectAccessible(audience);

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

  test("in the deliberation a correction can still be asked for, and holds up signing until it's settled", async () => {
    await expect(ben.getByRole("heading", { level: 1 })).toHaveText("Deliberation", REALTIME);
    // Ben asks to change his Bagwis score from the list of every entry.
    await ben.getByRole("button", { name: "Ask to correct this score for Bagwis" }).click();
    await expect(ben.getByRole("heading", { level: 1 })).toHaveText("Bagwis");
    await tapScore(ben, "8.5");
    await ben.getByRole("button", { name: "Review correction" }).click();
    const ask = ben.getByRole("dialog", { name: "Ask to change your score for Bagwis?" });
    await ask.getByLabel("Why does it need correcting?").fill("Meant 8.5, not 8.");
    await ask.getByRole("button", { name: "Ask the judges" }).click();
    await expect(ben.getByRole("heading", { level: 1 })).toHaveText("Deliberation");
    await expect(ben.getByText("You asked to change it to 8.500.")).toBeVisible();
    // Nobody signs while it's open.
    await expect(ben.getByRole("status").filter({ hasText: "A score correction is still open" })).toBeVisible();
    // Ana disagrees: one judge disagreeing keeps the score.
    const vote = ana.getByRole("dialog", { name: "Ben Torres asks to change their score for No. 2 Bagwis" });
    await expect(vote).toBeVisible(REALTIME);
    await vote.getByRole("button", { name: /^Disagree/ }).click();
    await expect(vote).toBeHidden();
    await expect(ana.getByRole("status").filter({ hasText: "You disagreed" })).toHaveText("You disagreed, so Ben Torres's score stays as it was.");
    await expect(ben.getByText("Your correction to 8.500 wasn't accepted: a judge disagreed.")).toBeVisible(REALTIME);
    await expect(ben.getByRole("button", { name: "Ask again for Bagwis" })).toBeVisible();
  });

  test("each judge reviews their scores and signs, then the results are out", async ({ page }) => {
    // Ana reviews: every entry with her score, her correction, and her notes.
    await expect(ana.getByRole("heading", { level: 1 })).toHaveText("Deliberation", REALTIME);
    const scores = ana.getByRole("list", { name: "Your scores" });
    await expect(scores.getByRole("listitem")).toHaveCount(2);
    await expect(scores.getByRole("listitem").first()).toContainText("8.250");
    await expect(scores.getByRole("listitem").first()).toContainText("Corrected from 8.125");
    await expect(ana.getByRole("button", { name: "Ask to correct this score for Bagwis" })).toBeVisible();
    await expectAccessible(ana);

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

    // Ben's laptop has no touchscreen: he ticks (Sgd.).
    await signInAsSuperAdmin(page);
    await page.goto(`${adminPath}?tab=session`);
    await expect(page.getByRole("status").filter({ hasText: "of 2 judges have signed" })).toHaveText("1 of 2 judges have signed", REALTIME);
    await expect(page.getByRole("button", { name: "End session" })).toHaveCount(0);
    await expect(ben.getByRole("heading", { level: 1 })).toHaveText("Deliberation", REALTIME);
    await expect(ben.getByRole("img", { name: "Signature box" })).toHaveCount(0);
    await ben.getByRole("checkbox", { name: /I've reviewed my scores and sign off on them/ }).check();
    await ben.getByRole("button", { name: "Sign", exact: true }).click();
    await expect(ben.getByRole("status").filter({ hasText: "You've signed." })).toBeVisible(REALTIME);

    // Everyone has signed: the organizer ends the session, and the results are out.
    await expect(page.getByRole("status").filter({ hasText: "Every judge has signed" })).toBeVisible(REALTIME);
    await page.getByRole("button", { name: "End session" }).click();
    const end = page.getByRole("dialog", { name: "End the session?" });
    await end.getByLabel("Your password").fill(ADMIN_PASSWORD);
    await end.getByRole("button", { name: "End session" }).click();
    await expect(page.getByText("Signed by every judge after deliberating")).toBeVisible(REALTIME);

    await page.goto(livePath);
    const agila = page.locator("li[data-entry]", { hasText: "Agila" });
    await expect(agila).toContainText("8.250");
    // (8.250 + 9.500) / 2.
    await expect(agila).toContainText("8.88");

    await page.goto(`${adminPath}?tab=session`);
    const [download] = await Promise.all([page.waitForEvent("download"), page.getByRole("link", { name: "Download results PDF" }).click()]);
    expect(readFileSync(await download.path()).subarray(0, 5).toString()).toBe("%PDF-");
  });
});
