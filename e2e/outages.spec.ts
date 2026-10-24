import { randomBytes, randomUUID } from "node:crypto";
import { devices, expect, test } from "@playwright/test";
import { openJudgeLink, SAVED, supabaseAdmin, tapScore } from "./helpers";

// Screens that are on all show long come back by themselves after the venue Wi-Fi drops or the server has a bad few
// seconds: never left on an error page until someone reloads them.

const api = supabaseAdmin()!;
const RUN = Date.now().toString(36);
const activity = { id: randomUUID(), publicId: randomBytes(5).toString("hex") };
const judge = randomUUID();
// Another judge, whose scores the audience sees, so Ana's screen still waits for hers.
const otherJudge = randomUUID();
const entry = randomUUID();
const nextEntry = randomUUID();
const CODE = `O${RUN.toUpperCase().replace(/[^A-Z2-9]/g, "X").slice(-5).padStart(5, "X")}`;

async function rest(path: string, body: unknown, method = "POST") {
  const response = await fetch(`${api.url}/rest/v1/${path}`, {
    method,
    headers: { ...api.headers, "Content-Type": "application/json", Prefer: "return=minimal" },
    body: JSON.stringify(body),
  });
  expect(response.ok, await response.text()).toBe(true);
}

test.describe.serial("outages", () => {
  test.beforeAll(async () => {
    await rest("activities", { id: activity.id, name: "E2E Outages", public_id: activity.publicId, min_score: 1, max_score: 10, decimals: 2, session_state: "live" });
    await rest("judges", [
      { id: judge, activity_id: activity.id, name: "Ana Cruz", first_name: "Ana", last_name: "Cruz", position: 0, is_chair: true },
      { id: otherJudge, activity_id: activity.id, name: "Ben Torres", first_name: "Ben", last_name: "Torres", position: 1, is_chair: false },
    ]);
    await rest("judge_access", { judge_id: judge, code: CODE });
    await rest("entries", [
      { id: entry, activity_id: activity.id, name: "Agila", position: 0 },
      { id: nextEntry, activity_id: activity.id, name: "Banog", position: 1 },
    ]);
    await rest(`activities?id=eq.${activity.id}`, { current_entry_id: entry }, "PATCH");
  });

  test.afterAll(async () => {
    await fetch(`${api.url}/rest/v1/activities?id=eq.${activity.id}`, { method: "DELETE", headers: api.headers });
  });

  test("the live results come back after the Wi-Fi drops", async ({ page, context }) => {
    await page.goto(`/live/${activity.publicId}`);
    await expect(page.locator("li[data-entry]", { hasText: "Agila" })).toBeVisible();
    await context.setOffline(true);
    // A score while it's offline: something to catch up on once it can.
    await rest("scores", { activity_id: activity.id, entry_id: entry, judge_id: otherJudge, value: 8.75 });
    await page.waitForTimeout(8_000);
    await context.setOffline(false);
    await expect(page.locator("li[data-entry]", { hasText: "Agila" })).toContainText("8.75", { timeout: 30_000 });
  });

  test("the live results come back after the server fails for a few seconds", async ({ page }) => {
    await page.goto(`/live/${activity.publicId}`);
    await expect(page.locator("li[data-entry]", { hasText: "Agila" })).toBeVisible();
    // Every request for the page fails for six seconds, as when the database is down.
    let down = true;
    await page.route(`**/live/${activity.publicId}**`, (route) =>
      down ? route.fulfill({ status: 500, contentType: "text/html", body: "Internal Server Error" }) : route.fallback(),
    );
    await rest(`entries?id=eq.${entry}`, { name: "Agila Uno" }, "PATCH");
    await page.waitForTimeout(6_000);
    down = false;
    await expect(page.locator("li[data-entry]", { hasText: "Agila Uno" })).toBeVisible({ timeout: 45_000 });
  });

  test("a judge's phone without realtime comes back after the Wi-Fi drops", async ({ browser }) => {
    const context = await browser.newContext({ ...devices["Pixel 7"] });
    // Realtime blocked, as on some venue Wi-Fi: the screen keeps up by checking.
    await context.routeWebSocket(/realtime/, (ws) => ws.close());
    const phone = await context.newPage();
    await openJudgeLink(phone, CODE);
    await rest(`judge_devices?judge_id=eq.${judge}`, { status: "approved" }, "PATCH");
    await expect(phone.getByRole("heading", { level: 1 })).toHaveText("Agila Uno", { timeout: 20_000 });

    await context.setOffline(true);
    await phone.waitForTimeout(10_000);
    await context.setOffline(false);
    // Back on its screen, and following the show: the organizer moved on while it was offline.
    await rest(`activities?id=eq.${activity.id}`, { current_entry_id: nextEntry }, "PATCH");
    await expect(phone.getByRole("heading", { level: 1 })).toHaveText("Banog", { timeout: 45_000 });
    await context.close();
  });

  test("a score that didn't get through is sent again by itself", async ({ browser }) => {
    const context = await browser.newContext({ ...devices["Pixel 7"] });
    const phone = await context.newPage();
    await openJudgeLink(phone, CODE);
    // Approving it, as the organizer would: the phone from the test before is signed out (a judge has one approved device).
    await rest(`judge_devices?judge_id=eq.${judge}&status=eq.approved`, { status: "revoked" }, "PATCH");
    await rest(`judge_devices?judge_id=eq.${judge}&status=eq.pending`, { status: "approved" }, "PATCH");
    await expect(phone.getByRole("heading", { level: 1 })).toHaveText("Banog", { timeout: 20_000 });
    // The first send is cut off before it reaches the server.
    let cut = false;
    await phone.route("**/judge/score", (route) => {
      if (!cut && route.request().method() === "POST" && route.request().headers()["next-action"]) {
        cut = true;
        return route.abort("connectionreset");
      }
      return route.fallback();
    });
    await tapScore(phone, "8");
    await phone.getByRole("button", { name: "Submit score" }).click();
    await phone.getByRole("dialog").getByRole("button", { name: "Submit", exact: true }).click();
    // The judge does nothing more: it goes again, and is saved.
    await expect(phone.getByRole("status").filter({ hasText: "Saved" })).toHaveText("Saved 8.00 for Banog", { timeout: SAVED.timeout + 10_000 });
    expect(cut).toBe(true);
    await context.close();
  });
});
