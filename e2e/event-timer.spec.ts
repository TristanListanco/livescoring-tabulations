import { randomBytes, randomUUID } from "node:crypto";
import { devices, expect, test } from "@playwright/test";
import { openJudgeLink, SAVED, signInAsSuperAdmin, supabaseAdmin, tapScore } from "./helpers";

// An event judged an entry at a time, with simple or criteria scoring, can give judges a set time to score each entry, as a
// pageant's sub-activities can: showing an entry starts it, and once it runs out scoring closes until the organizer gives
// more time from the desk.

const api = supabaseAdmin()!;
const RUN = Date.now().toString(36);
const activity = { id: randomUUID(), publicId: randomBytes(5).toString("hex"), name: `E2E Timer ${RUN}` };
const judge = randomUUID();
const entry = randomUUID();
const code = `T${RUN.toUpperCase().replace(/[^A-Z2-9]/g, "X").slice(-5).padStart(5, "X")}`;
// The same with criteria: points for each, the timer closing before they're all in.
const criteria = { id: randomUUID(), publicId: randomBytes(5).toString("hex"), name: `E2E Timer criteria ${RUN}` };
const criteriaJudge = randomUUID();
const criteriaCode = `C${code.slice(1)}`;
const REALTIME = { timeout: 20_000 };

async function restOk(path: string, body: unknown, method = "POST") {
  const response = await fetch(`${api.url}/rest/v1/${path}`, {
    method,
    headers: { ...api.headers, "Content-Type": "application/json", Prefer: "return=minimal" },
    body: JSON.stringify(body),
  });
  expect(response.ok, await response.text()).toBe(true);
}

test.beforeAll(async () => {
  // Five seconds an entry: two entries, so the first score doesn't end judging by itself.
  await restOk("activities", { id: activity.id, name: activity.name, public_id: activity.publicId, min_score: 1, max_score: 10, decimals: 2, timer_seconds: 5 });
  await restOk("judges", [{ id: judge, activity_id: activity.id, name: "Ana Cruz", first_name: "Ana", last_name: "Cruz", position: 0, is_chair: true }]);
  await restOk("entries", [
    { id: entry, activity_id: activity.id, name: "Agila", position: 0 },
    { id: randomUUID(), activity_id: activity.id, name: "Bagwis", position: 1 },
  ]);
  await restOk("judge_access", [{ judge_id: judge, code }]);
  await restOk(`activities?id=eq.${activity.id}`, { session_state: "live" }, "PATCH");

  await restOk("activities", {
    id: criteria.id,
    name: criteria.name,
    public_id: criteria.publicId,
    scoring_mode: "criteria",
    criteria: [
      { id: "talent", name: "Talent", max: 60 },
      { id: "poise", name: "Poise", max: 40 },
    ],
    min_score: 0,
    max_score: 100,
    decimals: 0,
    timer_seconds: 5,
  });
  await restOk("judges", [{ id: criteriaJudge, activity_id: criteria.id, name: "Ben Reyes", first_name: "Ben", last_name: "Reyes", position: 0, is_chair: true }]);
  await restOk("entries", [
    { id: randomUUID(), activity_id: criteria.id, name: "Agila", position: 0 },
    { id: randomUUID(), activity_id: criteria.id, name: "Bagwis", position: 1 },
  ]);
  await restOk("judge_access", [{ judge_id: criteriaJudge, code: criteriaCode }]);
  await restOk(`activities?id=eq.${criteria.id}`, { session_state: "live" }, "PATCH");
});

test.afterAll(async () => {
  for (const id of [activity.id, criteria.id]) await fetch(`${api.url}/rest/v1/activities?id=eq.${id}`, { method: "DELETE", headers: api.headers });
});

test("an event's scoring timer closes scoring until the organizer gives more time", async ({ page, browser }) => {
  const phone = await (await browser.newContext({ ...devices["Pixel 7"] })).newPage();
  await openJudgeLink(phone, code);
  await restOk(`judge_devices?judge_id=eq.${judge}`, { status: "approved" }, "PATCH");
  await restOk(`judges?id=eq.${judge}`, { devices_updated_at: new Date().toISOString() }, "PATCH");
  await expect(phone.getByRole("heading", { level: 1 })).toHaveText(/for the first entry$/, REALTIME);

  // Showing the entry starts the timer on the judge's screen and on the desk.
  await signInAsSuperAdmin(page);
  await page.goto(`/admin/${activity.id}?tab=session`);
  await page.getByRole("button", { name: "Show first entry" }).click();
  await expect(phone.getByRole("heading", { level: 1 })).toHaveText("Agila", REALTIME);

  // Five seconds on: red, and the keypad can't submit.
  await expect(phone.getByRole("status").filter({ hasText: "Scoring closed" })).toBeVisible(REALTIME);
  await tapScore(phone, "9");
  await expect(phone.getByRole("button", { name: "Submit score" })).toBeDisabled();

  // The organizer gives 15 more seconds: green again, and the score goes in.
  await page.getByRole("button", { name: /15 s$/ }).click();
  await expect(phone.getByRole("status").filter({ hasText: "Scoring open" })).toBeVisible(REALTIME);
  await phone.getByRole("button", { name: "Submit score" }).click();
  await phone.getByRole("dialog").getByRole("button", { name: "Submit", exact: true }).click();
  await expect(phone.getByRole("status").filter({ hasText: "Saved" })).toHaveText("Saved 9.00 for Agila", SAVED);
  await phone.context().close();
});

test("with criteria too, the timer closes scoring until the organizer gives more time", async ({ page, browser }) => {
  const phone = await (await browser.newContext({ ...devices["Pixel 7"] })).newPage();
  await openJudgeLink(phone, criteriaCode);
  await restOk(`judge_devices?judge_id=eq.${criteriaJudge}`, { status: "approved" }, "PATCH");
  await restOk(`judges?id=eq.${criteriaJudge}`, { devices_updated_at: new Date().toISOString() }, "PATCH");
  // Told the time limit while waiting for the entry.
  await expect(phone.getByText("You have 0:05 to score each entry once it's shown.", { exact: false })).toBeVisible(REALTIME);

  await signInAsSuperAdmin(page);
  await page.goto(`/admin/${criteria.id}?tab=session`);
  await page.getByRole("button", { name: "Show first entry" }).click();
  await expect(phone.getByRole("heading", { level: 1 })).toHaveText("Agila", REALTIME);

  // Time runs out mid-way: every criterion's points can still be typed, but not submitted.
  await expect(phone.getByRole("status").filter({ hasText: "Scoring closed" })).toBeVisible(REALTIME);
  await tapScore(phone, "50");
  await phone.getByRole("button", { name: "Next: Poise" }).click();
  await tapScore(phone, "30");
  await expect(phone.getByRole("button", { name: "Submit score" })).toBeDisabled();

  await page.getByRole("button", { name: /15 s$/ }).click();
  await expect(phone.getByRole("status").filter({ hasText: "Scoring open" })).toBeVisible(REALTIME);
  await phone.getByRole("button", { name: "Submit score" }).click();
  await phone.getByRole("dialog").getByRole("button", { name: "Submit", exact: true }).click();
  await expect(phone.getByRole("status").filter({ hasText: "Saved" })).toHaveText("Saved 80 / 100 for Agila", SAVED);
  // Under the score, the points for each criterion, to compare the next entries by (Bagwis is still to come).
  await expect(phone.getByRole("list", { name: "Your points for each criterion" }).getByRole("listitem")).toHaveText([/^Talent\s*50\s*\/ 60$/, /^Poise\s*30\s*\/ 40$/]);
  await phone.context().close();
});
