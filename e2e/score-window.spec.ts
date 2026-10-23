import { randomBytes, randomUUID } from "node:crypto";
import { devices, expect, test } from "@playwright/test";
import { openJudgeLink, SAVED, supabaseAdmin, tapScore } from "./helpers";

// A score arrives in a window, not at an instant (migration 028). A judge's confirmed score waits a few seconds, to be
// undone, before it's sent: one confirmed just before the organizer moved on still counts. And the database itself
// turns away a score once judging has ended.

const api = supabaseAdmin()!;
const RUN = Date.now().toString(36);
const activity = { id: randomUUID(), publicId: randomBytes(5).toString("hex") };
const judge = randomUUID();
const entry = randomUUID();
const nextEntry = randomUUID();
const CODE = `W${RUN.toUpperCase().replace(/[^A-Z2-9]/g, "X").slice(-5).padStart(5, "X")}`;

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

test.describe.serial("score window", () => {
  test.beforeAll(async () => {
    await restOk("activities", { id: activity.id, name: "E2E Score window", public_id: activity.publicId, min_score: 1, max_score: 10, decimals: 2, session_state: "live" });
    await restOk("judges", { id: judge, activity_id: activity.id, name: "Ana Cruz", first_name: "Ana", last_name: "Cruz", position: 0, is_chair: true });
    await restOk("judge_access", { judge_id: judge, code: CODE });
    await restOk("entries", [
      { id: entry, activity_id: activity.id, name: "Agila", position: 0 },
      { id: nextEntry, activity_id: activity.id, name: "Banog", position: 1 },
    ]);
    await restOk(`activities?id=eq.${activity.id}`, { current_entry_id: entry }, "PATCH");
  });

  test.afterAll(async () => {
    await fetch(`${api.url}/rest/v1/activities?id=eq.${activity.id}`, { method: "DELETE", headers: api.headers });
  });

  test("a score confirmed just before the organizer moves on still counts", async ({ browser }) => {
    const context = await browser.newContext({ ...devices["Pixel 7"] });
    const phone = await context.newPage();
    await openJudgeLink(phone, CODE);
    await restOk(`judge_devices?judge_id=eq.${judge}`, { status: "approved" }, "PATCH");
    await expect(phone.getByRole("heading", { level: 1 })).toHaveText("Agila", { timeout: 20_000 });

    await tapScore(phone, "8");
    await phone.getByRole("button", { name: "Submit score" }).click();
    await phone.getByRole("dialog").getByRole("button", { name: "Submit", exact: true }).click();
    // Inside Ana's few seconds to undo it, the organizer shows the next entry.
    await restOk(`activities?id=eq.${activity.id}`, { current_entry_id: nextEntry }, "PATCH");
    await expect(phone.getByRole("heading", { level: 1 })).toHaveText("Banog", { timeout: 20_000 });

    // Her score for Agila goes in all the same.
    await expect(phone.getByRole("status").filter({ hasText: "Saved" })).toHaveText("Saved 8.00 for Agila", { timeout: SAVED.timeout + 10_000 });
    const saved = await fetch(`${api.url}/rest/v1/scores?select=value&entry_id=eq.${entry}&judge_id=eq.${judge}`, { headers: api.headers });
    expect(await saved.json()).toEqual([{ value: 8 }]);
    await context.close();
  });

  test("once judging has ended, the database turns a score away", async () => {
    const now = new Date().toISOString();
    await restOk(`activities?id=eq.${activity.id}`, { session_state: "ended", session_ended_at: now }, "PATCH");
    const late = await rest("scores", { activity_id: activity.id, entry_id: nextEntry, judge_id: judge, value: 7 });
    expect(late.ok).toBe(false);
    expect((await late.json()).code).toBe("55000");
  });
});
