import { randomBytes, randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { supabaseAdmin } from "./helpers";

// A pageant sub-activity scored live by criteria shown as percentages, put on the LED wall out of 10: Evening Gown's
// 87.5% and 90% show as 8.75 and 9.00 there, with an average of 8.88, while the live results keep 88.75%.

const api = supabaseAdmin()!;
const pageant = { id: randomUUID(), publicId: randomBytes(5).toString("hex") };
const gown = randomUUID();
const judges = [randomUUID(), randomUUID()];
const ayla = randomUUID();
// Before migration 042 there's nowhere to keep the choice: the file skips.
let missing042 = false;

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
  await restOk("entries", { id: ayla, activity_id: pageant.id, name: "Ayla Mendoza", position: 0 });
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
