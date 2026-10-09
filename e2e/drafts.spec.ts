import { expect, test, type Page } from "@playwright/test";
import { deleteActivityNamed, deleteDraftsNamed, signInAsSuperAdmin } from "./helpers";

// Setting up an activity can be saved as a draft and finished later, and leaving with unsaved changes asks first.
const RUN = Date.now().toString(36);
const EVENT = `E2E Draft ${RUN}`;
const EDITED = `${EVENT} edited`;
const PAGEANT = `E2E Draft Pageant ${RUN}`;

/** The "Activities" link above the form (not the one in the header). */
const backToActivities = (page: Page) => page.getByRole("main").getByRole("link", { name: "Activities", exact: true });
const leaveDialog = (page: Page) => page.getByRole("dialog", { name: "Leave without saving?" });
/** Whether leaving the page now would get the browser's own "Leave site?" prompt. */
const promptsOnUnload = (page: Page) =>
  page.evaluate(() => {
    const event = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(event);
    return event.defaultPrevented;
  });

test.describe.serial("drafts", () => {
  test.afterAll(async () => {
    for (const name of [EVENT, EDITED, PAGEANT]) {
      await deleteDraftsNamed(name);
      await deleteActivityNamed(name);
    }
  });

  test("an event in progress is saved as a draft, and leaving asks first", async ({ page }) => {
    await signInAsSuperAdmin(page);
    await page.goto("/admin/new");
    // Nothing typed yet: nothing to lose.
    await expect.poll(() => promptsOnUnload(page)).toBe(false);
    await page.getByLabel("Name", { exact: true }).fill(EVENT);
    await page.getByLabel("Judge 1 first name").fill("Ana");
    await page.getByLabel("Judge 1 last name").fill("Cruz");
    await expect.poll(() => promptsOnUnload(page)).toBe(true);

    // Leaving through a link asks first; staying keeps everything.
    await backToActivities(page).click();
    await expect(leaveDialog(page)).toBeVisible();
    await leaveDialog(page).getByRole("button", { name: "Stay" }).click();
    await expect(leaveDialog(page)).toBeHidden();
    await expect(page).toHaveURL(/\/admin\/new$/);
    await expect(page.getByLabel("Name", { exact: true })).toHaveValue(EVENT);

    await page.getByRole("button", { name: "Save draft" }).click();
    await expect(page.getByRole("status").filter({ hasText: /^Draft saved at / })).toBeVisible();
    await expect(page).toHaveURL(/\/admin\/new\?draft=[0-9a-f-]{36}$/);
    // Saved, so leaving doesn't ask.
    await expect.poll(() => promptsOnUnload(page)).toBe(false);
    await backToActivities(page).click();
    await expect(page).toHaveURL(/\/admin$/);

    const drafts = page.getByRole("region", { name: "Drafts" });
    await expect(drafts).toContainText(EVENT);
    await page.getByRole("link", { name: `Continue ${EVENT}` }).click();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(EVENT);
    await expect(page.getByLabel("Name", { exact: true })).toHaveValue(EVENT);
    await expect(page.getByLabel("Judge 1 first name")).toHaveValue("Ana");

    // Changes since the draft: leaving can save them on the way out.
    await page.getByLabel("Name", { exact: true }).fill(EDITED);
    await backToActivities(page).click();
    await leaveDialog(page).getByRole("button", { name: "Save draft and leave" }).click();
    await expect(page).toHaveURL(/\/admin$/);
    await expect(drafts).toContainText(EDITED);

    // Finishing it creates the activity and clears the draft.
    await page.getByRole("link", { name: `Continue ${EDITED}` }).click();
    await page.getByRole("button", { name: "Remove judge 3" }).click();
    await page.getByLabel("Judge 2 first name").fill("Ben");
    await page.getByLabel("Judge 2 last name").fill("Torres");
    await page.getByRole("radio", { name: "Chair of the board of judges: judge 1" }).check();
    await page.getByLabel("Entry names, one per line").fill("Agila");
    await page.getByRole("button", { name: "Create activity" }).click();
    await expect(page).toHaveURL(/\/admin\/[0-9a-f-]{36}$/, { timeout: 20_000 });
    await page.goto("/admin");
    await expect(page.getByRole("link", { name: `Continue ${EDITED}` })).toHaveCount(0);
    await expect(page.getByRole("link", { name: EDITED })).toBeVisible();
  });

  test("a pageant draft opens on the step it was saved on", async ({ page }) => {
    await signInAsSuperAdmin(page);
    await page.goto("/admin/new");
    await page.getByRole("radio", { name: /^Pageant/ }).check();
    await page.getByLabel("Pageant name").fill(PAGEANT);
    await page.getByLabel("Candidates, one per line").fill("Ayla\nBea\nCora");
    await page.getByRole("button", { name: "Continue to judges" }).click();
    await page.getByLabel("Judge 1 first name").fill("Ana");
    await page.getByRole("button", { name: "Save draft" }).click();
    await expect(page.getByRole("status").filter({ hasText: /^Draft saved at / })).toBeVisible();

    await page.goto("/admin");
    await page.getByRole("link", { name: `Continue ${PAGEANT}` }).click();
    await expect(page.getByRole("radio", { name: /^Pageant/ })).toBeChecked();
    await expect(page.getByRole("heading", { level: 2, name: "Step 2 of 5: Judges" })).toBeVisible();
    await expect(page.getByLabel("Judge 1 first name")).toHaveValue("Ana");

    // A draft that isn't needed anymore can be deleted from the Activities page.
    await page.goto("/admin");
    await page.getByRole("button", { name: `Delete the draft of ${PAGEANT}` }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Delete draft" }).click();
    await expect(page.getByRole("link", { name: `Continue ${PAGEANT}` })).toHaveCount(0);
  });

  test("switching between event and pageant asks before losing what was typed", async ({ page }) => {
    await signInAsSuperAdmin(page);
    await page.goto("/admin/new");
    await page.getByLabel("Name", { exact: true }).fill("Something typed");
    await page.getByRole("radio", { name: /^Pageant/ }).click();
    await leaveDialog(page).getByRole("button", { name: "Stay" }).click();
    await expect(page.getByRole("radio", { name: /^Event/ })).toBeChecked();
    await expect(page.getByLabel("Name", { exact: true })).toHaveValue("Something typed");

    await page.getByRole("radio", { name: /^Pageant/ }).click();
    await leaveDialog(page).getByRole("button", { name: "Leave without saving" }).click();
    await expect(page.getByLabel("Pageant name")).toBeVisible();
  });
});
