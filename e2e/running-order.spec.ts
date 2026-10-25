import { randomBytes, randomUUID } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";
import { expectAccessible, signInAsSuperAdmin, snap, supabaseAdmin } from "./helpers";

// An event's running order can be drawn at random from its Entries tab, as often as the organizer likes, until the
// session starts: then it's locked, on the page and in the database itself (migration 030).

const api = supabaseAdmin()!;
const activity = { id: randomUUID(), publicId: randomBytes(5).toString("hex") };
const NAMES = ["Agila", "Banog", "Cabagan", "Dalisay"];

async function rest(path: string, body: unknown, method = "POST", headers: Record<string, string> = api.headers) {
  return fetch(`${api.url}/rest/v1/${path}`, {
    method,
    headers: { ...headers, "Content-Type": "application/json", Prefer: "return=minimal" },
    body: JSON.stringify(body),
  });
}
async function restOk(path: string, body: unknown, method = "POST") {
  const response = await rest(path, body, method);
  expect(response.ok, await response.text()).toBe(true);
}

/** The order the Entries tab lists, by each entry's name field. */
async function listed(page: Page) {
  return page.getByLabel(/^Entry \d+ name$/).evaluateAll((fields) => fields.map((f) => (f as HTMLInputElement).value));
}
/** The order the database keeps: the entries' names, or their ids. */
async function stored(column: "name" | "id" = "name") {
  const response = await fetch(`${api.url}/rest/v1/entries?select=${column}&activity_id=eq.${activity.id}&order=position`, { headers: api.headers });
  return ((await response.json()) as Record<string, string>[]).map((e) => e[column]);
}

test.describe.serial("running order", () => {
  test.beforeAll(async () => {
    await restOk("activities", { id: activity.id, name: `E2E Running order ${Date.now().toString(36)}`, public_id: activity.publicId, min_score: 1, max_score: 10, decimals: 2 });
    await restOk("entries", NAMES.map((name, position) => ({ activity_id: activity.id, name, position })));
  });

  test.afterAll(async () => {
    await fetch(`${api.url}/rest/v1/activities?id=eq.${activity.id}`, { method: "DELETE", headers: api.headers });
  });

  test("before the session starts, the organizer shuffles it, as often as they like", async ({ page }) => {
    await signInAsSuperAdmin(page);
    await page.goto(`/admin/${activity.id}?tab=entries`);
    expect(await listed(page)).toEqual(NAMES);

    for (let draw = 0; draw < 2; draw++) {
      await page.getByRole("button", { name: "Shuffle order" }).click();
      const dialog = page.getByRole("dialog", { name: "Shuffle the running order?" });
      await expect(dialog).toContainText("Starting the session locks the order.");
      if (draw === 0) await snap(page, "shuffle dialog");
      await dialog.getByRole("button", { name: "Shuffle", exact: true }).click();
      await expect(dialog).toBeHidden();
      // A fair draw can come out in the order it was, so what's checked is that it's the same entries, each once, as
      // the page and the database both have them, first where the message says.
      const status = page.getByRole("status").filter({ hasText: /^Shuffled\. .+ is now first\.$/ });
      await expect(status).toBeVisible();
      const first = (await status.textContent())!.replace(/^Shuffled\. (.+) is now first\.$/, "$1");
      await expect(page.getByLabel("Entry 1 name")).toHaveValue(first);
      const order = await stored();
      expect([...order].sort()).toEqual(NAMES);
      expect(await listed(page)).toEqual(order);
    }
    await snap(page, "shuffled");
    await expectAccessible(page);

    // Moving an entry by hand afterwards still works, and the message about who's first goes.
    const second = (await stored())[1];
    await page.getByRole("button", { name: `Move ${second} up` }).click();
    await expect(page.getByLabel("Entry 1 name")).toHaveValue(second);
    await expect(page.getByRole("status").filter({ hasText: /is now first/ })).toHaveCount(0);
    expect((await stored())[0]).toBe(second);
  });

  test("once the session has started, the order is locked: on the page and in the database", async ({ page }) => {
    const before = await stored();
    await restOk(`activities?id=eq.${activity.id}`, { session_state: "live" }, "PATCH");
    await signInAsSuperAdmin(page);
    await page.goto(`/admin/${activity.id}?tab=entries`);
    await expect(page.getByRole("note")).toContainText("the running order is locked");
    await expect(page.getByRole("button", { name: "Shuffle order" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: /^Move .+ (up|down)$/ })).toHaveCount(0);

    // Even straight to the database, it refuses. (A database without migration 030 has only the app's check.)
    const late = await rest("rpc/set_entry_order", { activity: activity.id, entry_ids: (await stored("id")).reverse() });
    const { code } = await late.json();
    test.skip(code === "PGRST202", "This database doesn't have migration 030 yet.");
    expect(code).toBe("55000");
    expect(await stored()).toEqual(before);
  });

  test("only the server can set the order", async () => {
    const publicKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!;
    const response = await rest("rpc/set_entry_order", { activity: activity.id, entry_ids: [] }, "POST", { apikey: publicKey, Authorization: `Bearer ${publicKey}` });
    expect(response.ok).toBe(false);
  });
});
