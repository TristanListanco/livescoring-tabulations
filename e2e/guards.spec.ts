import { expect, test } from "@playwright/test";
import { expectAccessible } from "./helpers";

test("admin pages send visitors to sign in", async ({ page }) => {
  await page.goto("/admin");
  await expect(page).toHaveURL(/\/admin\/login$/);
  await expect(page.getByRole("heading", { name: "Admin sign-in" })).toBeVisible();
  await page.goto("/admin/organizers");
  await expect(page).toHaveURL(/\/admin\/login$/);
});

test("a wrong super admin password is rejected", async ({ page }) => {
  await page.goto("/admin/login?as=super");
  await page.getByLabel("Super admin password").fill("definitely-not-the-password");
  await page.getByRole("button", { name: "Sign in" }).click();
  // Next.js adds its own empty role="alert" route announcer, so match by text.
  await expect(page.getByRole("alert").filter({ hasText: "That password isn't right." })).toBeVisible();
  await expect(page).toHaveURL(/\/admin\/login\?as=super$/);
});

test("an unknown organizer email is rejected", async ({ page }) => {
  await page.goto("/admin/login");
  await page.getByLabel("Email").fill("nobody@example.com");
  await page.getByLabel("Password", { exact: true }).fill("not-a-real-password");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "don't match an organizer account" })).toBeVisible();
});

test("the scoring screen needs a judge code", async ({ page }) => {
  await page.goto("/judge/score");
  await expect(page).toHaveURL(/\/judge$/);
});

test("an unknown judge code is rejected", async ({ page }) => {
  await page.goto("/judge");
  // 0 is never used in codes, so this can't match a real judge.
  await page.getByLabel("Judge code").fill("000000");
  await page.getByRole("button", { name: "Start judging" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "doesn't match any judge" })).toBeVisible();
});

test("unknown results and LED links show the not-found page", async ({ page }) => {
  for (const path of ["/live/doesnotexist", "/led/doesnotexist"]) {
    await page.goto(path);
    await expect(page.getByRole("heading", { name: "This page doesn't exist" })).toBeVisible();
  }
});

test("sign-in pages meet WCAG 2.1 AA", async ({ page }) => {
  for (const path of ["/admin/login", "/admin/login?as=super", "/judge"]) {
    await page.goto(path);
    await expectAccessible(page);
  }
});
