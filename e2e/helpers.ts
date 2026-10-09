import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

/** The super admin password (ADMIN_PASSWORD). */
export const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD ?? "";

/** A 1×1 PNG, enough to exercise the photo crop and upload. */
export const PHOTO = {
  name: "photo.png",
  mimeType: "image/png",
  buffer: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=", "base64"),
};

export async function signInAsSuperAdmin(page: Page) {
  await page.goto("/admin/login?as=super");
  await page.getByLabel("Super admin password").fill(ADMIN_PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/admin$/);
}

export async function signInAsOrganizer(page: Page, email: string, password: string) {
  await page.goto("/admin/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/admin$/);
}

/** Tap a score into the judge keypad. */
export async function tapScore(page: Page, score: string) {
  for (const ch of score) {
    await page.getByRole("button", { name: ch === "." ? "Decimal point" : ch, exact: true }).click();
  }
}

/** Type a score, confirm it in the dialog and wait for the saved message. */
export async function submitScore(page: Page, entry: string, score: string, shown = score) {
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(entry);
  await tapScore(page, score);
  await page.getByRole("button", { name: "Submit score" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toContainText(`Submit this score for ${entry}?`);
  await expect(dialog).toContainText(shown);
  await dialog.getByRole("button", { name: "Submit", exact: true }).click();
  await expect(page.getByRole("status").filter({ hasText: "Saved" })).toHaveText(`Saved ${shown} for ${entry}`);
}

/** Entry names on a scoreboard, top to bottom. */
export function boardOrder(page: Page) {
  return page.locator("li[data-entry]").evaluateAll((rows) => rows.map((row) => row.querySelector("p")?.textContent?.trim()));
}

/** Wait for one-off animations (a fade, a row sliding to its new rank) to settle. Endless ones are ignored. */
export async function settle(page: Page) {
  await page.waitForFunction(() =>
    document.getAnimations().every((a) => a.effect?.getTiming().iterations === Infinity || a.playState !== "running"),
  );
}

/**
 * Fail on WCAG 2.1 A/AA violations, once animations have settled: mid-fade colours aren't the
 * resting design. The Next.js dev overlay is not part of the app.
 */
export async function expectAccessible(page: Page) {
  await settle(page);
  const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).exclude("nextjs-portal").analyze();
  expect(results.violations.map((v) => `${v.id}: ${v.help} (${v.nodes.map((n) => n.target.join(" ")).join(", ")})`)).toEqual([]);
}

/** Save a screenshot into the test report, for reviewing what each screen looked like in the run. */
export async function snap(page: Page, name: string) {
  await settle(page);
  await test.info().attach(name, { body: await page.screenshot({ fullPage: true }), contentType: "image/png" });
}

function supabaseAdmin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY;
  return url && key ? { url, headers: { apikey: key, Authorization: `Bearer ${key}` } } : null;
}

/** Remove a test activity straight from the database, in case a test failed before deleting it. */
export async function deleteActivityNamed(name: string) {
  const api = supabaseAdmin();
  if (!api) return;
  await fetch(`${api.url}/rest/v1/activities?name=eq.${encodeURIComponent(name)}`, { method: "DELETE", headers: api.headers });
}

/** Remove a test organizer account straight from the database, in case a test failed before deleting it. */
export async function deleteOrganizerByEmail(email: string) {
  const api = supabaseAdmin();
  if (!api) return;
  await fetch(`${api.url}/rest/v1/admins?email=eq.${encodeURIComponent(email)}`, { method: "DELETE", headers: api.headers });
}

/** Remove test drafts straight from the database, in case a test failed before they were used or deleted. */
export async function deleteDraftsNamed(name: string) {
  const api = supabaseAdmin();
  if (!api) return;
  await fetch(`${api.url}/rest/v1/activity_drafts?name=eq.${encodeURIComponent(name)}`, { method: "DELETE", headers: api.headers });
}
