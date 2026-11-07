import { expect, test } from "@playwright/test";
import { expectAccessible, signInAsSuperAdmin } from "./helpers";

// The privacy policy, the terms of service and the cookie policy: public pages, reachable from wherever people sign in.

const CONTACT = "tristan.listanco@g.msuiit.edu.ph";

for (const [path, title] of [
  ["/privacy", "Privacy policy"],
  ["/terms", "Terms of service"],
  ["/cookies", "Cookie policy"],
] as const) {
  test(`${title} is public, dated, says who to contact, and is accessible`, async ({ page }) => {
    await page.goto(path);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(title);
    await expect(page).toHaveTitle(`${title} | Tabulous`);
    await expect(page.getByText(/^Effective \w+ \d{1,2}, \d{4}$/)).toBeVisible();
    await expect(page.getByRole("link", { name: CONTACT }).first()).toHaveAttribute("href", `mailto:${CONTACT}`);
    await expectAccessible(page);
  });
}

test("the pages people sign in from link to all three", async ({ page }) => {
  for (const path of ["/", "/judge", "/admin/login"]) {
    await page.goto(path);
    const legal = page.getByRole("navigation", { name: "Legal" });
    await expect(legal.getByRole("link", { name: "Privacy policy" })).toHaveAttribute("href", "/privacy");
    await expect(legal.getByRole("link", { name: "Terms of service" })).toHaveAttribute("href", "/terms");
    await expect(legal.getByRole("link", { name: "Cookie policy" })).toHaveAttribute("href", "/cookies");
  }
  // And the organizer's panel, once signed in: from their profile, not at the foot of every page.
  await signInAsSuperAdmin(page);
  await expect(page.getByRole("navigation", { name: "Legal" })).toHaveCount(0);
  await page.goto("/admin/profile");
  // Opened from a link in the app, each is a dialog over the page; Close goes back to it, even after the one has led
  // to the other.
  await page.getByRole("navigation", { name: "Legal" }).getByRole("link", { name: "Terms of service" }).click();
  const terms = page.getByRole("dialog", { name: "Terms of service" });
  await expect(terms.getByRole("heading", { level: 1 })).toHaveText("Terms of service");
  await terms.getByRole("link", { name: "privacy policy" }).first().click();
  const privacy = page.getByRole("dialog", { name: "Privacy policy" });
  await expect(privacy.getByRole("heading", { level: 1 })).toHaveText("Privacy policy");
  await expectAccessible(page);
  await privacy.getByRole("button", { name: "Close" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page).toHaveURL(/\/admin\/profile$/);
});

test("where people first arrive, a notice says Tabulous uses only essential cookies, once per browser", async ({ page }) => {
  await page.goto("/");
  const notice = page.getByRole("region", { name: "Cookies" });
  await expect(notice).toContainText("Tabulous uses only essential cookies");
  await expect(notice.getByRole("link", { name: "Cookie policy" })).toHaveAttribute("href", "/cookies");
  // The judges' sign-in links the policies once, under its button: its notice points there rather than linking again.
  await page.goto("/judge");
  await expect(notice).toContainText("The cookie policy below says which.");
  await expect(page.getByRole("link", { name: /policy|terms/i })).toHaveCount(3);
  await expectAccessible(page);
  await notice.getByRole("button", { name: "OK" }).click();
  await expect(notice).toHaveCount(0);
  // Seen once, it stays gone, here and on the other pages people arrive at.
  for (const path of ["/judge", "/", "/admin/login"]) {
    await page.goto(path);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await expect(page.getByRole("region", { name: "Cookies" })).toHaveCount(0);
  }
});

test("the admin panel starts with a way past the sidebar", async ({ page }) => {
  await signInAsSuperAdmin(page);
  await page.goto("/admin");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await page.keyboard.press("Tab");
  const skip = page.getByRole("link", { name: "Skip to content" });
  await expect(skip).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.locator("main#main")).toBeFocused();
});
