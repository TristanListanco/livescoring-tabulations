import AxeBuilder from "@axe-core/playwright";
import { expect, type Page } from "@playwright/test";

export const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD ?? "";

/** A 1×1 PNG, enough to exercise the photo crop and upload. */
export const PHOTO = {
  name: "judge.png",
  mimeType: "image/png",
  buffer: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=", "base64"),
};

export async function signInAsAdmin(page: Page) {
  await page.goto("/admin/login");
  await page.getByLabel("Password").fill(ADMIN_PASSWORD);
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

/**
 * Fail on WCAG 2.1 A/AA violations. Waits for one-off animations (a new score's highlight,
 * a row sliding to its new rank) to settle first: mid-fade colours aren't the resting design.
 * The Next.js dev overlay is not part of the app.
 */
export async function expectAccessible(page: Page) {
  await page.waitForFunction(() =>
    document.getAnimations().every((a) => a.effect?.getTiming().iterations === Infinity || a.playState !== "running"),
  );
  const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).exclude("nextjs-portal").analyze();
  expect(results.violations.map((v) => `${v.id}: ${v.help} (${v.nodes.map((n) => n.target.join(" ")).join(", ")})`)).toEqual([]);
}

/** Remove a test activity straight from the database, in case a test failed before deleting it. */
export async function deleteActivityNamed(name: string) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY;
  if (!url || !key) return;
  await fetch(`${url}/rest/v1/activities?name=eq.${encodeURIComponent(name)}`, {
    method: "DELETE",
    headers: { apikey: key, Authorization: `Bearer ${key}` },
  });
}
