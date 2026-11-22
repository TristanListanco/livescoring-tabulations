import { expect, test } from "@playwright/test";
import { signInAsSuperAdmin, supabaseAdmin } from "./helpers";

// On a test site, the activities list makes a sample event or pageant in one click, ready to judge.

const api = supabaseAdmin()!;
const made: string[] = [];

const count = async (table: string, id: string) =>
  ((await (await fetch(`${api.url}/rest/v1/${table}?activity_id=eq.${id}&select=id`, { headers: api.headers })).json()) as unknown[]).length;

test.afterAll(async () => {
  for (const id of made) await fetch(`${api.url}/rest/v1/activities?id=eq.${id}`, { method: "DELETE", headers: api.headers });
});

for (const [kind, judges, entries, rounds] of [
  ["event", 3, 6, 0],
  ["pageant", 5, 8, 7],
] as const) {
  test(`a sample ${kind} is made from the activities list`, async ({ page }) => {
    await signInAsSuperAdmin(page);
    await page.getByRole("button", { name: `Sample ${kind}`, exact: true }).click();
    await expect(page).toHaveURL(/\/admin\/[0-9a-f-]{36}/, { timeout: 30_000 });
    const id = page.url().match(/[0-9a-f-]{36}/)![0];
    made.push(id);
    await expect(page.getByRole("heading", { level: 1 })).toContainText(`Sample ${kind}`);
    // Its judges, its entries, and a pageant's program: five sub-activities, one of them in two parts.
    expect([await count("judges", id), await count("entries", id), await count("rounds", id)]).toEqual([judges, entries, rounds]);
  });
}
