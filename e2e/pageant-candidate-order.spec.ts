import { randomBytes, randomUUID } from "node:crypto";
import { expect, test, type Browser, type Page } from "@playwright/test";
import { expectAccessible, openJudgeLink, signInAsSuperAdmin, submitScore, supabaseAdmin } from "./helpers";

// A preliminary sub-activity in parts judged candidate by candidate: Talent, scored on Performance and Costume, goes on
// judges' screens as a whole. The organizer shows Ayla once; each judge scores her Performance, their screen moves on to
// her Costume by itself, and only then is she "scored" on the desk. Then Bea. Once both are scored on every part, the
// desk deliberates Performance, then Costume. Two judges, Ana and Ben (chair).

const api = supabaseAdmin()!;
const RUN = Date.now().toString(36);
const NAME = `E2E Pageant candidate order ${RUN}`;
const REALTIME = { timeout: 20_000 };
const pageant = { id: randomUUID(), publicId: randomBytes(5).toString("hex") };
const round = { talent: randomUUID(), perf: randomUUID(), dress: randomUUID(), gown: randomUUID() };
const judge = { ana: randomUUID(), ben: randomUUID() };
const code = (prefix: string) => `${prefix}${RUN.toUpperCase().replace(/[^A-Z2-9]/g, "X").slice(-5).padStart(5, "X")}`;
const CODES = { ana: code("K"), ben: code("M") };
const adminPath = `/admin/${pageant.id}`;

let ana: Page;
let ben: Page;
// Before migration 045 there's nowhere to keep the choice: the whole file skips.
let missing045 = false;

async function post(path: string, body: unknown) {
  return fetch(`${api.url}/rest/v1/${path}`, {
    method: "POST",
    headers: { ...api.headers, "Content-Type": "application/json", Prefer: "return=minimal" },
    body: JSON.stringify(body),
  });
}
async function restOk(path: string, body: unknown) {
  const response = await post(path, body);
  expect(response.ok, await response.text()).toBe(true);
}

const pairingCode = async (page: Page) =>
  (await page.locator("p").filter({ hasText: /^Pairing code [A-Z0-9]{4}$/ }).textContent())!.replace("Pairing code ", "");

async function openPage(browser: Browser, width = 1280) {
  return (await browser.newContext({ viewport: { width, height: 800 } })).newPage();
}

/** The part a judge's screen is on, from its strip of parts. */
const partInHand = (j: Page) => j.getByRole("navigation", { name: "Parts" }).locator('[aria-current="step"]');
/** A judge's tile on the desk. */
const tile = (page: Page, name: string) => page.locator("li").filter({ hasText: name }).filter({ hasText: /Scored|Still scoring/ });

/** A judge scores the candidate shown on Performance, then (their screen moving on by itself) on Costume. */
async function scoreBothParts(j: Page, candidate: string, perf: string, dress: string) {
  await expect(partInHand(j)).toHaveText("Performance", REALTIME);
  await submitScore(j, candidate, perf);
  await expect(partInHand(j)).toHaveText("Costume", REALTIME);
  await submitScore(j, candidate, dress);
  await expect(j.getByRole("heading", { level: 1 })).toHaveText("You've scored every part", REALTIME);
}

test.describe.serial("a preliminary sub-activity judged candidate by candidate", () => {
  test.beforeAll(async ({ browser }) => {
    await restOk("activities", {
      id: pageant.id,
      name: NAME,
      public_id: pageant.publicId,
      min_score: 1,
      max_score: 10,
      decimals: 0,
      kind: "pageant",
      live_scoring: true,
      preliminary_weight: 40,
    });
    const scoring = { scoring_mode: "simple", min_score: 1, max_score: 10, decimals: 0, criteria: [], criteria_display: "percent", timer_seconds: null };
    const row = (id: string, name: string, position: number, weight: number, extra = {}) => ({
      id,
      activity_id: pageant.id,
      segment: "preliminary",
      name,
      position,
      weight,
      cut_size: null,
      cut_basis: [],
      ...scoring,
      live_scoring: false,
      ...extra,
    });
    // The sub-activity first: its parts point at it.
    const talent = await post("rounds", [row(round.talent, "Talent", 0, 40, { candidate_order: true, parent_id: null })]);
    if (!talent.ok) {
      missing045 = /candidate_order/.test(await talent.text());
      expect(missing045, "the rounds should save").toBe(true);
      return;
    }
    await restOk("rounds", [
      row(round.perf, "Performance", 0, 20, { parent_id: round.talent }),
      row(round.dress, "Costume", 1, 20, { parent_id: round.talent }),
      // Every row in one insert needs the same keys, so parent_id too.
      { ...row(round.gown, "Gown", 1, 60, { live_scoring: true, parent_id: null }), segment: "proper", cut_size: 1, cut_basis: ["preliminary", round.gown] },
    ]);
    const person = (id: string, first: string, last: string, position: number) => ({
      id,
      activity_id: pageant.id,
      name: `${first} ${last}`,
      first_name: first,
      last_name: last,
      position,
      is_chair: false,
      panel: "all",
    });
    // Talent is deliberated, so the board needs a chair to start.
    await restOk("judges", [person(judge.ana, "Ana", "Cruz", 0), { ...person(judge.ben, "Ben", "Torres", 1), is_chair: true }]);
    await restOk("judge_access", [
      { judge_id: judge.ana, code: CODES.ana },
      { judge_id: judge.ben, code: CODES.ben },
    ]);
    await restOk("entries", [
      { activity_id: pageant.id, name: "Ayla", position: 0 },
      { activity_id: pageant.id, name: "Bea", position: 1 },
    ]);
    [ana, ben] = await Promise.all([openPage(browser, 390), openPage(browser, 1180)]);
  });

  test.afterAll(async () => {
    for (const p of [ana, ben]) await p?.context().close();
    await fetch(`${api.url}/rest/v1/activities?id=eq.${pageant.id}`, { method: "DELETE", headers: api.headers });
  });

  test("the program says so, and Talent goes on judges' screens as a whole", async ({ page }) => {
    test.skip(missing045, "This database doesn't have migration 045 yet.");
    await signInAsSuperAdmin(page);
    await page.goto(`${adminPath}?tab=segments`);
    const order = page.getByRole("group", { name: "Judging order of Talent" });
    await expect(order.getByRole("radio", { name: "Candidate by candidate" })).toBeChecked();
    // Saved part by part and back again: the choice is kept with the program.
    await order.getByRole("radio", { name: "Part by part" }).check();
    await page.getByRole("button", { name: "Save program" }).click();
    await expect(page.getByText("Program saved", { exact: true })).toBeVisible(REALTIME);
    await page.reload();
    await expect(order.getByRole("radio", { name: "Part by part" })).toBeChecked();
    await order.getByRole("radio", { name: "Candidate by candidate" }).check();
    await page.getByRole("button", { name: "Save program" }).click();
    await expect(page.getByText("Program saved", { exact: true })).toBeVisible(REALTIME);
    await page.reload();
    await expect(order.getByRole("radio", { name: "Candidate by candidate" })).toBeChecked();

    for (const [j, c, name] of [
      [ana, CODES.ana, "Ana Cruz"],
      [ben, CODES.ben, "Ben Torres"],
    ] as const) {
      await openJudgeLink(j, c);
      const pairing = await pairingCode(j);
      await page.goto(`${adminPath}?tab=judges`);
      await page.getByRole("button", { name: `Approve ${name}'s device ${pairing}` }).click();
      await expect(j.getByRole("heading", { level: 1 })).toHaveText("Waiting for the organizer to start", REALTIME);
    }
    await page.goto(`${adminPath}?tab=session`);
    await page.getByRole("button", { name: "Start preliminary" }).click();
    await page.getByRole("dialog", { name: "Start the preliminary?" }).getByRole("button", { name: "Start preliminary" }).click();
    await page.getByRole("button", { name: "Judge Talent", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Talent · Judged candidate by candidate" })).toBeVisible(REALTIME);
    // Its parts don't go on alone.
    await expect(page.getByRole("button", { name: /Talent · (Performance|Costume)$/ })).toHaveCount(0);
  });

  test("each judge scores the candidate on every part before the next is shown", async ({ page }) => {
    test.skip(missing045, "This database doesn't have migration 045 yet.");
    test.slow();
    await signInAsSuperAdmin(page);
    await page.goto(`${adminPath}?tab=session`);
    await page.getByRole("button", { name: "Show first candidate", exact: true }).click();
    for (const j of [ana, ben]) await expect(j.getByRole("heading", { level: 1 })).toHaveText("Ayla", REALTIME);

    // Ana's Performance alone doesn't make her scored on the desk; her Costume does.
    await expect(partInHand(ana)).toHaveText("Performance", REALTIME);
    await submitScore(ana, "Ayla", "8");
    await expect(partInHand(ana)).toHaveText("Costume", REALTIME);
    await expect(tile(page, "Ana Cruz")).toContainText("Still scoring");
    await expectAccessible(ana);
    await submitScore(ana, "Ayla", "7");
    await expect(ana.getByRole("heading", { level: 1 })).toHaveText("You've scored every part", REALTIME);
    await expect(tile(page, "Ana Cruz")).toContainText("Scored", REALTIME);

    // The live results (as the LED wall) hold Performance up once every judge has scored it, until Costume is finished
    // too, even with Ana already done with Costume.
    const audience = await page.context().newPage();
    const partOnAir = audience.getByText(/^Talent · (Performance|Costume)$/).first();
    await expect(partInHand(ben)).toHaveText("Performance", REALTIME);
    await submitScore(ben, "Ayla", "6");
    await audience.goto(`/live/${pageant.publicId}`);
    await expect(partOnAir).toHaveText("Talent · Performance");
    await expect(partInHand(ben)).toHaveText("Costume", REALTIME);
    await submitScore(ben, "Ayla", "9");
    await expect(ben.getByRole("heading", { level: 1 })).toHaveText("You've scored every part", REALTIME);
    await expect(page.getByRole("status").filter({ hasText: "Every judge has scored Ayla." })).toBeVisible(REALTIME);
    await audience.reload();
    await expect(partOnAir).toHaveText("Talent · Costume", REALTIME);
    await audience.close();

    // Bea. Ana goes back to her Performance score from the strip, then on to her Costume.
    await page.getByRole("button", { name: "Next: Bea" }).click();
    await expect(ana.getByRole("heading", { level: 1 })).toHaveText("Bea", REALTIME);
    await submitScore(ana, "Bea", "9");
    await expect(partInHand(ana)).toHaveText("Costume", REALTIME);
    await ana.getByRole("navigation", { name: "Parts" }).getByRole("link", { name: /Performance/ }).click();
    await expect(partInHand(ana)).toHaveText(/Performance/);
    await expect(ana.getByRole("heading", { level: 1 })).toHaveText("Your score is in");
    await expect(ana.getByText("Next, score Bea in Costume.")).toBeVisible();
    await ana.getByRole("link", { name: "Next: Costume" }).click();
    await expect(partInHand(ana)).toHaveText("Costume");
    await submitScore(ana, "Bea", "8");
    await expect(ana.getByRole("heading", { level: 1 })).toHaveText("You've scored every part", REALTIME);
    await scoreBothParts(ben, "Bea", "7", "7");
  });

  test("then each part is deliberated in turn", async ({ page }) => {
    test.skip(missing045, "This database doesn't have migration 045 yet.");
    await signInAsSuperAdmin(page);
    await page.goto(`${adminPath}?tab=session`);
    await page.getByRole("button", { name: "Start deliberation of Talent · Performance" }).first().click();
    await page.getByRole("dialog", { name: "Deliberate Talent · Performance?" }).getByRole("button", { name: "Start deliberation" }).click();
    await expect(page.getByRole("heading", { name: "Talent · Performance · Deliberation" })).toBeVisible(REALTIME);
    for (const j of [ana, ben]) await expect(j.getByRole("heading", { level: 1 })).toHaveText("Deliberation", REALTIME);
  });
});
