import { randomBytes, randomUUID } from "node:crypto";
import { expect, test, type Browser, type Page } from "@playwright/test";
import { expectAccessible, openJudgeLink, signInAsSuperAdmin, submitScore, supabaseAdmin } from "./helpers";

// A sub-activity in parts with each part's results its own: Production's Number comes out after a deliberation, its
// Q&A live. Judged part by part, Number's scores are a tick on the live results until it's deliberated; the Q&A's show
// at once. Two judges, Ana and Ben (chair).

const api = supabaseAdmin()!;
const RUN = Date.now().toString(36);
const REALTIME = { timeout: 20_000 };
const pageant = { id: randomUUID(), publicId: randomBytes(5).toString("hex") };
const round = { production: randomUUID(), number: randomUUID(), qa: randomUUID(), gown: randomUUID() };
const judge = { ana: randomUUID(), ben: randomUUID() };
const code = (prefix: string) => `${prefix}${RUN.toUpperCase().replace(/[^A-Z2-9]/g, "X").slice(-5).padStart(5, "X")}`;
const CODES = { ana: code("P"), ben: code("Q") };
const adminPath = `/admin/${pageant.id}`;

let ana: Page;
let ben: Page;

async function restOk(path: string, body: unknown) {
  const response = await fetch(`${api.url}/rest/v1/${path}`, {
    method: "POST",
    headers: { ...api.headers, "Content-Type": "application/json", Prefer: "return=minimal" },
    body: JSON.stringify(body),
  });
  expect(response.ok, await response.text()).toBe(true);
}

const openPage = async (browser: Browser, width: number) => (await browser.newContext({ viewport: { width, height: 800 } })).newPage();
const pairingCode = async (page: Page) =>
  (await page.locator("p").filter({ hasText: /^Pairing code [A-Z0-9]{4}$/ }).textContent())!.replace("Pairing code ", "");
/** A sub-activity's (or part's) Results choice in the program editor. */
const results = (page: Page, of: string) => page.getByRole("group", { name: `Results of ${of}`, exact: true });

/** Shows a candidate from the desk, and both judges score them. */
async function judgeCandidate(page: Page, button: string, candidate: string, score: string) {
  await page.getByRole("button", { name: button, exact: true }).click();
  for (const j of [ana, ben]) {
    await expect(j.getByRole("heading", { level: 1 })).toHaveText(candidate, REALTIME);
    await submitScore(j, candidate, score);
  }
  await expect(page.getByRole("status").filter({ hasText: `Every judge has scored ${candidate}.` })).toBeVisible(REALTIME);
}

test.describe.serial("a sub-activity in parts with each part's results its own", () => {
  test.beforeAll(async ({ browser }) => {
    await restOk("activities", {
      id: pageant.id,
      name: `E2E Pageant part results ${RUN}`,
      public_id: pageant.publicId,
      min_score: 1,
      max_score: 10,
      decimals: 0,
      kind: "pageant",
      live_scoring: true,
      preliminary_weight: 40,
    });
    const row = (id: string, name: string, segment: string, position: number, weight: number, live: boolean, parent: string | null, cut: number | null = null) => ({
      id,
      activity_id: pageant.id,
      segment,
      name,
      position,
      weight,
      cut_size: cut,
      cut_basis: cut ? ["preliminary", id] : [],
      scoring_mode: "simple",
      min_score: 1,
      max_score: 10,
      decimals: 0,
      criteria: [],
      criteria_display: "percent",
      timer_seconds: null,
      live_scoring: live,
      parent_id: parent,
    });
    // The sub-activity first: its parts point at it. It isn't live, since one of its parts waits for a deliberation.
    await restOk("rounds", [row(round.production, "Production", "preliminary", 0, 40, false, null)]);
    await restOk("rounds", [
      row(round.number, "Number", "preliminary", 0, 20, false, round.production),
      row(round.qa, "Q&A", "preliminary", 1, 20, true, round.production),
      row(round.gown, "Gown", "proper", 1, 60, true, null, 1),
    ]);
    const person = (id: string, first: string, last: string, position: number, chair: boolean) => ({
      id,
      activity_id: pageant.id,
      name: `${first} ${last}`,
      first_name: first,
      last_name: last,
      position,
      is_chair: chair,
      panel: "all",
    });
    await restOk("judges", [person(judge.ana, "Ana", "Cruz", 0, false), person(judge.ben, "Ben", "Torres", 1, true)]);
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

  test("the program sets each part's results on its own", async ({ page }) => {
    await signInAsSuperAdmin(page);
    await page.goto(`${adminPath}?tab=segments`);
    // In parts, the results are chosen on each part, not on the sub-activity.
    await expect(results(page, "Production")).toHaveCount(0);
    await expect(results(page, "Production · Number").getByRole("radio", { name: "After a deliberation" })).toBeChecked();
    await expect(results(page, "Production · Q&A").getByRole("radio", { name: "Live" })).toBeChecked();
    const ownPace = page.getByRole("checkbox", { name: "Judges score at their own pace in Production" });
    await expect(ownPace).toHaveCount(0);
    await expectAccessible(page);

    // Both parts deliberated: saved and kept, and now it can be judged at the judges' own pace.
    await results(page, "Production · Q&A").getByRole("radio", { name: "After a deliberation" }).check();
    await page.getByRole("button", { name: "Save program" }).click();
    await expect(page.getByText("Program saved", { exact: true })).toBeVisible(REALTIME);
    await page.reload();
    await expect(results(page, "Production · Number").getByRole("radio", { name: "After a deliberation" })).toBeChecked();
    await expect(results(page, "Production · Q&A").getByRole("radio", { name: "After a deliberation" })).toBeChecked();
    await expect(ownPace).toBeVisible();

    // The Q&A live again.
    await results(page, "Production · Q&A").getByRole("radio", { name: "Live" }).check();
    await expect(ownPace).toHaveCount(0);
    await page.getByRole("button", { name: "Save program" }).click();
    await expect(page.getByText("Program saved", { exact: true })).toBeVisible(REALTIME);
    await page.reload();
    await expect(results(page, "Production · Number").getByRole("radio", { name: "After a deliberation" })).toBeChecked();
    await expect(results(page, "Production · Q&A").getByRole("radio", { name: "Live" })).toBeChecked();
  });

  test("the deliberated part's scores wait for its deliberation, the live part's go out at once", async ({ page, browser }) => {
    test.slow();
    await signInAsSuperAdmin(page);
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

    // Number, after a deliberation: the audience sees a tick for each score.
    await page.getByRole("button", { name: "Judge Production · Number", exact: true }).click();
    await judgeCandidate(page, "Show first candidate", "Ayla", "8");
    await judgeCandidate(page, "Next: Bea", "Bea", "7");
    const live = await openPage(browser, 1280);
    await live.goto(`/live/${pageant.publicId}`);
    await expect(live.getByText("A tick shows each score that's in.", { exact: false })).toBeVisible(REALTIME);
    await expect(live.getByText("8", { exact: true })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Start deliberation of Production · Number" })).toBeVisible();

    // On to the Q&A before deliberating: live, its scores show as they come in.
    await page.getByRole("region", { name: "Program" }).getByRole("button", { name: "Judge now Production · Q&A" }).click();
    await judgeCandidate(page, "Show first candidate", "Ayla", "9");
    await live.reload();
    await expect(live.getByText("Production · Q&A", { exact: true })).toBeVisible(REALTIME);
    await expect(live.getByText("A tick shows each score that's in.", { exact: false })).toHaveCount(0);
    await expect(live.getByText(/^9(\.0+)?$/).first()).toBeVisible();
    await judgeCandidate(page, "Next: Bea", "Bea", "6");

    // Everything scored: Number's deliberation is still offered, and the Q&A has none.
    await expect(page.getByRole("button", { name: "Start deliberation of Production · Number" })).toBeVisible(REALTIME);
    await expect(page.getByRole("button", { name: "Start deliberation of Production · Q&A" })).toHaveCount(0);
    await live.context().close();
  });
});
