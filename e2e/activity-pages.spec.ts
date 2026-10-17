import { randomBytes, randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { signInAsSuperAdmin, supabaseAdmin } from "./helpers";

// The super admin's list of organizers' activities shows the newest 50 at a time, with every live one first. These are
// made straight in the database, dated 2001 so they sit behind everything else, and the list is opened just after them.

const api = supabaseAdmin()!;
const organizer = { id: randomUUID(), email: `e2e-pages-${Date.now().toString(36)}@example.com` };
const second = (n: number) => `2001-01-01T00:00:${String(n).padStart(2, "0")}Z`;
const name = (n: number) => `E2E Pages ${String(n).padStart(2, "0")}`;

async function rest(path: string, body: unknown) {
  const response = await fetch(`${api.url}/rest/v1/${path}`, {
    method: "POST",
    headers: { ...api.headers, "Content-Type": "application/json", Prefer: "return=minimal" },
    body: JSON.stringify(body),
  });
  expect(response.ok, await response.text()).toBe(true);
}

const remove = async () => {
  await fetch(`${api.url}/rest/v1/activities?name=like.E2E%20Pages*`, { method: "DELETE", headers: api.headers });
  await fetch(`${api.url}/rest/v1/admins?email=like.e2e-pages-*`, { method: "DELETE", headers: api.headers });
};

test.beforeAll(async () => {
  await remove();
  await rest("admins", { id: organizer.id, email: organizer.email, name: "Pages Organizer", password_hash: "x" });
  const activity = (n: number, session_state: string, label = name(n)) => ({
    name: label,
    public_id: randomBytes(5).toString("hex"),
    min_score: 1,
    max_score: 10,
    decimals: 2,
    owner_id: organizer.id,
    session_state,
    created_at: second(n),
  });
  // 51 that have ended, and one live, older than all of them.
  await rest("activities", [...Array.from({ length: 51 }, (_, i) => activity(i + 1, "ended")), activity(0, "live", "E2E Pages live")]);
});

test.afterAll(remove);

test("organizers' activities come 50 at a time, live ones first", async ({ page }) => {
  await signInAsSuperAdmin(page);
  const list = page.getByRole("region", { name: "Organizers' activities", exact: true });
  const rows = list.getByRole("row").filter({ hasText: "E2E Pages" });

  // The first page leads with every live show, however old.
  await page.goto("/admin");
  await expect(list.getByRole("row").nth(1)).toContainText("Live");
  await expect(rows.filter({ hasText: "E2E Pages live" })).toHaveCount(1);

  // From just after the newest of them: 50, newest first, and not the live one again.
  await page.goto(`/admin?before=${encodeURIComponent(second(59))}#organizer-activities`);
  await expect(rows).toHaveCount(50);
  await expect(rows.first()).toContainText(name(51));
  await expect(rows.last()).toContainText(name(2));
  await expect(rows.filter({ hasText: "E2E Pages live" })).toHaveCount(0);

  // The next page starts where that one ended.
  await list.getByRole("link", { name: "Older activities" }).click();
  await expect(rows).toHaveCount(1);
  await expect(rows).toContainText(name(1));
  await expect(list.getByRole("link", { name: "Older activities" })).toHaveCount(0);

  await list.getByRole("link", { name: "Newest activities" }).click();
  await expect(page).toHaveURL(/\/admin#organizer-activities$/);
  await expect(rows.filter({ hasText: "E2E Pages live" })).toHaveCount(1);
});
