import { expect, test } from "@playwright/test";
import { expectAccessible, signInAsSuperAdmin } from "./helpers";

// The privacy policy and the terms of service: public pages, reachable from wherever people sign in.

const CONTACT = "tristan.listanco@g.msuiit.edu.ph";

for (const [path, title] of [
  ["/privacy", "Privacy policy"],
  ["/terms", "Terms of service"],
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

test("the pages people sign in from link to both", async ({ page }) => {
  for (const path of ["/", "/judge", "/admin/login"]) {
    await page.goto(path);
    const legal = page.getByRole("navigation", { name: "Legal" });
    await expect(legal.getByRole("link", { name: "Privacy policy" })).toHaveAttribute("href", "/privacy");
    await expect(legal.getByRole("link", { name: "Terms of service" })).toHaveAttribute("href", "/terms");
  }
  // And the organizer's panel, once signed in.
  await signInAsSuperAdmin(page);
  await page.getByRole("navigation", { name: "Legal" }).getByRole("link", { name: "Terms of service" }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Terms of service");
  await page.getByRole("link", { name: "privacy policy" }).first().click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Privacy policy");
});
