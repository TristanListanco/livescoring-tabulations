import { randomBytes, randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { signInAsSuperAdmin, supabaseAdmin } from "./helpers";

// An entry that can't go on is marked withdrawn mid-session: it isn't ranked or waited for any more, the database takes
// no new score for it, and the audience sees it withdrawn but never why. Reinstated, it's waited for again.

const api = supabaseAdmin()!;
const activity = { id: randomUUID(), publicId: randomBytes(5).toString("hex") };
const judges = [
  ["Rosario", "Villanueva"],
  ["Teodoro", "Magbanua"],
].map(([first_name, last_name], position) => ({ id: randomUUID(), first_name, last_name, position }));
const [agila, bagwis, kidlat] = ["Crew Agila", "Crew Bagwis", "Crew Kidlat"].map((name, position) => ({ id: randomUUID(), name, position }));
const adminPath = `/admin/${activity.id}`;
// Before migration 043 there's nowhere to keep it: the file skips.
let missing043 = false;

async function rest(path: string, body: unknown, method = "POST") {
  const response = await fetch(`${api.url}/rest/v1/${path}`, {
    method,
    headers: { ...api.headers, "Content-Type": "application/json", Prefer: "return=minimal" },
    body: JSON.stringify(body),
  });
  return response;
}
async function restOk(path: string, body: unknown, method = "POST") {
  const response = await rest(path, body, method);
  expect(response.ok, await response.text()).toBe(true);
}

test.describe.serial("a withdrawn entry", () => {
  test.beforeAll(async () => {
    const probe = await fetch(`${api.url}/rest/v1/entries?select=withdrawn_at&limit=1`, { headers: api.headers });
    missing043 = !probe.ok;
    if (missing043) return;
    // The super admin's own event, live scoring, judging under way: Agila scored by both judges, Bagwis by one so far.
    await restOk("activities", { id: activity.id, name: "E2E Withdrawn entry", public_id: activity.publicId, min_score: 1, max_score: 10, decimals: 0, live_scoring: true });
    await restOk(
      "judges",
      judges.map(({ id, first_name, last_name, position }) => ({ id, activity_id: activity.id, name: `${first_name} ${last_name}`, first_name, last_name, position })),
    );
    await restOk("entries", [agila, bagwis, kidlat].map((e) => ({ ...e, activity_id: activity.id })));
    await restOk(`activities?id=eq.${activity.id}`, { session_state: "live", session_started_at: new Date().toISOString() }, "PATCH");
    await restOk("scores", [
      ...judges.map((j) => ({ activity_id: activity.id, entry_id: agila.id, judge_id: j.id, value: 9 })),
      { activity_id: activity.id, entry_id: bagwis.id, judge_id: judges[0].id, value: 10 },
      ...judges.map((j) => ({ activity_id: activity.id, entry_id: kidlat.id, judge_id: j.id, value: 7 })),
    ]);
  });

  test.afterAll(async () => {
    await fetch(`${api.url}/rest/v1/activities?id=eq.${activity.id}`, { method: "DELETE", headers: api.headers });
  });

  test("withdrawn, it's no longer waited for, ranked or scored, and the audience isn't told why", async ({ page }) => {
    test.skip(missing043, "This database doesn't have migration 043 yet.");
    await signInAsSuperAdmin(page);
    // Bagwis is still waited for: no results yet.
    expect((await page.request.get(`${adminPath}/export`)).status()).toBe(409);

    await page.goto(`${adminPath}?tab=entries`);
    await page.getByRole("button", { name: "Withdraw Crew Bagwis" }).click();
    const dialog = page.getByRole("dialog", { name: "Withdraw Crew Bagwis?" });
    await dialog.getByRole("button", { name: "Withdraw entry" }).click();
    await expect(dialog.getByRole("alert")).toHaveText("Say why, in a few words.");
    await dialog.getByLabel("Why").fill("Fell ill backstage");
    await dialog.getByRole("button", { name: "Withdraw entry" }).click();
    await expect(page.getByText("Withdrawn: Fell ill backstage")).toBeVisible();

    // Every entry still in has every score: the results are ready.
    expect((await page.request.get(`${adminPath}/export`)).status()).toBe(200);
    // The database takes no new score for it.
    const late = await rest("scores", { activity_id: activity.id, entry_id: bagwis.id, judge_id: judges[1].id, value: 8 });
    expect(late.ok).toBe(false);
    expect(await late.text()).toContain("withdrawn");

    // The desk passes it over.
    await page.goto(`${adminPath}?tab=session`);
    const order = page.getByRole("region", { name: "Running order" });
    await expect(order.getByText("Withdrawn")).toBeVisible();
    await expect(order.getByRole("button", { name: /Crew Bagwis/ })).toHaveCount(0);

    // The audience sees it withdrawn, unranked and last, and never why.
    const audience = await (await page.context().browser()!.newContext()).newPage();
    await audience.goto(`/live/${activity.publicId}`);
    const rows = audience.locator("ol").first().locator(":scope > li");
    await expect(rows.filter({ hasText: "Crew Bagwis" })).toContainText("Withdrawn");
    await expect(rows.last()).toContainText("Crew Bagwis");
    await expect(audience.getByText("Fell ill")).toHaveCount(0);
    await audience.context().close();
  });

  test("reinstated, it's waited for again", async ({ page }) => {
    test.skip(missing043, "This database doesn't have migration 043 yet.");
    await signInAsSuperAdmin(page);
    await page.goto(`${adminPath}?tab=entries`);
    await page.getByRole("button", { name: "Reinstate Crew Bagwis" }).click();
    await page.getByRole("dialog", { name: "Reinstate Crew Bagwis?" }).getByRole("button", { name: "Reinstate" }).click();
    await expect(page.getByText("Withdrawn: Fell ill backstage")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Withdraw Crew Bagwis" })).toBeVisible();
    expect((await page.request.get(`${adminPath}/export`)).status()).toBe(409);
  });
});
