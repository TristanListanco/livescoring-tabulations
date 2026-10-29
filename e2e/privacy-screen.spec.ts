import { randomBytes, randomUUID } from "node:crypto";
import { devices, expect, test, type Page } from "@playwright/test";
import { expectAccessible, openJudgeLink, supabaseAdmin } from "./helpers";

// While judging, a judge's phone or tablet hides its screen when it's turned away from them (toward a neighbour, or
// face up on the table), until it's turned back or the judge carries on where it is. Only once judging has started,
// only on touchscreens, and only while the organizer leaves it on (Settings; migration 032).

const api = supabaseAdmin()!;
const RUN = Date.now().toString(36);
const activity = { id: randomUUID(), publicId: randomBytes(5).toString("hex") };
const phoneJudge = randomUUID();
const laptopJudge = randomUUID();
const entry = randomUUID();
const code = (letter: string) => `${letter}${RUN.toUpperCase().replace(/[^A-Z2-9]/g, "X").slice(-5).padStart(5, "X")}`;
const REALTIME = { timeout: 20_000 };

async function rest(path: string, body: unknown, method = "POST") {
  return fetch(`${api.url}/rest/v1/${path}`, {
    method,
    headers: { ...api.headers, "Content-Type": "application/json", Prefer: "return=minimal" },
    body: JSON.stringify(body),
  });
}
async function restOk(path: string, body: unknown, method = "POST") {
  const response = await rest(path, body, method);
  expect(response.ok, await response.text()).toBe(true);
}

/** Approve a judge's device, as the organizer's approval does: their screen hears of it (devices_updated_at). */
async function approve(judgeId: string) {
  await restOk(`judge_devices?judge_id=eq.${judgeId}`, { status: "approved" }, "PATCH");
  await restOk(`judges?id=eq.${judgeId}`, { devices_updated_at: new Date().toISOString() }, "PATCH");
}

/** The device's orientation, as its sensor reports it: turned about the vertical, tipped, and rolled, in degrees. */
const orient = (page: Page, alpha: number, beta: number, gamma: number) =>
  page.evaluate(([a, b, g]) => window.dispatchEvent(new DeviceOrientationEvent("deviceorientation", { alpha: a, beta: b, gamma: g })), [alpha, beta, gamma]);

const privacy = (page: Page) => page.getByRole("alert").filter({ hasText: "Privacy screen" });

test.describe.serial("privacy screen", () => {
  test.beforeAll(async () => {
    // With the privacy screen on, as a new activity has it.
    const created = await rest("activities", {
      id: activity.id,
      name: `E2E Privacy ${RUN}`,
      public_id: activity.publicId,
      min_score: 1,
      max_score: 10,
      decimals: 2,
      privacy_screen: true,
    });
    const body = created.ok ? null : await created.json();
    test.skip(body?.code === "PGRST204", "This database doesn't have migration 032 yet.");
    expect(created.ok, JSON.stringify(body)).toBe(true);
    await restOk("judges", [
      { id: phoneJudge, activity_id: activity.id, name: "Ana Cruz", first_name: "Ana", last_name: "Cruz", position: 0, is_chair: true },
      { id: laptopJudge, activity_id: activity.id, name: "Ben Torres", first_name: "Ben", last_name: "Torres", position: 1, is_chair: false },
    ]);
    await restOk("judge_access", [
      { judge_id: phoneJudge, code: code("P") },
      { judge_id: laptopJudge, code: code("L") },
    ]);
    await restOk("entries", { id: entry, activity_id: activity.id, name: "Agila", position: 0 });
  });

  test.afterAll(async () => {
    await fetch(`${api.url}/rest/v1/activities?id=eq.${activity.id}`, { method: "DELETE", headers: api.headers });
  });

  test("on a phone, once judging starts, turning it away hides the screen until it's turned back", async ({ browser }) => {
    const context = await browser.newContext({ ...devices["Pixel 7"], permissions: ["accelerometer", "gyroscope", "magnetometer"] });
    const phone = await context.newPage();
    await openJudgeLink(phone, code("P"));
    await approve(phoneJudge);
    await expect(phone.getByRole("heading", { level: 1 })).toHaveText("Waiting for the organizer to start", REALTIME);
    // Not before judging starts.
    await orient(phone, 0, 70, 0);
    await orient(phone, 60, 70, 0);
    await expect(privacy(phone)).toHaveCount(0);

    await restOk(`activities?id=eq.${activity.id}`, { session_state: "live", current_entry_id: entry }, "PATCH");
    await expect(phone.getByRole("heading", { level: 1 })).toHaveText("Agila", REALTIME);
    // Motion sensors allowed (as Chrome on Android allows them), it reads them without asking: no banner to tap.
    await expect(phone.getByRole("button", { name: "Turn on" })).toHaveCount(0);
    // Held as the judge holds it, then turned toward a neighbour.
    await orient(phone, 0, 70, 0);
    await orient(phone, 10, 70, 0);
    await expect(privacy(phone)).toHaveCount(0);
    await orient(phone, 50, 70, 0);
    await expect(privacy(phone)).toBeVisible();
    await expect(privacy(phone)).toContainText("Turn your device back toward you to see your screen.");
    await expectAccessible(phone);
    // Turned back, it shows.
    await orient(phone, 5, 70, 0);
    await expect(privacy(phone)).toHaveCount(0);

    // Laid flat on the table it hides too, until the judge carries on there.
    await orient(phone, 5, 0, 0);
    await expect(privacy(phone)).toBeVisible();
    await phone.getByRole("button", { name: "Carry on in this position" }).click();
    await expect(privacy(phone)).toHaveCount(0);
    await orient(phone, 5, 3, 2);
    await expect(privacy(phone)).toHaveCount(0);

    // The organizer turns it off: turning the phone hides nothing.
    await restOk(`activities?id=eq.${activity.id}`, { privacy_screen: false }, "PATCH");
    await expect(phone.getByRole("heading", { level: 1 })).toHaveText("Agila");
    await phone.waitForTimeout(3_000);
    await orient(phone, 5, 3, 2);
    await orient(phone, 90, 70, 0);
    await expect(privacy(phone)).toHaveCount(0);
    await context.close();
  });

  test("a laptop has no privacy screen", async ({ browser }) => {
    const context = await browser.newContext({ ...devices["Desktop Chrome"] });
    const laptop = await context.newPage();
    await openJudgeLink(laptop, code("L"));
    await approve(laptopJudge);
    await restOk(`activities?id=eq.${activity.id}`, { privacy_screen: true }, "PATCH");
    await expect(laptop.getByRole("heading", { level: 1 })).toHaveText("Agila", REALTIME);
    await orient(laptop, 0, 70, 0);
    await orient(laptop, 90, 0, 0);
    await expect(privacy(laptop)).toHaveCount(0);
    await context.close();
  });
});
