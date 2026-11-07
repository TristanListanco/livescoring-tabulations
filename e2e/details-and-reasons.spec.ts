import { randomBytes, randomUUID } from "node:crypto";
import { devices, expect, test } from "@playwright/test";
import { deleteActivityNamed, expectAccessible, openJudgeLink, signInAsSuperAdmin, submitScore, supabaseAdmin, tapScore } from "./helpers";

// An event can keep up to three details about each entry (a school, a division), seen only by the organizer: on the
// Entries tab and in the results, never by judges or the public. And without live scoring, the organizer can have
// judges pick why they correct a score from a list, typing it only under Other (migration 033).

const api = supabaseAdmin()!;
const RUN = Date.now().toString(36);
const NAME = `E2E Details ${RUN}`;
const REALTIME = { timeout: 20_000 };

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

test.beforeAll(async () => {
  const probe = await rest("entries?select=details&limit=1");
  test.skip(!probe.ok, "This database doesn't have migration 033 yet.");
});

test.afterAll(async () => {
  await deleteActivityNamed(NAME);
});

test("an event's entries carry details only the organizer sees, in the results too", async ({ page }) => {
  await signInAsSuperAdmin(page);
  await page.goto("/admin/new");
  await page.getByLabel("Name", { exact: true }).fill(NAME);
  await page.getByRole("button", { name: "Remove judge 3" }).click();
  await page.getByRole("button", { name: "Remove judge 2" }).click();
  await page.getByLabel("Judge 1 first name").fill("Ana");
  await page.getByLabel("Judge 1 last name").fill("Cruz");
  await page.getByRole("radio", { name: "Chair of the board of judges: judge 1" }).check();
  // The names, then two details (folded away until asked for), filled in entry by entry.
  await page.getByLabel("Entry names, one per line").fill("Agila\nBagwis");
  await page.getByText("Details for each entry", { exact: true }).click();
  await page.getByLabel("Detail 1 name").fill("School");
  await page.getByLabel("Detail 2 name").fill("Division");
  await page.getByLabel("School for Agila").fill("Xavier University");
  await page.getByLabel("Division for Agila").fill("Division 2");
  await page.getByLabel("School for Bagwis").fill("MSU-IIT");
  await page.getByRole("checkbox", { name: /Show scores live/ }).check();
  await page.getByLabel("Signatory 1 full name").fill("Maria Reyes");
  await page.getByRole("button", { name: "Create activity" }).click();
  await expect(page).toHaveURL(/\/admin\/[0-9a-f-]{36}$/, { timeout: 20_000 });
  const adminPath = new URL(page.url()).pathname;
  const activityId = adminPath.split("/").at(-1)!;

  // The Entries tab has them, to change.
  await page.goto(`${adminPath}?tab=entries`);
  await expect(page.getByLabel("School for Agila")).toHaveValue("Xavier University");
  await expect(page.getByLabel("Division for Agila")).toHaveValue("Division 2");
  await expect(page.getByLabel("School for Bagwis")).toHaveValue("MSU-IIT");
  await page.getByLabel("Division for Bagwis").fill("Division 1");
  await page.getByRole("button", { name: "Save Bagwis" }).click();
  await expect(page.getByRole("button", { name: "Save Bagwis" })).toBeHidden();
  // Renaming a detail keeps its values.
  await page.getByLabel("Detail 2 name").fill("Category");
  await page.getByRole("button", { name: "Save details for each entry" }).click();
  await expect(page.getByLabel("Category for Bagwis")).toHaveValue("Division 1", REALTIME);
  await expectAccessible(page);

  // Judged and ended (straight through the database), the results carry them, a column each.
  const { publicId, judge, entries } = await (async () => {
    const a = await (await rest(`activities?select=public_id&id=eq.${activityId}`)).json();
    const j = await (await rest(`judges?select=id&activity_id=eq.${activityId}`)).json();
    const e = await (await rest(`entries?select=id,name&activity_id=eq.${activityId}&order=position`)).json();
    return { publicId: a[0].public_id as string, judge: j[0].id as string, entries: e as { id: string; name: string }[] };
  })();
  await restOk(`activities?id=eq.${activityId}`, { session_state: "live" }, "PATCH");
  await restOk("scores", entries.map((e, i) => ({ activity_id: activityId, entry_id: e.id, judge_id: judge, value: 9 - i })));
  await restOk(`activities?id=eq.${activityId}`, { session_state: "ended", session_ended_at: new Date().toISOString() }, "PATCH");
  const csv = await (await page.request.get(`${adminPath}/export?format=csv`)).text();
  expect(csv).toContain("Rank,No.,Entry,School,Category,Ana Cruz,Average");
  expect(csv).toContain("Agila,Xavier University,Division 2,");
  expect(csv).toContain("Bagwis,MSU-IIT,Division 1,");

  // Never on the public page.
  await page.goto(`/live/${publicId}`);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(NAME);
  expect(await page.content()).not.toContain("Xavier University");
});

test("without live scoring, judges can pick why they correct a score from a list", async ({ browser }) => {
  const activity = { id: randomUUID(), publicId: randomBytes(5).toString("hex") };
  const judge = randomUUID();
  const entry = randomUUID();
  const code = `R${RUN.toUpperCase().replace(/[^A-Z2-9]/g, "X").slice(-5).padStart(5, "X")}`;
  await restOk("activities", {
    id: activity.id,
    name: `${NAME} reasons`,
    public_id: activity.publicId,
    min_score: 1,
    max_score: 10,
    decimals: 2,
    live_scoring: false,
    correction_reasons: true,
  });
  await restOk("judges", { id: judge, activity_id: activity.id, name: "Ana Cruz", first_name: "Ana", last_name: "Cruz", position: 0, is_chair: true });
  await restOk("judge_access", { judge_id: judge, code });
  await restOk("entries", { id: entry, activity_id: activity.id, name: "Agila", position: 0 });
  await restOk(`activities?id=eq.${activity.id}`, { session_state: "live", current_entry_id: entry }, "PATCH");

  const context = await browser.newContext({ ...devices["Pixel 7"] });
  const phone = await context.newPage();
  await openJudgeLink(phone, code);
  await restOk(`judge_devices?judge_id=eq.${judge}`, { status: "approved" }, "PATCH");
  await restOk(`judges?id=eq.${judge}`, { devices_updated_at: new Date().toISOString() }, "PATCH");
  await submitScore(phone, "Agila", "7", "7.00");

  await phone.getByRole("button", { name: "Correct this score" }).click();
  await tapScore(phone, "8");
  await phone.getByRole("button", { name: "Review correction" }).click();
  const fix = phone.getByRole("dialog", { name: "Change your score for Agila?" });
  const reasons = fix.getByRole("group", { name: "Why does it need correcting?" });
  await expect(reasons.getByRole("radio")).toHaveCount(6);
  await expect(fix.getByRole("button", { name: "Change score" })).toBeDisabled();
  // Other opens the box to type it.
  await reasons.getByRole("radio", { name: "Other reason" }).check();
  await expect(fix.getByLabel("Your reason")).toBeVisible();
  await reasons.getByRole("radio", { name: "I typed the wrong number." }).check();
  await expect(fix.getByLabel("Your reason")).toHaveCount(0);
  await expectAccessible(phone);
  await fix.getByRole("button", { name: "Change score" }).click();
  await expect(phone.getByText("Corrected from 7.00.")).toBeVisible(REALTIME);

  // The reason chosen is the one kept.
  const kept = await (await rest(`score_corrections?select=reason&activity_id=eq.${activity.id}`)).json();
  expect(kept).toEqual([{ reason: "I typed the wrong number." }]);
  await context.close();
  await rest(`activities?id=eq.${activity.id}`, undefined, "DELETE");
});
