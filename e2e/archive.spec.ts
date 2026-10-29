import { expect, test, type Page } from "@playwright/test";
import { ADMIN_PASSWORD, deleteActivityNamed, openJudgeLink, screenPath, signInAsSuperAdmin } from "./helpers";

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
    await page.getByRole("radio", { name: "Chair of the board of judges: judge 1" }).check();
    await page.getByLabel("Entry names, one per line").fill("Agila");
    // New events start without live scoring; this one scores live.
    await page.getByRole("checkbox", { name: /Show scores live/ }).check();
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
    await page.getByRole("button", { name: "End session" }).first().click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("Your password").fill(ADMIN_PASSWORD);
    await dialog.getByRole("button", { name: "End session" }).click();
    await expect(page.getByRole("region", { name: "Judging has ended" })).toBeVisible(REALTIME);
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
    // The list offers it once the session has ended.
    await page.goto("/admin");
    await expect(page.getByRole("button", { name: `Archive ${NAME}` }).first()).toBeVisible();
    // So does the ended desk, for when no more deliberating is needed.
    await page.goto(`${adminPath}?tab=session`);
    const desk = page.getByRole("region", { name: "Judging has ended" });
    await expect(desk).toContainText("No more deliberating needed?");
    await desk.getByRole("button", { name: `Archive ${NAME}` }).click();
    const dialog = page.getByRole("dialog", { name: "Archive this activity?" });
    await expect(dialog).toContainText("can't be reopened, deliberated again or changed");
    await expect(dialog).toContainText("Judges are signed out and their codes stop working");
    await dialog.getByRole("button", { name: "Archive" }).click();
    await expect(page.getByText("Archived", { exact: true })).toBeVisible(REALTIME);

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

    // Listed under Archived activities, collapsed until opened.
    await page.locator("summary", { hasText: "Archived activities" }).click();
    await page.getByRole("link", { name: NAME }).click();
    await expect(page).toHaveURL(new RegExp(`${adminPath}$`));

    // Read-only: its results (the judges' notes download with them), nothing to change, and no reopening.
    await expect(page.getByText("Archived", { exact: true })).toBeVisible();
    await expect(page.getByRole("note").filter({ hasText: "can't be reopened or changed" })).toBeVisible();
    const sections = page.getByRole("navigation", { name: "Activity sections" });
    await expect(sections.getByRole("link")).toHaveText(["Results"]);
    await expect(page.getByRole("region", { name: "Judging has ended" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Reopen session" })).toHaveCount(0);
    await expect(page.getByRole("switch", { name: /rank/i })).toHaveCount(0);
    // A tab it doesn't have shows its results instead.
    await page.goto(`${adminPath}?tab=settings`);
    await expect(page.getByRole("region", { name: "Judging has ended" })).toBeVisible();
    await expect(page.getByRole("button", { name: `Archive ${NAME}` })).toHaveCount(0);
  });

  test("the archived live results are final: the page stops checking for changes", async ({ page }) => {
    const checks: string[] = [];
    page.on("request", (request) => {
      if (request.url().includes("/rest/v1/activity_changes")) checks.push(request.url());
    });
    await page.goto(livePath);
    await expect(page.getByText(/^Ended · /).first()).toBeVisible();
    await page.waitForTimeout(3_000);
    expect(checks).toHaveLength(0);
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
