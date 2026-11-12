import { randomBytes, randomUUID } from "node:crypto";
import { expect, test, type Browser, type Page } from "@playwright/test";
import { expectAccessible, openJudgeLink, signInAsSuperAdmin, submitScore, supabaseAdmin } from "./helpers";

// A pageant sub-activity judged at its judges' own pace: Talent, in the preliminary, gives its results after a
// deliberation, and no candidate is shown one at a time. Each judge scores Ayla, Bea and Cora in whatever order they
// like; once every score is in, the desk starts Talent's deliberation. One board of three: Ana (chair), Ben and Cara.

const api = supabaseAdmin()!;
const RUN = Date.now().toString(36);
const NAME = `E2E Pageant own pace ${RUN}`;
const REALTIME = { timeout: 20_000 };
const pageant = { id: randomUUID(), publicId: randomBytes(5).toString("hex") };
const round = { talent: randomUUID(), gown: randomUUID() };
const judge = { ana: randomUUID(), ben: randomUUID(), cara: randomUUID() };
const code = (prefix: string) => `${prefix}${RUN.toUpperCase().replace(/[^A-Z2-9]/g, "X").slice(-5).padStart(5, "X")}`;
const CODES = { ana: code("G"), ben: code("H"), cara: code("J") };
const adminPath = `/admin/${pageant.id}`;

let ana: Page;
let ben: Page;
let cara: Page;
// Before migration 041 there's nowhere to keep the choice: the whole file skips.
let missing041 = false;

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

test.describe.serial("a pageant sub-activity judged at the judges' own pace", () => {
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
    const rounds = await post("rounds", [
      { id: round.talent, activity_id: pageant.id, segment: "preliminary", name: "Talent", position: 0, weight: 40, cut_size: null, cut_basis: [], ...scoring, live_scoring: false, independent_scoring: true },
      { id: round.gown, activity_id: pageant.id, segment: "proper", name: "Gown", position: 1, weight: 60, cut_size: 1, cut_basis: ["preliminary", round.gown], ...scoring, live_scoring: true, independent_scoring: false },
    ]);
    if (!rounds.ok) {
      missing041 = /independent_scoring/.test(await rounds.text());
      expect(missing041, "the rounds should save").toBe(true);
      return;
    }
    const person = (id: string, first: string, last: string, position: number, extra = {}) => ({
      id,
      activity_id: pageant.id,
      name: `${first} ${last}`,
      first_name: first,
      last_name: last,
      position,
      is_chair: false,
      panel: "all",
      ...extra,
    });
    await restOk("judges", [person(judge.ana, "Ana", "Cruz", 0, { is_chair: true }), person(judge.ben, "Ben", "Torres", 1), person(judge.cara, "Cara", "Diaz", 2)]);
    await restOk("judge_access", [
      { judge_id: judge.ana, code: CODES.ana },
      { judge_id: judge.ben, code: CODES.ben },
      { judge_id: judge.cara, code: CODES.cara },
    ]);
    await restOk("entries", [
      { activity_id: pageant.id, name: "Ayla", position: 0 },
      { activity_id: pageant.id, name: "Bea", position: 1 },
      { activity_id: pageant.id, name: "Cora", position: 2 },
    ]);
    [ana, ben, cara] = await Promise.all([openPage(browser, 390), openPage(browser, 1180), openPage(browser)]);
  });

  test.afterAll(async () => {
    for (const p of [ana, ben, cara]) await p?.context().close();
    await fetch(`${api.url}/rest/v1/activities?id=eq.${pageant.id}`, { method: "DELETE", headers: api.headers });
  });

  test("Talent goes on judges' screens with no candidate shown", async ({ page }) => {
    test.skip(missing041, "This database doesn't have migration 041 yet.");
    await signInAsSuperAdmin(page);
    // Set up so in the program: after a deliberation, at the judges' own pace.
    await page.goto(`${adminPath}?tab=segments`);
    await expect(page.getByRole("checkbox", { name: "Judges score at their own pace in Talent" })).toBeChecked();
    for (const [j, c, name] of [
      [ana, CODES.ana, "Ana Cruz"],
      [ben, CODES.ben, "Ben Torres"],
      [cara, CODES.cara, "Cara Diaz"],
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

    // The desk: no candidate to show, only how far the judges have got.
    await expect(page.getByRole("heading", { name: "Talent · Judges score at their own pace" })).toBeVisible(REALTIME);
    await expect(page.getByText("0 of 9 scores in")).toBeVisible();
    await expect(page.getByRole("button", { name: /^(Show first candidate|Next: )/ })).toHaveCount(0);
    await expect(page.getByRole("list", { name: "Running order: Talent" }).getByRole("button", { name: /^Judge now/ })).toHaveCount(0);
    // Each judge starts on the first candidate they haven't scored.
    for (const j of [ana, ben, cara]) await expect(j.getByRole("heading", { level: 1 })).toHaveText("Ayla", REALTIME);
  });

  test("the judges score in any order, then the desk starts Talent's deliberation", async ({ page }) => {
    test.skip(missing041, "This database doesn't have migration 041 yet.");
    test.slow();
    // Ana scores Ayla, then skips ahead to Cora from her scores, and comes back for Bea.
    await submitScore(ana, "Ayla", "8");
    await expect(ana.getByRole("heading", { level: 1 })).toHaveText("Bea");
    await ana.getByRole("button", { name: /Show your scores/ }).click();
    await ana.getByRole("dialog").getByRole("button", { name: /Cora/ }).click();
    await submitScore(ana, "Cora", "9");
    await submitScore(ana, "Bea", "7");
    await expect(ana.getByRole("heading", { level: 1 })).toHaveText("You've scored every candidate");
    await expect(ana.getByText("The organizer starts the deliberation once every judge has.", { exact: false })).toBeVisible();
    await expectAccessible(ana);

    // Ben and Cara go in running order.
    for (const j of [ben, cara]) for (const [entry, value] of [["Ayla", "6"], ["Bea", "7"], ["Cora", "8"]]) await submitScore(j, entry, value);

    await signInAsSuperAdmin(page);
    await page.goto(`${adminPath}?tab=session`);
    await expect(page.getByText("9 of 9 scores in")).toBeVisible(REALTIME);
    await expect(page.getByRole("status").filter({ hasText: "Every judge has scored every candidate." })).toBeVisible();
    await page.getByRole("button", { name: "Start deliberation of Talent" }).click();
    await page.getByRole("dialog", { name: "Deliberate Talent?" }).getByRole("button", { name: "Start deliberation" }).click();
    await expect(page.getByRole("heading", { name: "Talent · Deliberation" })).toBeVisible(REALTIME);
    for (const j of [ana, ben, cara]) await expect(j.getByRole("heading", { level: 1 })).toHaveText("Deliberation", REALTIME);
  });
});
