import { readFileSync } from "node:fs";
import { devices, expect, test, type BrowserContextOptions, type Browser, type Page } from "@playwright/test";
import { ADMIN_PASSWORD, deleteActivityNamed, expectAccessible, signInAsSuperAdmin, snap, submitScore, tapScore } from "./helpers";

// A pageant from setup to the final results, against a real database. Each step builds on the last.
// Three candidates and two judges. The preliminary (an interview) counts for 40%, pageant proper for 60%:
// evening wear, then a Top 2 cut, then a timed Q&A ending in the final cut. Bea and Cora tie on the Top 2
// line (74% each), so the organizer chooses who goes through.
const RUN = Date.now().toString(36);
const NAME = `E2E Pageant ${RUN}`;
const REALTIME = { timeout: 20_000 };

let adminPath = "";
let livePath = "";
let ledPath = "";
let codes: string[] = [];

// The judges' devices stay open through the pageant. Ana chairs the board of judges.
let ana: Page;
let ben: Page;

async function openDevice(browser: Browser, options: BrowserContextOptions) {
  return (await browser.newContext(options)).newPage();
}

const pairingCode = async (page: Page) =>
  (await page.locator("p").filter({ hasText: /^Pairing code [A-Z0-9]{4}$/ }).textContent())!.replace("Pairing code ", "");

/** The super admin's Session tab for the pageant. */
async function openDesk(page: Page) {
  await signInAsSuperAdmin(page);
  await page.goto(`${adminPath}?tab=session`);
}

/** Show a candidate from the desk, have both judges score them, and wait for the desk to see both scores. */
async function judgeCandidate(page: Page, button: string, candidate: string, score: string, shown: string) {
  await page.getByRole("button", { name: button, exact: true }).click();
  for (const judge of [ana, ben]) {
    await expect(judge.getByRole("heading", { level: 1 })).toHaveText(candidate, REALTIME);
    await submitScore(judge, candidate, score, shown);
  }
  await expect(page.getByRole("status").filter({ hasText: `Every judge has scored ${candidate}.` })).toBeVisible(REALTIME);
}

test.describe.serial("a pageant", () => {
  test.beforeAll(async ({ browser }) => {
    ana = await openDevice(browser, { ...devices["Pixel 7"] });
    ben = await openDevice(browser, { viewport: { width: 1180, height: 820 }, hasTouch: true });
  });

  test.afterAll(async () => {
    for (const page of [ana, ben]) await page?.context().close();
    await deleteActivityNamed(NAME);
  });

  test("the organizer sets up a pageant step by step, candidates first", async ({ page }) => {
    await signInAsSuperAdmin(page);
    await page.goto("/admin/new");
    await page.getByRole("radio", { name: /^Pageant/ }).check();
    const step = (n: number, name: string) => page.getByRole("heading", { level: 2, name: `Step ${n} of 5: ${name}` });

    // 1. Candidates. Each step is checked before moving on.
    await expect(step(1, "Candidates")).toBeVisible();
    await page.getByRole("button", { name: "Continue to judges" }).click();
    await expect(page.getByRole("alert").filter({ hasText: "Give the pageant a name." })).toBeVisible();
    await page.getByLabel("Pageant name").fill(NAME);
    await page.getByLabel("Candidates, one per line").fill("Ayla\nBea\nCora");
    await expect(page.getByText(/^3 candidates, in running order/)).toBeVisible();
    await expectAccessible(page);
    await page.getByRole("button", { name: "Continue to judges" }).click();

    // 2. Judges. Names are letters only.
    await expect(step(2, "Judges")).toBeFocused();
    await page.getByRole("button", { name: "Remove judge 3" }).click();
    await page.getByLabel("Judge 1 first name").fill("Ana");
    await page.getByLabel("Judge 1 last name").fill("Cruz");
    await page.getByLabel("Judge 2 first name").fill("Ben2");
    await expect(page.getByRole("alert").filter({ hasText: "Use letters only for the first name." })).toBeVisible();
    await page.getByLabel("Judge 2 last name").fill("Torres");
    await page.getByRole("radio", { name: "Chair of the board of judges: judge 1" }).check();
    await page.getByRole("button", { name: "Continue to preliminary" }).click();
    await expect(page.getByRole("alert").filter({ hasText: "Use letters only for Judge 2's first name." })).toBeVisible();
    await page.getByLabel("Judge 2 first name").fill("Ben");
    await page.getByRole("button", { name: "Continue to preliminary" }).click();

    // 3. Preliminary: its share of the overall score, and its sub-activities.
    await expect(step(3, "Preliminary")).toBeFocused();
    await page.getByLabel("The preliminary counts for").fill("40");
    await page.getByLabel("Name of Preliminary sub-activity 1").fill("Interview");
    await expect(page.getByLabel("Share of the Preliminary score for Interview")).toHaveValue("100");
    await page.getByRole("button", { name: "Continue to pageant proper" }).click();

    // 4. Pageant proper: evening wear with a Top 2 cut, then a timed Q&A with the final cut.
    await expect(step(4, "Pageant proper")).toBeFocused();
    await page.getByLabel("Name of Pageant proper sub-activity 1").fill("Evening wear");
    await page.getByLabel("Share of the Pageant proper score for Evening wear").fill("50");
    await page.getByRole("button", { name: "Add a sub-activity" }).click();
    await page.getByLabel("Name of Pageant proper sub-activity 2").fill("Q&A");
    // A new sub-activity takes what's left of the segment's 100%.
    await expect(page.getByLabel("Share of the Pageant proper score for Q&A")).toHaveValue("50");
    // Each segment has its own total; the preliminary's is on its (hidden) step.
    await expect(page.getByText("Shares total 100 of 100%").filter({ visible: true })).toBeVisible();

    await page.getByRole("checkbox", { name: "Make a cut after Evening wear" }).check();
    await page.getByLabel("Top (candidates who go through after Evening wear)").fill("2");
    // The first cut counts everything so far; the preliminary keeps its 40%.
    await expect(page.getByText("Counts as Interview 40%, Evening wear 60%.")).toBeVisible();
    await page.getByLabel("Top (candidates placed in the final cut after Q&A)").fill("2");
    await expect(page.getByText("Counts as Q&A 100%.")).toBeVisible();
    await page.getByRole("checkbox", { name: "Time limit for scoring Q&A" }).check();
    await page.getByLabel("Judges get this many seconds per candidate in Q&A").fill("5");
    await page.getByRole("button", { name: "Continue to review" }).click();

    // 5. Review, then create.
    await expect(step(5, "Review")).toBeFocused();
    await expect(page.getByText("Cut: Top 2", { exact: true })).toBeVisible();
    await expect(page.getByText(/ranked by Interview 40%, Evening wear 60%/)).toBeVisible();
    await expect(page.getByText("Final cut: Top 2", { exact: true })).toBeVisible();
    await expect(page.getByText(/5 seconds to score/)).toBeVisible();
    await expectAccessible(page);
    await snap(page, "pageant setup review");
    await page.getByRole("button", { name: "Create pageant" }).click();
    // Creating a pageant writes several tables; allow for a slow network.
    await expect(page).toHaveURL(/\/admin\/[0-9a-f-]{36}$/, { timeout: 20_000 });

    adminPath = new URL(page.url()).pathname;
    codes = (await page.locator("p").filter({ hasText: /^Judge code [A-Z0-9]{6}$/ }).allTextContents()).map((t) => t.replace("Judge code ", ""));
    expect(codes).toHaveLength(2);
    // A pageant calls its entries candidates, and its program has its own tab.
    await expect(page.getByRole("link", { name: "Candidates", exact: true })).toBeVisible();
    await expect(page.getByRole("link", { name: "Segments", exact: true })).toBeVisible();
    await page.goto(`${adminPath}?tab=session`);
    const links = await page.locator("code").allTextContents();
    livePath = new URL(links.find((l) => l.includes("/live/"))!).pathname;
    ledPath = new URL(links.find((l) => l.includes("/led/"))!).pathname;
  });

  test("judges pair their devices and the session starts between sub-activities", async ({ page }) => {
    await signInAsSuperAdmin(page);
    for (const [judge, code, name] of [
      [ana, codes[0], "Ana Cruz"],
      [ben, codes[1], "Ben Torres"],
    ] as const) {
      await judge.goto(`/judge/join/${code}`);
      const pairing = await pairingCode(judge);
      await page.goto(`${adminPath}?tab=access`);
      await page.getByRole("button", { name: `Approve ${name}'s device ${pairing}` }).click();
      await expect(judge.getByRole("heading", { level: 1 })).toHaveText("Waiting for the organizer to start", REALTIME);
    }

    await page.goto(`${adminPath}?tab=session`);
    await page.getByRole("button", { name: "Start session" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Start session" }).click();
    // No sub-activity is on yet: the desk offers the first one, and judges wait for it.
    await expect(page.getByText("Choose what to judge next")).toBeVisible();
    await expect(page.getByRole("button", { name: "Judge Interview", exact: true })).toBeVisible();
    await expect(ana.getByRole("heading", { level: 1 })).toHaveText("Waiting for the next part of the pageant", REALTIME);

    // The program locks once judging starts; only timers can change.
    await page.goto(`${adminPath}?tab=segments`);
    await expect(page.getByText("The session has started, so the program is locked. Timers can still change.")).toBeVisible();
  });

  test("the preliminary is judged candidate by candidate", async ({ page }) => {
    await openDesk(page);
    await page.getByRole("button", { name: "Judge Interview", exact: true }).click();
    await expect(page.getByRole("heading", { name: /^Interview · / })).toBeVisible();
    await expect(ana.getByText(`${NAME} · Interview`)).toBeVisible(REALTIME);

    await judgeCandidate(page, "Show first candidate", "Ayla", "9", "9.00");
    await judgeCandidate(page, "Show next candidate: Bea", "Bea", "8", "8.00");
    await judgeCandidate(page, "Show next candidate: Cora", "Cora", "8", "8.00");

    // The last candidate in, the desk moves on to the next sub-activity rather than ending the session.
    await page.getByRole("button", { name: "Next: Evening wear" }).click();
    await expect(page.getByRole("heading", { name: /^Evening wear · / })).toBeVisible(REALTIME);
  });

  test("a tie on the cut line is broken by the organizer", async ({ page }) => {
    await openDesk(page);
    await judgeCandidate(page, "Show first candidate", "Ayla", "9", "9.00");
    await judgeCandidate(page, "Show next candidate: Bea", "Bea", "7", "7.00");
    await judgeCandidate(page, "Show next candidate: Cora", "Cora", "7", "7.00");

    await page.getByRole("button", { name: "Review the Top 2" }).click();
    const dialog = page.getByRole("dialog", { name: "Cut: Top 2" });
    await expect(dialog).toContainText("Ranked by Interview 40%, Evening wear 60%.");
    // Ayla 90%, then Bea and Cora both at 74%: one place left, two candidates.
    await expect(dialog.getByRole("row", { name: /Ayla/ })).toContainText("90.00%");
    await expect(dialog).toContainText("2 candidates are tied at 74% on the Top 2 line. Choose the one who goes through.");
    const confirm = dialog.getByRole("button", { name: "Confirm the Top 2" });
    await expect(confirm).toBeDisabled();
    await snap(page, "cut with a tie on the line");

    await dialog.getByRole("button", { name: /No\. 3 Cora$/ }).click();
    await expect(dialog.getByRole("button", { name: /No\. 3 Cora$/ })).toHaveAttribute("aria-pressed", "true");
    await confirm.click();
    await expect(dialog.getByRole("status").filter({ hasText: "Top 2 confirmed." })).toHaveText("Top 2 confirmed. Q&A judges these 2 candidates.");
    await expect(dialog).toContainText("Confirmed. These 2 candidates go through to Q&A.");

    await dialog.getByRole("button", { name: "Judge Q&A" }).click();
    await expect(dialog).toBeHidden();
    await expect(page.getByRole("heading", { name: /^Q&A · / })).toBeVisible(REALTIME);
    // Only the candidates who went through are judged now, under their own numbers.
    const order = page.getByRole("list", { name: "Running order: Q&A" });
    await expect(order).toContainText("Ayla");
    await expect(order).toContainText("Cora");
    await expect(order).not.toContainText("Bea");
  });

  test("the scoring timer closes scoring until the organizer gives more time", async ({ page, browser }) => {
    await openDesk(page);
    await page.getByRole("button", { name: "Show first candidate", exact: true }).click();
    await expect(ana.getByRole("heading", { level: 1 })).toHaveText("Ayla", REALTIME);
    await expect(ana.getByText("Now judging: No. 1")).toBeVisible();

    // Q&A gives judges 5 seconds per candidate: red once it runs out, and the keypad can't submit.
    await expect(ana.getByRole("status").filter({ hasText: "Scoring closed" })).toBeVisible(REALTIME);
    await tapScore(ana, "9");
    await expect(ana.getByRole("button", { name: "Submit score" })).toBeDisabled();
    await snap(ana, "judge with scoring closed");

    // The organizer gives 15 more seconds; the judge's screen turns green again and the score goes in.
    await page.getByRole("button", { name: /15 s$/ }).click();
    await expect(ana.getByRole("status").filter({ hasText: "Scoring open" })).toBeVisible(REALTIME);
    await ana.getByRole("button", { name: "Submit score" }).click();
    const confirmScore = ana.getByRole("dialog");
    await expect(confirmScore).toContainText("Submit this score for Ayla?");
    await confirmScore.getByRole("button", { name: "Submit", exact: true }).click();
    await expect(ana.getByRole("status").filter({ hasText: "Saved" })).toHaveText("Saved 9.00 for Ayla");

    // Timers can change mid-show. With it off, Ben scores at his own pace.
    await page.goto(`${adminPath}?tab=segments`);
    await page.getByRole("button", { name: "Turn off the timer for Q&A" }).click();
    await expect(page.getByRole("status").filter({ hasText: "Timer off." })).toBeVisible();
    await submitScore(ben, "Ayla", "9", "9.00");

    // The LED wall and the live results follow the sub-activity, with only the candidates still in it.
    const led = await (await browser.newContext({ viewport: { width: 1920, height: 1080 } })).newPage();
    await led.goto(ledPath);
    await expect(led.getByText("Ayla", { exact: true })).toBeVisible(REALTIME);
    await expect(led.getByText("Q&A", { exact: true })).toBeVisible();
    await snap(led, "LED lower third in a pageant");
    await led.context().close();

    const live = await (await browser.newContext()).newPage();
    await live.goto(livePath);
    await expect(live.getByText("Q&A", { exact: true })).toBeVisible(REALTIME);
    await expect(live.locator("li[data-entry]")).toHaveCount(2);
    await expect(live.locator("li[data-entry]", { hasText: "Bea" })).toHaveCount(0);
    await live.context().close();
  });

  test("the final cut places the winners", async ({ page }) => {
    await openDesk(page);
    await expect(page.getByRole("status").filter({ hasText: "Every judge has scored Ayla." })).toBeVisible(REALTIME);
    await page.getByRole("button", { name: "Show next candidate: Cora", exact: true }).click();
    // Cora keeps her number from the full running order.
    await expect(ana.getByText("Now judging: No. 3")).toBeVisible(REALTIME);
    for (const judge of [ana, ben]) await submitScore(judge, "Cora", "10", "10.00");
    await expect(page.getByRole("status").filter({ hasText: "Every judge has scored Cora." })).toBeVisible(REALTIME);

    await page.getByRole("button", { name: "Review the Top 2" }).click();
    const dialog = page.getByRole("dialog", { name: "Final cut: Top 2" });
    await dialog.getByRole("button", { name: "Confirm the final results" }).click();
    await expect(dialog.getByRole("status").filter({ hasText: "Final results confirmed." })).toBeVisible();
    await expect(dialog).toContainText("The order below is the final placement.");
    // Cora won the Q&A, so she places first.
    const rows = dialog.locator("tbody tr");
    await expect(rows.nth(0)).toContainText("Cora");
    await expect(rows.nth(1)).toContainText("Ayla");
    await snap(page, "final results");
    await dialog.getByRole("button", { name: "Close" }).click();

    // Nothing is left to judge, so the desk offers to end the session.
    await page.getByRole("button", { name: "End session" }).click();
    const end = page.getByRole("dialog", { name: "End the session?" });
    await end.getByLabel("Your password").fill(ADMIN_PASSWORD);
    await end.getByRole("button", { name: "End session" }).click();
    await expect(page.getByRole("heading", { name: "Judging has ended" })).toBeVisible();
    await expect(page.getByText("Every score is in")).toBeVisible();
  });

  test("each sub-activity, the cuts and the preliminary have their own results PDF", async ({ page }) => {
    await openDesk(page);
    const slug = NAME.toLowerCase().replace(/\s+/g, "-");
    for (const [link, file] of [
      ["PDF of Interview results", `${slug}-interview-results.pdf`],
      ["PDF of Q&A results", `${slug}-qa-results.pdf`],
      ["Standings PDF for the preliminary", `${slug}-preliminary-results.pdf`],
      ["PDF of the Top 2", `${slug}-top-2-results.pdf`],
      ["PDF of the final results", `${slug}-final-results.pdf`],
    ] as const) {
      const [download] = await Promise.all([page.waitForEvent("download"), page.getByRole("link", { name: link }).click()]);
      expect(download.suggestedFilename()).toBe(file);
      expect(readFileSync(await download.path()).subarray(0, 5).toString()).toBe("%PDF-");
    }
  });
});
