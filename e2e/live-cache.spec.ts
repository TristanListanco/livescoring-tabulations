import { randomBytes, randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { supabaseAdmin } from "./helpers";

// The live results are cached, shared by everyone watching, and keyed by when their activity last changed. A page asked
// for after a change can only come from a cache entry made after it, so it never shows the board from before, even when
// the change reached the database before the cache was told (an action that writes several times, or a slow reply).

const api = supabaseAdmin()!;
const activity = { id: randomUUID(), publicId: randomBytes(5).toString("hex") };
const judge = randomUUID();
const entry = randomUUID();

async function rest(path: string, body: unknown, method = "POST") {
  const response = await fetch(`${api.url}/rest/v1/${path}`, {
    method,
    headers: { ...api.headers, "Content-Type": "application/json", Prefer: "return=minimal" },
    body: JSON.stringify(body),
  });
  expect(response.ok, await response.text()).toBe(true);
}

test.beforeAll(async () => {
  await rest("activities", { id: activity.id, name: "E2E Live cache", public_id: activity.publicId, min_score: 1, max_score: 10, decimals: 2, session_state: "live" });
  await rest("judges", { id: judge, activity_id: activity.id, name: "Ana Cruz", first_name: "Ana", last_name: "Cruz", position: 0, is_chair: true });
  await rest("entries", { id: entry, activity_id: activity.id, name: "Agila", position: 0 });
});

test.afterAll(async () => {
  await fetch(`${api.url}/rest/v1/activities?id=eq.${activity.id}`, { method: "DELETE", headers: api.headers });
});

test("a score that reaches the database before the cache is cleared still shows at once", async ({ page }) => {
  const row = page.locator("li[data-entry]", { hasText: "Agila" });
  // Seen once, the board is cached with no scores.
  await page.goto(`/live/${activity.publicId}`);
  await expect(row).toBeVisible();
  await expect(row).not.toContainText("8.75");

  // A score goes straight into the database: the app never clears the cache for it. The board's cache entry from
  // before is still fresh (it lasts 15 seconds), but it belongs to the activity as it was.
  await rest("scores", { activity_id: activity.id, entry_id: entry, judge_id: judge, value: 8.75 });
  await page.reload();
  await expect(row).toContainText("8.75", { timeout: 3_000 });
});
