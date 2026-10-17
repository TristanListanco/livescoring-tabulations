import { devices, expect, test } from "@playwright/test";
import { signInAsSuperAdmin } from "./helpers";

// Admin sessions can be ended: signing out ends a session wherever its cookie is, and an admin can sign their account
// out of another browser from their profile.

test("signing out ends the session, even for a copy of its cookie", async ({ browser }) => {
  const laptop = await (await browser.newContext()).newPage();
  await signInAsSuperAdmin(laptop);
  // Someone copies the session cookie into another browser: it works there, for now.
  const copy = await browser.newContext();
  await copy.addCookies(await laptop.context().cookies());
  const elsewhere = await copy.newPage();
  await elsewhere.goto("/admin");
  await expect(elsewhere).toHaveURL(/\/admin$/);

  // The admin signs out on the laptop, and the copy stops working too.
  await laptop.getByRole("button", { name: "Sign out" }).click();
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
  await expect(laptop.getByRole("status").filter({ hasText: "signed out" })).toHaveText("That device is signed out.");

  // The tablet's next click goes to the sign-in page; the laptop carries on.
  await tablet.goto("/admin");
  await expect(tablet).toHaveURL(/\/admin\/login$/);
  await laptop.goto("/admin");
  await expect(laptop).toHaveURL(/\/admin$/);
  await tablet.context().close();
  await laptop.context().close();
});
