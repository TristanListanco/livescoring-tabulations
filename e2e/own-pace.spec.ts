import { randomBytes, randomUUID } from "node:crypto";
import { devices, expect, test, type Page } from "@playwright/test";
import { expectAccessible, openJudgeLink, signInAsSuperAdmin, supabaseAdmin, tapScore } from "./helpers";

// An event without live scoring can let judges score at their own pace (migration 034): each picks any entry, in any
// order, without waiting for the organizer or the chair to show it. The chair still starts the deliberation once every
// judge has scored every entry.

const api = supabaseAdmin()!;
const RUN = Date.now().toString(36);
const activity = { id: randomUUID(), publicId: randomBytes(5).toString("hex") };
const ana = randomUUID();
const ben = randomUUID();
const ENTRIES = ["Agila", "Bagwis", "Kidlat"];
const code = (letter: string) => `${letter}${RUN.toUpperCase().replace(/[^A-Z2-9]/g, "X").slice(-5).padStart(5, "X")}`;
const REALTIME = { timeout: 20_000 };
const SAVED = { timeout: 20_000 };

async function rest(path: string, body?: unknown, method = "GET") {
  return fetch(`${api.url}/rest/v1/${path}`, {
    method,
    headers: { ...api.headers, "Content-Type": "application/json", Prefer: "return=minimal" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}
async function restOk(path: string, body: unknown, method = "POST") {
  const response = await rest(path, body, method);
  expect(response.ok, await response.text()).toBe(true);
}

/** A judge's phone, signed in and approved, as the organizer's approval does. */
async function judgePhone(page: Page, judgeCode: string, judgeId: string) {
  await openJudgeLink(page, judgeCode);
  await restOk(`judge_devices?judge_id=eq.${judgeId}`, { status: "approved" }, "PATCH");
  await restOk(`judges?id=eq.${judgeId}`, { devices_updated_at: new Date().toISOString() }, "PATCH");
}

/** Score the entry on screen, past the confirmation and its few seconds to undo. */
async function score(page: Page, entry: string, value: string) {
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(entry, REALTIME);
  await tapScore(page, value);
  await page.getByRole("button", { name: "Submit score" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Submit", exact: true }).click();
  await expect(page.getByRole("status").filter({ hasText: "Saved" })).toContainText(`for ${entry}`, SAVED);
}

test.describe.serial("judges at their own pace", () => {
  test.beforeAll(async () => {
    const created = await rest("activities", {
      id: activity.id,
      name: `E2E Own pace ${RUN}`,
      public_id: activity.publicId,
      min_score: 1,
      max_score: 10,
      decimals: 2,
      live_scoring: false,
      independent_scoring: true,
    }, "POST");
    const body = created.ok ? null : await created.json();
    test.skip(body?.code === "PGRST204", "This database doesn't have migration 034 yet.");
    expect(created.ok, JSON.stringify(body)).toBe(true);
    await restOk("judges", [
      { id: ana, activity_id: activity.id, name: "Ana Cruz", first_name: "Ana", last_name: "Cruz", position: 0, is_chair: true },
      { id: ben, activity_id: activity.id, name: "Ben Torres", first_name: "Ben", last_name: "Torres", position: 1, is_chair: false },
    ]);
    await restOk("judge_access", [
      { judge_id: ana, code: code("A") },
      { judge_id: ben, code: code("B") },
    ]);
    await restOk("entries", ENTRIES.map((name, position) => ({ activity_id: activity.id, name, position })));
  });

  test.afterAll(async () => {
    await rest(`activities?id=eq.${activity.id}`, undefined, "DELETE");
  });

  test("each judge scores in their own order, and the chair starts the deliberation once everyone's done", async ({ browser, page }) => {
    const anaPhone = await (await browser.newContext({ ...devices["Pixel 7"] })).newPage();
    const benPhone = await (await browser.newContext({ ...devices["Pixel 7"] })).newPage();
    await judgePhone(anaPhone, code("A"), ana);
    await judgePhone(benPhone, code("B"), ben);
    await expect(anaPhone.getByRole("heading", { level: 1 })).toHaveText("Waiting for the organizer to start", REALTIME);

    // The session starts, and no entry is shown: each judge starts on the first one by themself.
    await restOk(`activities?id=eq.${activity.id}`, { session_state: "live" }, "PATCH");
    await score(anaPhone, "Agila", "8");
    // Saved, Ana goes on to the next she hasn't scored; she skips ahead to Kidlat from her scores.
    await expect(anaPhone.getByRole("heading", { level: 1 })).toHaveText("Bagwis");
    await anaPhone.getByRole("button", { name: /Show your scores/ }).click();
    await anaPhone.getByRole("dialog").getByRole("button", { name: /Kidlat/ }).click();
    await score(anaPhone, "Kidlat", "9");

    // She comes back to Agila to correct it, while judging is still open.
    await anaPhone.getByRole("button", { name: /Show your scores/ }).click();
    await anaPhone.getByRole("dialog").getByRole("button", { name: /Agila/ }).click();
    await anaPhone.getByRole("button", { name: "Correct this score" }).click();
    await tapScore(anaPhone, "8.5");
    await anaPhone.getByRole("button", { name: "Review correction" }).click();
    const fix = anaPhone.getByRole("dialog", { name: "Change your score for Agila?" });
    await fix.getByLabel("Why does it need correcting?").fill("Typed 8 for 8.5.");
    await fix.getByRole("button", { name: "Change score" }).click();
    await expect(anaPhone.getByText("Corrected from 8.00.")).toBeVisible(REALTIME);
    await anaPhone.getByRole("button", { name: "Next: Bagwis" }).click();
    await score(anaPhone, "Bagwis", "7");
    await expect(anaPhone.getByRole("heading", { level: 1 })).toHaveText("You've scored every entry");
    // Ana chairs: the deliberation waits for Ben.
    await expect(anaPhone.getByText("You start the deliberation here once every judge has scored every entry.")).toBeVisible();
    await expectAccessible(anaPhone);

    // The desk: no entry to show, only how far the judges have got.
    await signInAsSuperAdmin(page);
    await page.goto(`/admin/${activity.id}?tab=session`);
    await expect(page.getByText("Judges score at their own pace")).toBeVisible();
    await expect(page.getByText("3 of 6 scores in")).toBeVisible();
    await expect(page.getByRole("button", { name: /Show first entry|Show next entry/ })).toHaveCount(0);
    await expect(page.getByRole("button", { name: /^Judge now/ })).toHaveCount(0);

    // Ben goes in running order.
    for (const [entry, value] of [["Agila", "6"], ["Bagwis", "7"], ["Kidlat", "8"]]) await score(benPhone, entry, value);
    await expect(page.getByText("6 of 6 scores in")).toBeVisible(REALTIME);

    // Every score is in: the chair starts the deliberation from her screen.
    await anaPhone.getByRole("button", { name: "Start deliberation" }).click();
    await anaPhone.getByRole("dialog", { name: "Start the deliberation?" }).getByRole("button", { name: "Start deliberation" }).click();
    await expect(anaPhone.getByRole("heading", { level: 1 })).toHaveText("Deliberation", REALTIME);
    await expect(benPhone.getByRole("heading", { level: 1 })).toHaveText("Deliberation", REALTIME);
    await anaPhone.context().close();
    await benPhone.context().close();
  });
});
