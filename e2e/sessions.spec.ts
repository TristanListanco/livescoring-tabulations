import { randomBytes, randomUUID } from "node:crypto";
import { devices, expect, test } from "@playwright/test";
import { hashPassword } from "../src/lib/password";
import { deleteOrganizerByEmail, signInAsOrganizer, signInAsSuperAdmin, supabaseAdmin } from "./helpers";

// Admin sessions can be ended: signing out ends a session wherever its cookie is, and an admin can sign their account
// out of another browser from their profile. Not while judges are on one of their activities, though.

const api = supabaseAdmin()!;
const RUN = Date.now().toString(36);
// An organizer of their own, so no other test's show running for the super admin holds them signed in.
const ORGANIZER = { id: randomUUID(), name: `E2E Sessions ${RUN}`, email: `e2e-sessions-${RUN}@example.com`, password: `e2e-sessions-${RUN}-1!` };
const SHOW = { id: randomUUID(), name: `E2E Sessions show ${RUN}` };

async function rest(path: string, body: unknown, method = "POST") {
  const response = await fetch(`${api.url}/rest/v1/${path}`, {
    method,
    headers: { ...api.headers, "Content-Type": "application/json", Prefer: "return=minimal" },
    body: JSON.stringify(body),
  });
  expect(response.ok, await response.text()).toBe(true);
}

test.beforeAll(async () => {
  await rest("admins", { id: ORGANIZER.id, email: ORGANIZER.email, name: ORGANIZER.name, password_hash: await hashPassword(ORGANIZER.password) });
});

test.afterAll(async () => {
  await fetch(`${api.url}/rest/v1/activities?id=eq.${SHOW.id}`, { method: "DELETE", headers: api.headers });
  await deleteOrganizerByEmail(ORGANIZER.email);
});

test("signing out ends the session, even for a copy of its cookie", async ({ browser }) => {
  const laptop = await (await browser.newContext()).newPage();
  await signInAsOrganizer(laptop, ORGANIZER.email, ORGANIZER.password);
  // Someone copies the session cookie into another browser: it works there, for now.
  const copy = await browser.newContext();
  await copy.addCookies(await laptop.context().cookies());
  const elsewhere = await copy.newPage();
  await elsewhere.goto("/admin");
  await expect(elsewhere).toHaveURL(/\/admin$/);

  // The admin signs out on the laptop, and the copy stops working too.
  // Signing out asks first.
  await laptop.getByRole("button", { name: "Sign out" }).click();
  await laptop.getByRole("dialog", { name: "Sign out?" }).getByRole("button", { name: "Sign out" }).click();
  await expect(laptop).toHaveURL(/\/admin\/login/);
  await elsewhere.goto("/admin");
  await expect(elsewhere).toHaveURL(/\/admin\/login$/);
  await laptop.context().close();
  await copy.close();
});

test("an admin signs their account out of another browser from their profile", async ({ browser }) => {
  const tablet = await (await browser.newContext({ ...devices["iPad Mini"] })).newPage();
  await signInAsSuperAdmin(tablet);
  const laptop = await (await browser.newContext()).newPage();
  await signInAsSuperAdmin(laptop);

  // The profile lists the browsers signed in, this one marked.
  await laptop.goto("/admin/profile");
  const list = laptop.getByRole("list").filter({ hasText: "This device" });
  await expect(list.getByRole("listitem").first()).toContainText("This device");
  await expect(list).toContainText("iPad · Safari");
  // The newest iPad session is the tablet's.
  await list.getByRole("button", { name: "Sign out iPad · Safari" }).first().click();
  // A toast says so, as the panel's other confirmations do.
  await expect(laptop.getByText("iPad · Safari signed out", { exact: true })).toBeVisible();

  // The tablet's next click goes to the sign-in page; the laptop carries on.
  await tablet.goto("/admin");
  await expect(tablet).toHaveURL(/\/admin\/login$/);
  await laptop.goto("/admin");
  await expect(laptop).toHaveURL(/\/admin$/);
  await tablet.context().close();
  await laptop.context().close();
});

test("an organizer can't sign out while their show is running", async ({ page }) => {
  await rest("activities", { id: SHOW.id, name: SHOW.name, public_id: randomBytes(5).toString("hex"), min_score: 1, max_score: 10, decimals: 2, owner_id: ORGANIZER.id });
  await rest(`activities?id=eq.${SHOW.id}`, { session_state: "live", session_started_at: new Date().toISOString() }, "PATCH");
  await signInAsOrganizer(page, ORGANIZER.email, ORGANIZER.password);
  await page.getByRole("button", { name: "Sign out" }).click();
  const dialog = page.getByRole("dialog", { name: "Sign out?" });
  await dialog.getByRole("button", { name: "Sign out" }).click();
  // The desk would be left without them: the dialog says so, and they stay signed in.
  await expect(dialog.getByRole("alert")).toHaveText(`${SHOW.name} is running, so you can't sign out now. End its session first.`);
  await expect(page).toHaveURL(/\/admin$/);

  // Once it has ended, they can.
  await rest(`activities?id=eq.${SHOW.id}`, { session_state: "ended", session_ended_at: new Date().toISOString() }, "PATCH");
  await dialog.getByRole("button", { name: "Sign out" }).click();
  await expect(page).toHaveURL(/\/admin\/login/);
});
