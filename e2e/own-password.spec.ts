import { expect, test } from "@playwright/test";
import { deleteOrganizerByEmail, signInAsOrganizer, signInAsSuperAdmin } from "./helpers";

// An organizer changes the password the super admin gave them, from their profile: their current password first. The
// browser they change it in stays signed in; every other one is signed out.

const RUN = Date.now().toString(36);
const ORGANIZER = { name: `E2E Password ${RUN}`, email: `e2e-password-${RUN}@example.com`, password: `e2e-given-${RUN}-1` };
const NEW_PASSWORD = `e2e-own-${RUN}-2!`;

test.afterAll(() => deleteOrganizerByEmail(ORGANIZER.email));

test("an organizer changes the password they were given", async ({ page, browser }) => {
  await signInAsSuperAdmin(page);
  await page.goto("/admin/organizers/new");
  await page.getByLabel("Organizer name").fill(ORGANIZER.name);
  await page.getByLabel("Email").fill(ORGANIZER.email);
  await page.getByLabel("Password", { exact: true }).fill(ORGANIZER.password);
  await page.getByRole("button", { name: "Create organizer" }).click();
  await expect(page).toHaveURL(/\/admin\/organizers$/);

  // Signed in on a laptop and a tablet.
  const laptop = await (await browser.newContext()).newPage();
  await signInAsOrganizer(laptop, ORGANIZER.email, ORGANIZER.password);
  const tablet = await (await browser.newContext()).newPage();
  await signInAsOrganizer(tablet, ORGANIZER.email, ORGANIZER.password);

  await laptop.goto("/admin/profile");
  const form = laptop.locator("form").filter({ has: laptop.getByLabel("Current password") });
  // The current password has to be right.
  await form.getByLabel("Current password").fill("not my password 1!");
  await form.getByLabel("New password").fill(NEW_PASSWORD);
  await form.getByRole("button", { name: "Change password" }).click();
  await expect(form.getByRole("alert")).toHaveText("That isn't your current password.");

  await form.getByLabel("Current password").fill(ORGANIZER.password);
  await form.getByLabel("New password").fill(NEW_PASSWORD);
  await form.getByRole("button", { name: "Change password" }).click();
  await expect(form.getByRole("status")).toHaveText("Password changed. Your other devices are signed out.");
  await expect(form.getByLabel("Current password")).toHaveValue("");

  // This browser carries on; the tablet is signed out.
  await laptop.goto("/admin");
  await expect(laptop).toHaveURL(/\/admin$/);
  await tablet.goto("/admin");
  await expect(tablet).toHaveURL(/\/admin\/login$/);

  // The new password signs in; the one they were given doesn't.
  await tablet.getByLabel("Email").fill(ORGANIZER.email);
  await tablet.getByLabel("Password", { exact: true }).fill(ORGANIZER.password);
  await tablet.getByRole("button", { name: "Sign in" }).click();
  await expect(tablet.getByRole("alert").filter({ hasText: "don't match an organizer account" })).toBeVisible();
  await signInAsOrganizer(tablet, ORGANIZER.email, NEW_PASSWORD);

  await laptop.context().close();
  await tablet.context().close();
});
