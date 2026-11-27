import { randomBytes, randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { expectAccessible, openJudgeLink, SAVED, signInAsSuperAdmin, supabaseAdmin, tapScore } from "./helpers";

// A pageant sub-activity scored live by criteria shown as percentages, put on the LED wall out of 10: Evening Gown's
// 87.5% and 90% show as 8.75 and 9.00 there, with an average of 8.88, while the live results keep 88.75%. A judge
// scoring it is told what their total shows as on the wall.

const api = supabaseAdmin()!;
const pageant = { id: randomUUID(), publicId: randomBytes(5).toString("hex") };
const gown = randomUUID();
const judges = [randomUUID(), randomUUID()];
const ayla = randomUUID();
const bea = randomUUID();
const CODE = `L${Date.now().toString(36).toUpperCase().replace(/[^A-Z2-9]/g, "X").slice(-5).padStart(5, "X")}`;
// Before migration 042 there's nowhere to keep the choice: the file skips. Before 046, the wall's finish test does.
let missing042 = false;
let missing046 = false;

async function post(path: string, body: unknown) {
  return fetch(`${api.url}/rest/v1/${path}`, {
    method: "POST",
    headers: { ...api.headers, "Content-Type": "application/json", Prefer: "return=minimal" },
    body: JSON.stringify(body),
  });
}
async function restOk(path: string, body: unknown, method = "POST") {
  const response = await fetch(`${api.url}/rest/v1/${path}`, {
    method,
    headers: { ...api.headers, "Content-Type": "application/json", Prefer: "return=minimal" },
    body: JSON.stringify(body),
  });
  expect(response.ok, await response.text()).toBe(true);
}

test.beforeAll(async () => {
  missing046 = !(await fetch(`${api.url}/rest/v1/activities?select=led_finish&limit=1`, { headers: api.headers })).ok;
  await restOk("activities", { id: pageant.id, name: "E2E Pageant LED out of 10", public_id: pageant.publicId, min_score: 1, max_score: 10, decimals: 0, kind: "pageant", live_scoring: true, preliminary_weight: 40 });
  const rounds = await post("rounds", {
    id: gown,
    activity_id: pageant.id,
    segment: "preliminary",
    name: "Evening Gown",
    position: 0,
    weight: 40,
    scoring_mode: "criteria",
    min_score: 0,
    max_score: 100,
    decimals: 2,
    criteria: [{ id: "poise", name: "Poise", max: 100 }],
    criteria_display: "percent",
    timer_seconds: null,
    cut_size: null,
    cut_basis: [],
    live_scoring: true,
    led_out_of_ten: true,
  });
  if (!rounds.ok) {
    missing042 = /led_out_of_ten/.test(await rounds.text());
    expect(missing042, "the sub-activity should save").toBe(true);
    return;
  }
  await restOk(
    "judges",
    judges.map((id, position) => ({ id, activity_id: pageant.id, name: ["Ana Cruz", "Ben Torres"][position], position, is_chair: position === 0, panel: "all" })),
  );
  await restOk("entries", [
    { id: ayla, activity_id: pageant.id, name: "Ayla Mendoza", position: 0 },
    { id: bea, activity_id: pageant.id, name: "Bea Santos", position: 1 },
  ]);
  await restOk("judge_access", { judge_id: judges[0], code: CODE });
  await restOk(`activities?id=eq.${pageant.id}`, { session_state: "live", session_started_at: new Date().toISOString(), current_round_id: gown, current_entry_id: ayla, led_entry_id: ayla }, "PATCH");
  await restOk("scores", [
    { activity_id: pageant.id, round_id: gown, entry_id: ayla, judge_id: judges[0], value: 87.5, breakdown: { poise: 87.5 } },
    { activity_id: pageant.id, round_id: gown, entry_id: ayla, judge_id: judges[1], value: 90, breakdown: { poise: 90 } },
  ]);
});

test.afterAll(async () => {
  await fetch(`${api.url}/rest/v1/activities?id=eq.${pageant.id}`, { method: "DELETE", headers: api.headers });
});

test("the LED wall shows the scores out of 10, the live results keep the percentages", async ({ page }) => {
  test.skip(missing042, "This database doesn't have migration 042 yet.");
  await page.goto(`/led/${pageant.publicId}`);
  await expect(page.getByText("8.75", { exact: true })).toBeVisible();
  await expect(page.getByText("9.00", { exact: true })).toBeVisible();
  await expect(page.getByText("8.88", { exact: true })).toBeVisible();
  await expect(page.getByText("87.50%")).toHaveCount(0);

  await page.goto(`/live/${pageant.publicId}`);
  await expect(page.getByText("88.75%").first()).toBeVisible();
});

test("a judge scoring it sees what their total shows as on the wall", async ({ page, browser }) => {
  test.skip(missing042, "This database doesn't have migration 042 yet.");
  await restOk(`activities?id=eq.${pageant.id}`, { current_entry_id: bea }, "PATCH");
  const ana = await (await browser.newContext({ viewport: { width: 1180, height: 820 } })).newPage();
  await openJudgeLink(ana, CODE);
  const pairing = (await ana.locator("p").filter({ hasText: /^Pairing code [A-Z0-9]{4}$/ }).textContent())!.replace("Pairing code ", "");
  await signInAsSuperAdmin(page);
  await page.goto(`/admin/${pageant.id}?tab=judges`);
  await page.getByRole("button", { name: `Approve Ana Cruz's device ${pairing}` }).click();
  await expect(ana.getByRole("heading", { level: 1 })).toHaveText("Bea Santos", { timeout: 20_000 });

  // Over the button that submits it, the total, and what it shows as on the wall.
  await tapScore(ana, "86");
  await expect(ana.getByText("8.60 out of 10 on the LED wall", { exact: true })).toBeVisible();
  await expectAccessible(ana);
  await ana.getByRole("button", { name: "Submit score" }).click();
  const dialog = ana.getByRole("dialog");
  await expect(dialog).toContainText("Shows as 8.60 out of 10 on the LED wall.");
  await dialog.getByRole("button", { name: "Submit", exact: true }).click();
  await expect(ana.getByRole("status").filter({ hasText: "Saved" })).toHaveText("Saved 86.00 / 100 for Bea Santos", SAVED);
  await expect(ana.getByText("8.60 out of 10 on the LED wall", { exact: true })).toBeVisible();
  await ana.context().close();
});

test("the wall can be flat rather than metal and glass", async ({ page, browser }) => {
  test.skip(missing042 || missing046, "This database doesn't have migration 046 yet.");
  await signInAsSuperAdmin(page);
  await page.goto(`/admin/${pageant.id}?tab=led`);
  const finish = page.getByRole("group", { name: "Finish" });
  await expect(finish.getByRole("radio", { name: "Metal and glass" })).toBeChecked();
  const wall = await (await browser.newContext({ viewport: { width: 1280, height: 720 } })).newPage();
  await wall.goto(`/led/${pageant.publicId}`);
  await expect(wall.locator('[data-led-finish="glass"]')).toHaveCount(1);
  await finish.getByRole("radio", { name: "Flat" }).check();
  // The wall follows within seconds, and it's kept.
  await expect(wall.locator('[data-led-finish="flat"]')).toHaveCount(1, { timeout: 20_000 });
  await page.reload();
  await expect(finish.getByRole("radio", { name: "Flat" })).toBeChecked();
  await wall.context().close();
});

test("before the show, the LED tab's sample plays on a part scored live, and on none when every part deliberates", async ({ page }) => {
  // A pageant of its own, not started: pageant proper's Swimsuit comes out after a deliberation, its Gown live.
  const draft = { id: randomUUID(), publicId: randomBytes(5).toString("hex") };
  const [swimsuit, gownLive] = [randomUUID(), randomUUID()];
  await restOk("activities", { id: draft.id, name: "E2E Pageant LED sample", public_id: draft.publicId, min_score: 1, max_score: 10, decimals: 0, kind: "pageant", live_scoring: true, preliminary_weight: 40 });
  const round = (id: string, name: string, position: number, live: boolean, cut: number | null) => ({
    id,
    activity_id: draft.id,
    segment: "proper",
    name,
    position,
    weight: 30,
    scoring_mode: "simple",
    min_score: 1,
    max_score: 10,
    decimals: 0,
    criteria: [],
    criteria_display: "percent",
    timer_seconds: null,
    cut_size: cut,
    cut_basis: [],
    live_scoring: live,
  });
  try {
    await restOk("rounds", [round(swimsuit, "Swimsuit", 0, false, null), round(gownLive, "Gown", 1, true, 1)]);
    await signInAsSuperAdmin(page);
    await page.goto(`/admin/${draft.id}?tab=led`);
    await expect(page.locator("figcaption")).toContainText("Gown's judges, as the wall will show them");
    // Gown after a deliberation too: nothing live to play, and the tab says why.
    await restOk(`rounds?id=eq.${gownLive}`, { live_scoring: false }, "PATCH");
    await page.reload();
    await expect(page.locator("figcaption")).toContainText("Every part's results come after a deliberation");
  } finally {
    await fetch(`${api.url}/rest/v1/activities?id=eq.${draft.id}`, { method: "DELETE", headers: api.headers });
  }
});
