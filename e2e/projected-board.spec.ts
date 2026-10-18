import { randomBytes, randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { supabaseAdmin } from "./helpers";

// The live results on a projector: one screen, never scrolled, paging through a list too long for it on its own.
// Phones scroll through the whole list as before.

const api = supabaseAdmin()!;
const activity = { id: randomUUID(), publicId: randomBytes(5).toString("hex") };
const ENTRIES = 14;

async function rest(path: string, body: unknown) {
  const response = await fetch(`${api.url}/rest/v1/${path}`, {
    method: "POST",
    headers: { ...api.headers, "Content-Type": "application/json", Prefer: "return=minimal" },
    body: JSON.stringify(body),
  });
  expect(response.ok, await response.text()).toBe(true);
}

test.beforeAll(async () => {
  await rest("activities", { id: activity.id, name: "E2E Projected board", public_id: activity.publicId, min_score: 1, max_score: 10, decimals: 2, session_state: "live", show_rank: true });
  const judges = [0, 1, 2].map((position) => ({ id: randomUUID(), first_name: "Judge", last_name: `P${position}`, position }));
  await rest(
    "judges",
    judges.map(({ id, first_name, last_name, position }) => ({ id, activity_id: activity.id, name: `${first_name} ${last_name}`, first_name, last_name, position, is_chair: position === 0 })),
  );
  const entries = Array.from({ length: ENTRIES }, (_, i) => ({ id: randomUUID(), activity_id: activity.id, name: `Crew ${i + 1}`, position: i }));
  await rest("entries", entries);
  // Every score but the third judge's for the last entry, which comes in during a test.
  await rest(
    "scores",
    judges.flatMap((j, ji) => entries.flatMap((e, i) => (ji === 2 && i === ENTRIES - 1 ? [] : [{ activity_id: activity.id, entry_id: e.id, judge_id: j.id, value: 9.5 - i * 0.25 }]))),
  );
  last = { entryId: entries[ENTRIES - 1].id, judgeId: judges[2].id };
});

let last: { entryId: string; judgeId: string };

test.afterAll(async () => {
  await fetch(`${api.url}/rest/v1/activities?id=eq.${activity.id}`, { method: "DELETE", headers: api.headers });
});

test("on a projector, the board is one screen and turns its own pages", async ({ browser }) => {
  const page = await (await browser.newContext({ viewport: { width: 1280, height: 720 } })).newPage();
  await page.clock.install();
  await page.goto(`/live/${activity.publicId}`);
  const where = page.locator("footer").getByText(/^Entries/);
  await expect(where).toHaveText(/^Entries 1–\d+ of 14$/);
  expect(await page.evaluate(() => document.documentElement.scrollHeight <= innerHeight)).toBe(true);
  // Every entry is still there for screen readers; only a page of them is on screen.
  await expect(page.locator("li[data-entry]")).toHaveCount(ENTRIES);
  expect(await page.locator("li[data-entry]:not([data-off])").count()).toBeLessThan(ENTRIES);

  // The leaders' page stays up a while, then the next one comes up.
  const first = (await where.textContent())!;
  await page.clock.runFor(15_000);
  await expect(where).not.toHaveText(first);

  // Someone at the screen can keep it where it is, or go straight to a page.
  const stay = page.getByRole("button", { name: "Stay on this page" });
  await stay.click();
  await expect(stay).toHaveAttribute("aria-pressed", "true");
  const kept = (await where.textContent())!;
  await page.clock.runFor(30_000);
  await expect(where).toHaveText(kept);
  await page.getByRole("button", { name: /^Entries 1 to \d+$/ }).click();
  await expect(where).toHaveText(first);
});

test("a score coming in on another page brings the board to it", async ({ browser }) => {
  const page = await (await browser.newContext({ viewport: { width: 1280, height: 720 } })).newPage();
  await page.goto(`/live/${activity.publicId}`);
  const where = page.locator("footer").getByText(/^Entries/);
  await expect(where).toHaveText(/^Entries 1–\d+ of 14$/);
  // The last entry's missing score arrives: the board turns to its page well before the leaders' page is up.
  await rest("scores", { activity_id: activity.id, entry_id: last.entryId, judge_id: last.judgeId, value: 6.25 });
  await expect(where).toHaveText(/^Entries \d+–14 of 14$/, { timeout: 12_000 });
});

test("on a phone, the board scrolls through every entry", async ({ browser }) => {
  const page = await (await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })).newPage();
  await page.goto(`/live/${activity.publicId}`);
  await expect(page.locator("li[data-entry]:not([data-off])")).toHaveCount(ENTRIES);
  await expect(page.locator("footer")).toHaveCount(0);
  await expect(page.getByText("Ranked by the average of the scores submitted so far.", { exact: false })).toBeVisible();
});
