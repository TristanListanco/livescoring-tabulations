import { randomBytes, randomUUID } from "node:crypto";
import { devices, expect, test, type BrowserContext, type Page } from "@playwright/test";
import { expectAccessible, openJudgeLink, signInAsSuperAdmin, supabaseAdmin } from "./helpers";

// A judge taps Assist me, and the organizer is alerted wherever they are in the admin panel: the page blurs behind a
// dialog listing every call still waiting, with a chime and a browser notification. "On my way" answers a call, and the
// judge's screen says so. Calls are kept in assistance_requests (migration 032).

const api = supabaseAdmin()!;
const RUN = Date.now().toString(36);
const activity = { id: randomUUID(), publicId: randomBytes(5).toString("hex"), name: `E2E Assist ${RUN}` };
const ana = randomUUID();
const ben = randomUUID();
const code = (letter: string) => `${letter}${RUN.toUpperCase().replace(/[^A-Z2-9]/g, "X").slice(-5).padStart(5, "X")}`;
const ALERT = { timeout: 20_000 };

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

/** Approve a judge's device, as the organizer's approval does: their screen hears of it. */
async function approve(judgeId: string) {
  await restOk(`judge_devices?judge_id=eq.${judgeId}`, { status: "approved" }, "PATCH");
  await restOk(`judges?id=eq.${judgeId}`, { devices_updated_at: new Date().toISOString() }, "PATCH");
}

/** A judge's phone, signed in and approved, showing the entry. */
async function judgePhone(context: BrowserContext, judgeCode: string, judgeId: string): Promise<Page> {
  const phone = await context.newPage();
  await openJudgeLink(phone, judgeCode);
  await approve(judgeId);
  await expect(phone.getByRole("heading", { level: 1 })).toHaveText("Agila", ALERT);
  return phone;
}

/** Ask for help from a judge's screen, past the question that keeps a stray tap from calling anyone. */
async function askForHelp(phone: Page) {
  await phone.getByRole("button", { name: "Assist me" }).click();
  await phone.getByRole("dialog", { name: "Ask the organizer for help?" }).getByRole("button", { name: "Ask for help" }).click();
  await expect(phone.getByRole("status").filter({ hasText: "You've asked the organizer for help." })).toBeVisible();
}

test.describe.serial("judges' calls for help", () => {
  test.beforeAll(async () => {
    await restOk("activities", { id: activity.id, name: activity.name, public_id: activity.publicId, min_score: 1, max_score: 10, decimals: 2, session_state: "live" });
    await restOk("judges", [
      { id: ana, activity_id: activity.id, name: "Ana Cruz", first_name: "Ana", last_name: "Cruz", position: 0, is_chair: true },
      { id: ben, activity_id: activity.id, name: "Ben Torres", first_name: "Ben", last_name: "Torres", position: 1, is_chair: false },
    ]);
    await restOk("judge_access", [
      { judge_id: ana, code: code("A") },
      { judge_id: ben, code: code("B") },
    ]);
    const entry = randomUUID();
    await restOk("entries", { id: entry, activity_id: activity.id, name: "Agila", position: 0 });
    await restOk(`activities?id=eq.${activity.id}`, { current_entry_id: entry }, "PATCH");
  });

  test.afterAll(async () => {
    await fetch(`${api.url}/rest/v1/activities?id=eq.${activity.id}`, { method: "DELETE", headers: api.headers });
  });

  test("two judges ask at once: the organizer's panel stacks their calls, chimes and notifies, until each is answered", async ({ browser }) => {
    // The organizer's browser allows notifications; they're recorded rather than shown.
    const admin = await browser.newContext();
    await admin.addInitScript(() => {
      const shown: { title: string; body?: string }[] = [];
      (window as unknown as { shownNotifications: typeof shown }).shownNotifications = shown;
      class RecordedNotification {
        static permission = "granted";
        static requestPermission = async () => "granted";
        onclick: (() => void) | null = null;
        constructor(title: string, options?: { body?: string }) {
          shown.push({ title, body: options?.body });
        }
      }
      (window as unknown as { Notification: unknown }).Notification = RecordedNotification;
    });
    const page = await admin.newPage();
    await signInAsSuperAdmin(page);
    // On the list of activities, not this activity's desk: the alert is on every page of the panel.
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();

    const phones = await browser.newContext({ ...devices["Pixel 7"] });
    const anaPhone = await judgePhone(phones, code("A"), ana);
    const benPhone = await judgePhone(await browser.newContext({ ...devices["Pixel 7"] }), code("B"), ben);

    await askForHelp(anaPhone);
    const alert = page.getByRole("alertdialog", { name: "A judge needs help" });
    await expect(alert).toBeVisible(ALERT);
    await expect(alert.getByRole("listitem")).toHaveCount(1);
    await expect(alert.getByRole("listitem").first()).toContainText("Ana Cruz");
    await expect(alert.getByRole("listitem").first()).toContainText(activity.name);
    // The page behind it is blurred and out of reach: the dialog is modal.
    expect(await page.evaluate(() => document.querySelector("dialog[open]")?.matches(":modal"))).toBe(true);

    // A second call stacks under the first.
    await askForHelp(benPhone);
    const two = page.getByRole("alertdialog", { name: "2 judges need help" });
    await expect(two).toBeVisible(ALERT);
    await expect(two.getByRole("listitem")).toHaveText([/Ana Cruz/, /Ben Torres/]);
    await test.info().attach("organizer alerted", { body: await page.screenshot(), contentType: "image/png" });
    await test.info().attach("judge asked", { body: await anaPhone.screenshot(), contentType: "image/png" });
    // Each call notified once.
    await expect
      .poll(() => page.evaluate(() => (window as unknown as { shownNotifications: { title: string }[] }).shownNotifications.map((n) => n.title)))
      .toEqual(["Ana Cruz needs help", "Ben Torres needs help"]);
    // Escape doesn't dismiss it: each call is answered.
    await page.keyboard.press("Escape");
    await expect(two).toBeVisible();
    await expectAccessible(page);

    // On my way to Ana: her screen says so, and Ben's call is still waiting.
    await two.getByRole("button", { name: "On my way to Ana Cruz" }).click();
    await expect(page.getByRole("alertdialog", { name: "A judge needs help" }).getByRole("listitem")).toHaveText([/Ben Torres/]);
    await expect(anaPhone.getByRole("status").filter({ hasText: "The organizer is on the way." })).toBeVisible(ALERT);
    // Ben no longer needs it: he takes his call back, and the dialog goes.
    await benPhone.getByRole("button", { name: "Cancel your call for help" }).click();
    await expect(benPhone.getByRole("status").filter({ hasText: "You've asked the organizer for help." })).toHaveCount(0, ALERT);
    await expect(page.getByRole("alertdialog")).toHaveCount(0, ALERT);
    // And Ben can ask again.
    await expect(benPhone.getByRole("button", { name: "Assist me" })).toBeVisible();

    await admin.close();
    await phones.close();
    await benPhone.context().close();
  });
});
