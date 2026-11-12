import { randomBytes, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { expect, test, type Browser, type Page } from "@playwright/test";
import { ADMIN_PASSWORD, exportFile, expectAccessible, openJudgeLink, signInAsSuperAdmin, snap, submitScore, supabaseAdmin } from "./helpers";

// A pageant whose sub-activities give their results after a deliberation rather than live. Talent (the preliminary)
// and Gown (pageant proper, ending in the final cut) each hold their scores back from the audience until their judges
// have reviewed and signed them and the organizer has signed them off. Ben corrects one of his own Talent scores in the
// deliberation, saying why; the final cut waits for Gown's sign-off. One board of three: Ana (chair), Ben and Cara.

const api = supabaseAdmin()!;
const RUN = Date.now().toString(36);
const NAME = `E2E Pageant deliberation ${RUN}`;
const REALTIME = { timeout: 20_000 };
const pageant = { id: randomUUID(), publicId: randomBytes(5).toString("hex") };
const round = { talent: randomUUID(), gown: randomUUID() };
const judge = { ana: randomUUID(), ben: randomUUID(), cara: randomUUID() };
const code = (prefix: string) => `${prefix}${RUN.toUpperCase().replace(/[^A-Z2-9]/g, "X").slice(-5).padStart(5, "X")}`;
const CODES = { ana: code("D"), ben: code("E"), cara: code("F") };
const adminPath = `/admin/${pageant.id}`;
const livePath = `/live/${pageant.publicId}`;

let ana: Page;
let ben: Page;
let cara: Page;
const board = () => [ana, ben, cara];

async function restOk(path: string, body: unknown) {
  const response = await fetch(`${api.url}/rest/v1/${path}`, {
    method: "POST",
    headers: { ...api.headers, "Content-Type": "application/json", Prefer: "return=minimal" },
    body: JSON.stringify(body),
  });
  expect(response.ok, await response.text()).toBe(true);
}

const pairingCode = async (page: Page) =>
  (await page.locator("p").filter({ hasText: /^Pairing code [A-Z0-9]{4}$/ }).textContent())!.replace("Pairing code ", "");

/** Show a candidate, have the board score them, and wait for the desk to see every score. */
async function judgeCandidate(page: Page, button: string, candidate: string, score: string) {
  await page.getByRole("button", { name: button, exact: true }).click();
  await Promise.all(
    board().map(async (j) => {
      await expect(j.getByRole("heading", { level: 1 })).toHaveText(candidate, REALTIME);
      await submitScore(j, candidate, score);
    }),
  );
  await expect(page.getByRole("status").filter({ hasText: `Every judge has scored ${candidate}.` })).toBeVisible(REALTIME);
}

/** Each judge signs their scores in the deliberation on screen, "(Sgd.)" (these screens have no touchscreen). */
async function everyoneSigns() {
  for (const j of board()) {
    await j.getByRole("checkbox", { name: /I've reviewed my scores and sign off on them/ }).check();
    await j.getByRole("button", { name: "Sign", exact: true }).click();
    await expect(j.getByRole("status").filter({ hasText: "You've signed." })).toBeVisible(REALTIME);
  }
}

/** The organizer signs off the sub-activity on the desk once every judge has signed, with their password. */
async function signOff(page: Page, name: string) {
  await expect(page.getByRole("status").filter({ hasText: "Sign it off to send its scores out." })).toBeVisible(REALTIME);
  await page.getByRole("checkbox", { name: new RegExp(`I've checked the scores in ${name} and sign them off`) }).check();
  await page.getByRole("button", { name: `Sign off ${name}` }).click();
  const dialog = page.getByRole("dialog", { name: `Sign off ${name}?` });
  await dialog.getByLabel("Your password").fill(ADMIN_PASSWORD);
  await dialog.getByRole("button", { name: `Sign off ${name}` }).click();
  await expect(dialog).toBeHidden();
}

async function openPage(browser: Browser, width = 1280) {
  return (await browser.newContext({ viewport: { width, height: 800 } })).newPage();
}

test.describe.serial("a pageant sub-activity with a deliberation", () => {
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
    const scoring = { scoring_mode: "simple", min_score: 1, max_score: 10, decimals: 0, criteria: [], criteria_display: "percent", timer_seconds: null, live_scoring: false };
    await restOk("rounds", [
      { id: round.talent, activity_id: pageant.id, segment: "preliminary", name: "Talent", position: 0, weight: 40, cut_size: null, cut_basis: [], ...scoring },
      { id: round.gown, activity_id: pageant.id, segment: "proper", name: "Gown", position: 1, weight: 60, cut_size: 1, cut_basis: ["preliminary", round.gown], ...scoring },
    ]);
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
    ]);
    [ana, ben, cara] = await Promise.all([openPage(browser, 390), openPage(browser, 1180), openPage(browser)]);
  });

  test.afterAll(async () => {
    for (const p of [ana, ben, cara]) await p?.context().close();
    await fetch(`${api.url}/rest/v1/activities?id=eq.${pageant.id}`, { method: "DELETE", headers: api.headers });
  });

  test("the judges pair, and the preliminary starts", async ({ page }) => {
    await signInAsSuperAdmin(page);
    // Set up as a sub-activity whose results come after a deliberation.
    await page.goto(`${adminPath}?tab=segments`);
    await expect(page.getByRole("radio", { name: "After a deliberation" }).first()).toBeChecked();
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
    await expect(page.getByRole("heading", { name: /^Talent · / })).toBeVisible(REALTIME);
  });

  test("its scores stay off the live results until it's deliberated and signed off", async ({ page, browser }) => {
    test.slow();
    await signInAsSuperAdmin(page);
    await page.goto(`${adminPath}?tab=session`);
    await judgeCandidate(page, "Show first candidate", "Ayla", "9");
    await judgeCandidate(page, "Next: Bea", "Bea", "8");

    // The audience sees a tick for each score that's in, not the score.
    const live = await openPage(browser);
    await live.goto(livePath);
    await expect(live.getByText("A tick shows each score that's in.", { exact: false })).toBeVisible(REALTIME);
    await expect(live.getByText("9", { exact: true })).toHaveCount(0);
    // The organizer's private tally has them: the password opens it, partial and unofficial, on the sub-activity on
    // judges' screens. The preliminary's standings are there too.
    const tally = await page.context().newPage();
    await tally.goto(`${adminPath}/tally`);
    await tally.getByLabel("Super admin password").fill(ADMIN_PASSWORD);
    await tally.getByRole("button", { name: "Open the tally" }).click();
    await expect(tally.getByText("Partial and unofficial tally")).toBeVisible();
    await expect(tally.getByLabel("Tally of")).toHaveValue(round.talent);
    await expect(tally.getByRole("region", { name: "Scores by candidate" }).getByRole("row").filter({ hasText: "Ayla" })).toContainText("9");
    await expect(tally.getByText("Held back from the audience until it's signed off.", { exact: false })).toBeVisible();
    await tally.getByLabel("Tally of").selectOption({ label: "Preliminary standings" });
    await expect(tally.getByRole("heading", { name: "Preliminary standings" })).toBeVisible();
    await tally.close();

    // Every score in, the desk offers the deliberation before anything else.
    await page.getByRole("button", { name: "Start deliberation of Talent" }).click();
    await page.getByRole("dialog", { name: "Deliberate Talent?" }).getByRole("button", { name: "Start deliberation" }).click();
    await expect(page.getByRole("heading", { name: "Talent · Deliberation" })).toBeVisible(REALTIME);
    await expect(page.getByRole("status").filter({ hasText: "Waiting for Ana Cruz, Ben Torres, and Cara Diaz to sign." })).toBeVisible();
    for (const j of board()) await expect(j.getByRole("heading", { level: 1 })).toHaveText("Deliberation", REALTIME);
    await expect(ben.getByText("Talent", { exact: true })).toBeVisible();
    await snap(ben, "judge deliberating a sub-activity");
    await expectAccessible(ben);

    // Ben corrects his own score for Ayla, saying why: it applies at once.
    await ben.getByRole("button", { name: "Correct this score for Ayla" }).click();
    await expect(ben.getByRole("heading", { level: 1 })).toHaveText("Ayla");
    await ben.getByRole("button", { name: "7", exact: true }).click();
    await ben.getByRole("button", { name: "Review correction" }).click();
    const dialog = ben.getByRole("dialog", { name: "Change your score for Ayla?" });
    await dialog.getByRole("group", { name: "Why does it need correcting?" }).getByRole("radio").first().check();
    await dialog.getByRole("button", { name: "Change score" }).click();
    await expect(ben.getByRole("heading", { level: 1 })).toHaveText("Deliberation");
    await expect(ben.getByText("Corrected from 9.")).toBeVisible(REALTIME);

    // While it's being deliberated, nothing else goes on judges' screens.
    await expect(page.getByRole("region", { name: "Program" }).getByRole("button", { name: /^(Judge now|Show again|Resume) / })).toHaveCount(0);

    await everyoneSigns();
    await snap(page, "desk signing off a sub-activity");
    await signOff(page, "Talent");
    // Out: the live results show the scores now.
    await expect(live.getByText("A tick shows each score that's in.", { exact: false })).toHaveCount(0, REALTIME);
    await live.context().close();
    // And its results, signed.
    const pdf = await exportFile(page, "Results (PDF) for Talent", "Export Talent");
    expect(readFileSync(await pdf.path()).subarray(0, 5).toString()).toBe("%PDF-");
  });

  test("the final cut waits for the sub-activity it counts to be signed off", async ({ page }) => {
    test.slow();
    await signInAsSuperAdmin(page);
    await page.goto(`${adminPath}?tab=session`);
    // The preliminary is done: end it, then start pageant proper.
    await page.getByRole("button", { name: "End preliminary" }).first().click();
    const end = page.getByRole("dialog", { name: "End the preliminary?" });
    await end.getByLabel("Your password").fill(ADMIN_PASSWORD);
    await end.getByRole("button", { name: "End preliminary" }).click();
    await page.getByRole("button", { name: "Start pageant proper" }).click();
    await page.getByRole("dialog", { name: "Start pageant proper?" }).getByRole("button", { name: "Start pageant proper" }).click();
    await page.getByRole("button", { name: "Judge Gown", exact: true }).click();
    await judgeCandidate(page, "Show first candidate", "Ayla", "9");
    await judgeCandidate(page, "Next: Bea", "Bea", "8");

    // The cut has every score, but Gown isn't signed off yet.
    const program = page.getByRole("region", { name: "Program" });
    await expect(program).toContainText("Waiting for sign-off");
    await program.getByRole("button", { name: /^Review / }).click();
    const cut = page.getByRole("dialog", { name: "Final cut: Top 1" });
    await expect(cut).toContainText("Gown is still to be signed off after its deliberation.");
    await expect(cut.getByRole("button", { name: "Confirm the final results" })).toBeDisabled();
    await cut.getByRole("button", { name: "Close" }).click();

    await page.getByRole("button", { name: "Start deliberation of Gown" }).click();
    await page.getByRole("dialog", { name: "Deliberate Gown?" }).getByRole("button", { name: "Start deliberation" }).click();
    for (const j of board()) await expect(j.getByRole("heading", { level: 1 })).toHaveText("Deliberation", REALTIME);
    await everyoneSigns();
    await signOff(page, "Gown");

    // Signed off: the cut is next, and confirms.
    await page.getByRole("button", { name: "Review the Top 1", exact: true }).click();
    await cut.getByRole("button", { name: "Confirm the final results" }).click();
    await expect(cut.getByRole("status").filter({ hasText: "Final results confirmed." })).toBeVisible();
    await expect(cut.locator("tbody tr").first()).toContainText("Ayla");
    await cut.getByRole("button", { name: "Close" }).click();
    await page.getByRole("button", { name: "End pageant proper" }).first().click();
    const finish = page.getByRole("dialog", { name: "End pageant proper?" });
    await finish.getByLabel("Your password").fill(ADMIN_PASSWORD);
    await finish.getByRole("button", { name: "End pageant proper" }).click();
    await expect(page.getByRole("heading", { name: "Judging has ended" })).toBeVisible(REALTIME);
  });

  test("pageant proper can start over on its own, the preliminary's scores staying", async ({ page }) => {
    await signInAsSuperAdmin(page);
    await page.goto(`${adminPath}?tab=settings`);
    await page.getByRole("button", { name: "Reset scores" }).click();
    const reset = page.getByRole("dialog", { name: "Reset every score?" });
    // The preliminary can't start over alone once pageant proper has started, and says why.
    await expect(reset.getByRole("radio", { name: /^The preliminary only/ })).toBeDisabled();
    await expect(reset).toContainText("Pageant proper has started, so the preliminary resets only with it.");
    await reset.getByRole("radio", { name: "Pageant proper only" }).check();
    const proper = page.getByRole("dialog", { name: "Reset pageant proper?" });
    await expect(proper).toContainText("This deletes pageant proper's 6 submitted scores and opens its cuts again.");
    await expectAccessible(page);
    await proper.getByLabel("Your password").fill(ADMIN_PASSWORD);
    await proper.getByRole("button", { name: "Reset pageant proper" }).click();
    await expect(proper).toBeHidden();

    // Live again, between the segments: the judges still signed in, the preliminary as it was.
    await page.goto(`${adminPath}?tab=session`);
    await expect(page.getByText("The preliminary has ended", { exact: true })).toBeVisible(REALTIME);
    await expect(page.getByText("Preliminary done · Waiting for pageant proper")).toBeVisible();
    await expect(ana.getByRole("heading", { level: 1 })).toHaveText("Pageant proper starts soon", REALTIME);
    const program = page.getByRole("region", { name: "Program" });
    await expect(program.getByRole("listitem").filter({ hasText: "Talent" })).toContainText("Done");
    await expect(program.getByRole("listitem").filter({ hasText: "Gown" })).not.toContainText("Done");

    // In the break, every other tab offers the way back to the desk: here, pageant proper's judges are all in.
    await page.goto(`${adminPath}?tab=settings`);
    await expect(page.getByRole("region", { name: "Pageant proper's 3 judges are in" }).getByRole("link", { name: "Start pageant proper" })).toBeVisible();

    // Both segments reset: the pageant starts over as if new, so its judges and candidates can change again.
    await page.getByRole("button", { name: "Reset scores" }).click();
    const all = page.getByRole("dialog", { name: "Reset every score?" });
    await expect(all).toContainText("its judges, candidates and program can change again");
    await all.getByLabel("Your password").fill(ADMIN_PASSWORD);
    await all.getByRole("button", { name: "Reset scores" }).click();
    await expect(all).toBeHidden();
    await page.goto(`${adminPath}?tab=judges`);
    await expect(page.getByRole("group", { name: "Add a judge" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Remove Cara Diaz" })).toBeVisible();
    await page.goto(`${adminPath}?tab=entries`);
    await expect(page.getByRole("heading", { name: "Add candidates" })).toBeVisible();
  });
});
