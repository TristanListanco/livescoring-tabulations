import { randomBytes, randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { signInAsSuperAdmin, supabaseAdmin } from "./helpers";

// Edge cases on the show's screens: Space on a focused list on the desk, an LED wall that tells its operator it's
// connected (or isn't) without anything on air, and judges kept anonymous on the live results too.

const api = supabaseAdmin()!;
const activity = { id: randomUUID(), publicId: randomBytes(5).toString("hex") };
const judges = [
  ["Rosario", "Villanueva"],
  ["Teodoro", "Magbanua"],
].map(([first_name, last_name], position) => ({ id: randomUUID(), first_name, last_name, position }));
const entries = ["Crew Uno", "Crew Dos", "Crew Tres"].map((name, position) => ({ id: randomUUID(), name, position }));

async function rest(path: string, body: unknown, method = "POST") {
  const response = await fetch(`${api.url}/rest/v1/${path}`, {
    method,
    headers: { ...api.headers, "Content-Type": "application/json", Prefer: "return=minimal" },
    body: JSON.stringify(body),
  });
  expect(response.ok, await response.text()).toBe(true);
}

test.beforeAll(async () => {
  // The super admin's own activity, live, with the first entry on and every judge's score in for it.
  await rest("activities", { id: activity.id, name: "E2E Hardened screens", public_id: activity.publicId, min_score: 1, max_score: 10, decimals: 2, session_state: "live" });
  await rest(
    "judges",
    judges.map(({ id, first_name, last_name, position }) => ({ id, activity_id: activity.id, name: `${first_name} ${last_name}`, first_name, last_name, position, is_chair: position === 0 })),
  );
  await rest(
    "entries",
    entries.map((e) => ({ ...e, activity_id: activity.id })),
  );
  await rest(
    "scores",
    judges.map((j) => ({ activity_id: activity.id, entry_id: entries[0].id, judge_id: j.id, value: 9 })),
  );
  await rest(`activities?id=eq.${activity.id}`, { current_entry_id: entries[0].id, led_entry_id: entries[0].id }, "PATCH");
});

test.afterAll(async () => {
  await fetch(`${api.url}/rest/v1/activities?id=eq.${activity.id}`, { method: "DELETE", headers: api.headers });
});

test("Space scrolls a focused list on the desk rather than moving the show on", async ({ page }) => {
  await signInAsSuperAdmin(page);
  await page.goto(`/admin/${activity.id}?tab=session`);
  await expect(page.getByText("Now judging: No. 1")).toBeVisible();

  // The running order has focus, to scroll it: Space is for the list.
  await page.getByRole("list", { name: "Running order" }).focus();
  await page.keyboard.press("Space");
  await expect(page.getByText("Now judging: No. 1")).toBeVisible();
  await page.waitForTimeout(1000);
  await expect(page.getByText("Now judging: No. 1")).toBeVisible();

  // With nothing in particular focused, Space is the shortcut for the next entry.
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await page.keyboard.press("Space");
  await expect(page.getByText("Now judging: No. 2")).toBeVisible();
});

test("the LED wall tells the person at its computer what it's doing, and only them", async ({ page }) => {
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.clock.install();
  await page.goto(`/led/${activity.publicId}`);
  const panel = page.getByText(/^Showing Crew/);
  await expect(panel).toHaveCount(0);

  // A mouse move brings it up: connected, what's on, and a way to go full screen.
  await page.mouse.move(400, 300);
  await expect(panel).toBeVisible();
  await expect(page.getByRole("button", { name: "Full screen" })).toBeVisible();
  // Four seconds after the last move, the wall is just the graphic again.
  await page.clock.runFor(5_000);
  await expect(panel).toHaveCount(0);
});

test("judges kept anonymous are numbered on the live results, with no names on the page", async ({ page }) => {
  await rest(`activities?id=eq.${activity.id}`, { led_anonymous: true }, "PATCH");
  await page.goto(`/live/${activity.publicId}`);
  await expect(page.getByText("Judge 1", { exact: true })).toBeVisible();
  await expect(page.getByText("Judge 2", { exact: true })).toBeVisible();
  expect(await page.content()).not.toMatch(/Rosario|Villanueva|Teodoro|Magbanua/);
});
