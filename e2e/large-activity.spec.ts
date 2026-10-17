import { randomBytes, randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { supabaseAdmin } from "./helpers";

// Supabase returns at most 1,000 rows to one read and quietly leaves out the rest. An activity with more scores than
// that (600 entries, two judges: 1,200) still shows every one of them: each entry's average is both judges'.

const api = supabaseAdmin()!;
const activity = { id: randomUUID(), publicId: randomBytes(5).toString("hex") };
const ENTRIES = 600;

async function rest(path: string, body: unknown) {
  const response = await fetch(`${api.url}/rest/v1/${path}`, {
    method: "POST",
    headers: { ...api.headers, "Content-Type": "application/json", Prefer: "return=minimal" },
    body: JSON.stringify(body),
  });
  expect(response.ok, await response.text()).toBe(true);
}

test.beforeAll(async () => {
  await rest("activities", { id: activity.id, name: "E2E Large activity", public_id: activity.publicId, min_score: 1, max_score: 10, decimals: 2, session_state: "live" });
  const judges = [8, 9].map((value, i) => ({ id: randomUUID(), value, first_name: "Judge", last_name: `N${i}`, position: i }));
  await rest(
    "judges",
    judges.map(({ id, first_name, last_name, position }) => ({ id, activity_id: activity.id, name: `${first_name} ${last_name}`, first_name, last_name, position, is_chair: position === 0 })),
  );
  const entries = Array.from({ length: ENTRIES }, (_, i) => ({ id: randomUUID(), activity_id: activity.id, name: `Entry ${i + 1}`, position: i }));
  await rest("entries", entries);
  // One judge gives every entry 8, the other 9: an entry missing either score would show 8.00 or 9.00, not 8.50.
  await rest("scores", judges.flatMap((j) => entries.map((e) => ({ activity_id: activity.id, entry_id: e.id, judge_id: j.id, value: j.value }))));
});

test.afterAll(async () => {
  await fetch(`${api.url}/rest/v1/activities?id=eq.${activity.id}`, { method: "DELETE", headers: api.headers });
});

test("every one of 1,200 scores counts", async ({ page }) => {
  await page.goto(`/live/${activity.publicId}`);
  const rows = page.locator("li[data-entry]");
  await expect(rows).toHaveCount(ENTRIES);
  await expect(rows.filter({ hasText: "8.50" })).toHaveCount(ENTRIES);
});
