import { expect, test } from "@playwright/test";
import { ADMIN_PASSWORD, deleteActivityNamed, screenPath, signInAsSuperAdmin } from "./helpers";

// Archiving an activity once its session has ended: it leaves the list of activities, opens read-only (its results
// still there, nothing to change, no reopening), and can still be deleted.
const NAME = `E2E Archive ${Date.now().toString(36)}`;
const REALTIME = { timeout: 15_000 };

let adminPath = "";

test.describe.serial("archived activities", () => {
  test.afterAll(async () => {
    await deleteActivityNamed(NAME);
  });

  test("an activity is set up, judged and ended", async ({ page }) => {
    await signInAsSuperAdmin(page);
    await page.goto("/admin/new");
    await page.getByLabel("Name", { exact: true }).fill(NAME);
    await page.getByRole("button", { name: "Remove judge 3" }).click();
    await page.getByRole("button", { name: "Remove judge 2" }).click();
    await page.getByLabel("Judge 1 first name").fill("Ana");
    await page.getByLabel("Judge 1 last name").fill("Cruz");
    await page.getByRole("radio", { name: "Chair of the board of judges: judge 1" }).check();
    await page.getByLabel("Entry names, one per line").fill("Agila");
    await page.getByRole("button", { name: "Create activity" }).click();
    await expect(page).toHaveURL(/\/admin\/[0-9a-f-]{36}$/, { timeout: 20_000 });
    adminPath = new URL(page.url()).pathname;

    // Not ended yet, so the list doesn't offer to archive it.
    await page.goto("/admin");
    await expect(page.getByRole("button", { name: `Archive ${NAME}` })).toHaveCount(0);

    await page.goto(`${adminPath}?tab=session`);
    await page.getByRole("button", { name: "Start session" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Start session" }).click();
    await page.getByRole("button", { name: "End session" }).first().click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("Your password").fill(ADMIN_PASSWORD);
    await dialog.getByRole("button", { name: "End session" }).click();
    await expect(page.getByRole("region", { name: "Judging has ended" })).toBeVisible(REALTIME);
  });

  test("the live results say it has ended, and when", async ({ page }) => {
    await signInAsSuperAdmin(page);
    await page.goto(`${adminPath}?tab=session`);
    const livePath = await screenPath(page, "Open live results");
    await page.goto(livePath);
    await expect(page.getByText(/^Ended · \w{3} \d{1,2}, \d{4}, \d{1,2}:\d{2}/).first()).toBeVisible();
    await expect(page.getByText("Live", { exact: true })).toHaveCount(0);
  });

  test("archiving moves it to the archived activities, for good", async ({ page }) => {
    await signInAsSuperAdmin(page);
    await page.goto("/admin");
    await page.getByRole("button", { name: `Archive ${NAME}` }).first().click();
    const dialog = page.getByRole("dialog", { name: "Archive this activity?" });
    await expect(dialog).toContainText("can't be reopened or changed");
    await dialog.getByRole("button", { name: "Archive" }).click();
    await expect(page.getByRole("link", { name: NAME })).toHaveCount(0, REALTIME);

    // Listed under Archived activities, collapsed until opened.
    await page.locator("summary", { hasText: "Archived activities" }).click();
    await page.getByRole("link", { name: NAME }).click();
    await expect(page).toHaveURL(new RegExp(`${adminPath}$`));

    // Read-only: its results and the judges' notes, nothing to change, and no reopening.
    await expect(page.getByText("Archived", { exact: true })).toBeVisible();
    await expect(page.getByRole("note").filter({ hasText: "can't be reopened or changed" })).toBeVisible();
    const sections = page.getByRole("navigation", { name: "Activity sections" });
    await expect(sections.getByRole("link")).toHaveText(["Results", "Notes"]);
    await expect(page.getByRole("region", { name: "Judging has ended" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Reopen session" })).toHaveCount(0);
    await expect(page.getByRole("switch", { name: /rank/i })).toHaveCount(0);
    // A tab it doesn't have shows its results instead.
    await page.goto(`${adminPath}?tab=settings`);
    await expect(page.getByRole("region", { name: "Judging has ended" })).toBeVisible();
  });

  test("an archived activity can still be deleted", async ({ page }) => {
    await signInAsSuperAdmin(page);
    await page.goto(adminPath);
    await page.getByRole("note").getByRole("button", { name: `Delete ${NAME}` }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByRole("textbox").fill(NAME);
    await dialog.getByRole("button", { name: "Delete activity" }).click();
    await expect(page).toHaveURL(/\/admin$/);
    await expect(page.getByRole("link", { name: NAME })).toHaveCount(0);
  });
});
