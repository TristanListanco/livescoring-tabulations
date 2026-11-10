import { expect, test, type Page } from "@playwright/test";
import { ADMIN_PASSWORD, deleteActivityNamed, expectAccessible, openJudgeLink, screenPath, signInAsSuperAdmin, fillEntries, pickScoring } from "./helpers";

// Archiving an activity once its session has ended, which says no more deliberating is needed: it leaves the list of
// activities, opens read-only (its results still there, nothing to change, no reopening), signs the judges out for
// good, its live results stop checking for changes, and it can still be deleted.
const NAME = `E2E Archive ${Date.now().toString(36)}`;
const REALTIME = { timeout: 15_000 };

let adminPath = "";
let livePath = "";
let judgeCode = "";
// Ana's phone, signed in and approved before the show.
let judge: Page;

test.describe.serial("archived activities", () => {
  test.beforeAll(async ({ browser }) => {
    judge = await (await browser.newContext()).newPage();
  });
  test.afterAll(async () => {
    await judge.context().close();
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
    await fillEntries(page, ["Agila"]);
    // This one scores live.
    await pickScoring(page, { live: true });
    await page.getByLabel("Signatory 1 full name").fill("Maria Reyes");
    await page.getByRole("checkbox", { name: /I have their consent/ }).check();
    await page.getByRole("button", { name: "Create activity" }).click();
    await expect(page).toHaveURL(/\/admin\/[0-9a-f-]{36}$/, { timeout: 20_000 });
    adminPath = new URL(page.url()).pathname;

    // Ana signs in on her phone, and the organizer approves it.
    judgeCode = (await page.locator("p").filter({ hasText: /^Judge code [A-Z0-9]{6}$/ }).textContent())!.replace("Judge code ", "");
    await openJudgeLink(judge, judgeCode);
    const pairing = (await judge.locator("p").filter({ hasText: /^Pairing code [A-Z0-9]{4}$/ }).textContent())!.replace("Pairing code ", "");
    await page.getByRole("button", { name: `Approve Ana Cruz's device ${pairing}` }).click();
    await expect(judge.getByRole("heading", { level: 1 })).toHaveText("Waiting for the organizer to start", REALTIME);

    // Not ended yet, so the list doesn't offer to archive it.
    await page.goto("/admin");
    await expect(page.getByRole("button", { name: `Archive ${NAME}` })).toHaveCount(0);

    await page.goto(`${adminPath}?tab=session`);
    await page.getByRole("button", { name: "Start session" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Start session" }).click();
    // Ended early, before Ana has scored: by hand, with the organizer's password.
    await page.getByRole("button", { name: "End session" }).first().click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByRole("button", { name: "End session" })).toBeDisabled();
    await dialog.getByLabel("Your password").fill("not the password");
    await dialog.getByRole("button", { name: "End session" }).click();
    await expect(dialog.getByRole("alert")).toHaveText("That password isn't right.");
    await dialog.getByLabel("Your password").fill(ADMIN_PASSWORD);
    await dialog.getByRole("button", { name: "End session" }).click();
    await expect(page.getByRole("region", { name: "Judging has ended" })).toBeVisible(REALTIME);
    // With a score missing, it can still be reopened: reopening asks first, warning that new scores change the report ID.
    await page.getByRole("button", { name: "Reopen session" }).click();
    await expect(page.getByRole("dialog")).toContainText("the report ID changes");
    await page.getByRole("dialog").getByRole("button", { name: "Cancel" }).click();
    await expect(judge.getByRole("heading", { level: 1 })).toHaveText("Judging has ended", REALTIME);
  });

  test("the live results say it has ended, and when", async ({ page }) => {
    await signInAsSuperAdmin(page);
    await page.goto(`${adminPath}?tab=session`);
    livePath = await screenPath(page, "Open live results");
    await page.goto(livePath);
    await expect(page.getByText(/^Ended · \w{3} \d{1,2}, \d{4}, \d{1,2}:\d{2}/).first()).toBeVisible();
    await expect(page.getByText("Live", { exact: true })).toHaveCount(0);
  });

  test("archiving moves it to the archived activities, for good", async ({ page }) => {
    await signInAsSuperAdmin(page);
    // Settings offers it once the session has ended, and the list no longer does.
    await page.goto("/admin");
    await expect(page.getByRole("link", { name: NAME }).first()).toBeVisible();
    await expect(page.getByRole("button", { name: `Archive ${NAME}` })).toHaveCount(0);
    await page.goto(`${adminPath}?tab=settings`);
    await expect(page.getByRole("button", { name: `Archive ${NAME}` })).toBeVisible();
    // So does the ended desk, for when no more deliberating is needed.
    await page.goto(`${adminPath}?tab=session`);
    const desk = page.getByRole("region", { name: "Judging has ended" });
    await desk.getByRole("button", { name: `Archive ${NAME}` }).click();
    const dialog = page.getByRole("dialog", { name: "Archive this activity?" });
    await expect(dialog).toContainText("can't be reopened, deliberated again or changed");
    await expect(dialog).toContainText("Judges are signed out and their codes stop working");
    // It can't be undone, so it takes the organizer's password, as ending the session does.
    await expect(dialog.getByRole("button", { name: "Archive" })).toBeDisabled();
    await dialog.getByLabel("Your password").fill("not the password");
    await dialog.getByRole("button", { name: "Archive" }).click();
    await expect(dialog.getByRole("alert")).toHaveText("That password isn't right.");
    await dialog.getByLabel("Your password").fill(ADMIN_PASSWORD);
    await dialog.getByRole("button", { name: "Archive" }).click();
    await expect(page.getByRole("main").getByText(/^Archived \w+ \d{1,2}, \d{4}$/)).toBeVisible(REALTIME);

    // Judging is over for good: Ana's phone is signed out, and her code no longer signs in.
    await expect(judge.getByRole("heading", { level: 1 })).toHaveText("Judge sign-in", REALTIME);
    await expect(judge.getByRole("status").filter({ hasText: "Judging is over" })).toHaveText(
      `Judging is over: the organizer archived ${NAME}. Thank you for judging.`,
    );
    await judge.goto(`/judge/join/${judgeCode}`);
    await judge.getByRole("button", { name: "Start judging" }).click();
    await expect(judge.getByText("Judging is over for this activity: the organizer has archived it.")).toBeVisible();
    await expect(judge).toHaveURL(/\/judge(\?|$)/);

    await page.goto("/admin");
    await expect(page.getByRole("link", { name: NAME })).toHaveCount(0, REALTIME);

    // Listed under Archived in the sidebar, read when it's opened.
    await page.getByRole("banner").getByRole("button", { name: "Archived" }).click();
    await page.getByRole("banner").getByRole("link", { name: NAME }).click();
    await expect(page).toHaveURL(new RegExp(`${adminPath}$`));

    // Read-only: its results (the judges' notes download with them), nothing to change, and no reopening.
    await expect(page.getByRole("main").getByText(/^Archived \w+ \d{1,2}, \d{4}$/)).toBeVisible();
    // Its live results are closed, so nothing links to them.
    await expect(page.getByRole("region", { name: "Live results" })).toHaveCount(0);
    await expect(page.getByRole("link", { name: "Open live results" })).toHaveCount(0);
    // One page, its results: no tabs, and its link in the sidebar marks it.
    await expect(page.getByRole("navigation", { name: "Activity sections" })).toHaveCount(0);
    await expect(page.getByRole("banner").getByRole("link", { name: NAME })).toHaveAttribute("aria-current", "page");
    // No ended desk to say what the archived mark already does: what can still be done with it, a CSV to check and
    // deleting it (and, had every score come in, its downloads, first), and the score that never came in.
    await expect(page.getByRole("region", { name: "Judging has ended" })).toHaveCount(0);
    await expect(page.getByRole("note").filter({ hasText: "1 score is missing" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Reopen session" })).toHaveCount(0);
    await expect(page.getByRole("switch", { name: /rank/i })).toHaveCount(0);
    await expect(page.getByRole("button", { name: `Delete activity ${NAME}` })).toBeVisible();
    await expect(page.getByLabel("Activity name")).toHaveCount(0);
    await expectAccessible(page);
    // A tab it doesn't have (an old link to its Settings, say) shows its results instead.
    for (const tab of ["entries", "settings"]) {
      await page.goto(`${adminPath}?tab=${tab}`);
      await expect(page.getByRole("button", { name: `Delete activity ${NAME}` })).toBeVisible();
      await expect(page.getByRole("button", { name: `Archive ${NAME}` })).toHaveCount(0);
    }
  });

  test("once archived, the live results link no longer works", async ({ page }) => {
    const response = await page.goto(livePath);
    expect(response?.status()).toBe(404);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("This page doesn't exist");
    await expect(page.getByText(/^Ended · /)).toHaveCount(0);
  });

  test("an archived activity can still be deleted", async ({ page }) => {
    await signInAsSuperAdmin(page);
    // From its page, beside its downloads: the only place it's offered.
    await page.goto(adminPath);
    await page.getByRole("button", { name: `Delete activity ${NAME}` }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByRole("textbox").fill(NAME);
    await dialog.getByRole("button", { name: "Delete activity" }).click();
    await expect(page).toHaveURL(/\/admin$/);
    await expect(page.getByRole("link", { name: NAME })).toHaveCount(0);
  });
});
