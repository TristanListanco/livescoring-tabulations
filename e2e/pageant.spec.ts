import { readFileSync } from "node:fs";
import { devices, expect, test, type BrowserContextOptions, type Browser, type Page } from "@playwright/test";
import { ADMIN_PASSWORD, deleteActivityNamed, expectAccessible, exportFile, judgeCodes, openJudgeLink, PHOTO, SAVED, screenPath, signInAsSuperAdmin, snap, submitScore, tapScore } from "./helpers";

// A pageant from setup to the final results, against a real database. Each step builds on the last.
// Three candidates and separate boards of judges: Dina judges the preliminary, and Ana (chair), Ben and Cara judge
// pageant proper. The preliminary (an interview, scored in two parts: its questions 60% and
// the advocacy 40%) counts for 40%, pageant proper for 60%: evening wear, then a Top 2 cut, then a timed Q&A
// ending in the final cut. Bea and Cora tie on the Top 2 line (74% each), so the organizer chooses who goes through.
// The preliminary and pageant proper run as sessions of their own: Dina is done once the preliminary ends, and
// pageant proper's board waits for it to start.
const RUN = Date.now().toString(36);
const NAME = `E2E Pageant ${RUN}`;
const REALTIME = { timeout: 20_000 };

let adminPath = "";
let livePath = "";
let ledPath = "";
let codes: string[] = [];

// The judges' devices stay open through the pageant. Dina chairs the preliminary board, Ana pageant proper's.
let dina: Page;
let ana: Page;
let ben: Page;
let cara: Page;
const preliminaryBoard = () => [dina];
const properBoard = () => [ana, ben, cara];

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

/** Show a candidate from the desk, have the board's judges score them, and wait for the desk to see every score. */
async function judgeCandidate(page: Page, board: Page[], button: string, candidate: string, score: string, shown: string) {
  await page.getByRole("button", { name: button, exact: true }).click();
  // The board scores at the same time, as at a real event.
  await Promise.all(
    board.map(async (judge) => {
      await expect(judge.getByRole("heading", { level: 1 })).toHaveText(candidate, REALTIME);
      await submitScore(judge, candidate, score, shown);
    }),
  );
  await expect(page.getByRole("status").filter({ hasText: `Every judge has scored ${candidate}.` })).toBeVisible(REALTIME);
}

test.describe.serial("a pageant", () => {
  test.beforeAll(async ({ browser }) => {
    dina = await openDevice(browser, { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
    ana = await openDevice(browser, { ...devices["Pixel 7"] });
    ben = await openDevice(browser, { viewport: { width: 1180, height: 820 }, hasTouch: true });
    cara = await openDevice(browser, { viewport: { width: 1280, height: 800 } });
  });

  test.afterAll(async () => {
    for (const page of [dina, ana, ben, cara]) await page?.context().close();
    await deleteActivityNamed(NAME);
  });

  test("the organizer sets up a pageant on one page, as an event, candidates first", async ({ page }) => {
    await signInAsSuperAdmin(page);
    await page.goto("/admin/new");
    await page.getByRole("radio", { name: /^Pageant/ }).check();
    // What Create needs fixed: listed above it, each linking to its field.
    const problems = page.locator("#form-problems");
    // The sections, beside the form at this width, each marked done once it has what Create needs.
    const index = page.getByRole("navigation", { name: "Sections of the form" });
    for (const name of ["Details", "Candidates", "Judges", "Preliminary", "Pageant proper", "Results"]) {
      await expect(index.getByRole("link", { name: `${name}, not done yet` })).toBeVisible();
    }

    // Create checks the whole page: every problem is listed, the first field takes focus with its message under it,
    // and each message goes as soon as its field is fixed.
    await page.getByRole("button", { name: "Create pageant" }).click();
    await expect(problems).toContainText(/Fix these \d+ things to create the pageant/);
    await expect(problems).toContainText("Give the pageant a name.");
    await expect(problems).toContainText("Enter candidate 3's name, or remove the row.");
    await expect(page.getByLabel("Pageant name")).toBeFocused();
    await expect(page.getByLabel("Pageant name")).toHaveAttribute("aria-invalid", "true");
    await snap(page, "pageant setup problems");
    await page.getByLabel("Pageant name").fill(NAME);
    await page.getByLabel(/^Location/).fill("University Gymnasium");
    await expect(index.getByRole("link", { name: "Details, done" })).toBeVisible();
    await expect(problems).not.toContainText("Give the pageant a name.");
    await expect(page.getByLabel("Pageant name")).not.toHaveAttribute("aria-invalid", "true");
    // Each candidate has a row, with a photo for the LED wall; a new pageant starts with three. A list pasted into a
    // name, as copied from a score sheet, fills that row and the next ones, its running numbers dropped.
    await page.getByLabel("Candidate 1 name").evaluate((field, text) => {
      const data = new DataTransfer();
      data.setData("text/plain", text);
      field.dispatchEvent(new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true }));
    }, "1. Ayla\n2. Cora\n3. Bea");
    await expect(page.getByLabel("Candidate 3 name")).toHaveValue("Bea");
    await expect(page.getByLabel("Candidate 3 name")).toBeFocused();
    await expect(problems).not.toContainText("Enter candidate");
    await expect(page.getByText(/^Pasted 3 names\. 3 candidates, in running order/)).toBeVisible();
    await page.getByRole("button", { name: "Move Bea up" }).click();
    await expect(page.getByLabel("Candidate 2 name")).toHaveValue("Bea");
    // Focus stays on the move button, so the keyboard can keep moving her.
    await expect(page.getByRole("button", { name: "Move Bea up" })).toBeFocused();
    // Enter goes from a name to its details, then to the next name, adding a row after a named last one; it never
    // creates the pageant.
    await page.getByLabel("Candidate 3 name").press("Enter");
    await expect(page.getByLabel("Details for Cora")).toBeFocused();
    await page.getByLabel("Details for Cora").press("Enter");
    await expect(page.getByLabel("Candidate 4 name")).toBeFocused();
    await page.getByLabel("Candidate 4 name").press("Enter");
    await page.getByLabel("Details for Candidate 4").press("Enter");
    await expect(page.getByLabel("Candidate 5 name")).toHaveCount(0);
    await expect(problems).toContainText("Enter candidate 4's name, or remove the row.");
    await page.getByRole("button", { name: "Create pageant" }).click();
    await expect(page.getByLabel("Candidate 4 name")).toBeFocused();
    await page.getByRole("button", { name: "Remove Candidate 4" }).click();
    await expect(problems).not.toContainText("candidate 4");
    await expect(index.getByRole("link", { name: "Candidates, done" })).toBeVisible();
    // A line of details under a candidate's name, as an event's entries have: shown under it on the LED wall.
    await page.getByLabel("Details for Ayla").fill("Cebu City");
    // Each photo is cropped and resized before it's kept: here a little bigger in its square.
    await page.getByLabel("Photo for Ayla").setInputFiles(PHOTO);
    const crop = page.getByRole("dialog", { name: "Crop the photo of Ayla" });
    await crop.getByRole("button", { name: "Zoom in" }).click();
    await expect(crop.getByRole("slider", { name: "Zoom" })).toHaveAttribute("aria-valuetext", "125%");
    await expectAccessible(page);
    await crop.getByRole("button", { name: "Use photo" }).click();
    await expect(crop).toBeHidden();
    await expect(page.getByRole("button", { name: "View photo of Ayla" })).toBeVisible();
    await expectAccessible(page);

    // Judges. Names are letters only, and pageant proper needs at least three judges.
    await page.getByRole("button", { name: "Remove judge 3" }).click();
    await page.getByLabel("Judge 1 first name").fill("Ana");
    await page.getByLabel("Judge 1 last name").fill("Cruz");
    await page.getByLabel("Judge 2 first name").fill("Ben2");
    await expect(page.getByRole("alert").filter({ hasText: "Use letters only for the first name." })).toBeVisible();
    await page.getByLabel("Judge 2 last name").fill("Torres");
    await page.getByRole("radio", { name: "Chair of the board of judges: judge 1" }).check();
    await page.getByRole("button", { name: "Create pageant" }).click();
    await expect(problems).toContainText("Use letters only for judge 2's first name.");
    await expect(problems).toContainText("Pageant proper needs at least three judges. Add one more judge.");
    await expect(page.getByLabel("Judge 2 first name")).toBeFocused();
    await page.getByLabel("Judge 2 first name").fill("Ben");
    await expect(problems).not.toContainText("Use letters only");
    // A problem's link takes focus to its field.
    await problems.getByRole("link", { name: "Pageant proper needs at least three judges. Add one more judge." }).click();
    await expect(page.getByRole("button", { name: "Add a judge" })).toBeFocused();

    // Separate boards: the judges so far make up pageant proper's (Ana still its chair), and the preliminary gets its own.
    await page.getByRole("radio", { name: /^Separate boards/ }).check();
    await expect(page.getByLabel("Pageant proper judge 1 first name")).toHaveValue("Ana");
    await expect(page.getByRole("radio", { name: "Chair of the pageant proper board: judge 1" })).toBeChecked();
    await page.getByLabel("Preliminary judge 1 first name").fill("Dina");
    await page.getByLabel("Preliminary judge 1 last name").fill("Lopez");
    await page.getByRole("button", { name: "Remove preliminary judge 3" }).click();
    await page.getByRole("button", { name: "Remove preliminary judge 2" }).click();
    await page.getByRole("button", { name: "Create pageant" }).click();
    await expect(problems).toContainText("Choose the chair of the preliminary board of judges.");
    await expect(problems).toContainText("Pageant proper needs at least three judges. Add one more judge to its board.");
    await expect(page.getByRole("radio", { name: "Chair of the preliminary board: judge 1" })).toBeFocused();
    await page.getByRole("radio", { name: "Chair of the preliminary board: judge 1" }).check();
    await expect(problems).not.toContainText("Choose the chair");
    await page.getByRole("button", { name: "Add a judge to the pageant proper board" }).click();
    await page.getByLabel("Pageant proper judge 3 first name").fill("Cara");
    await page.getByLabel("Pageant proper judge 3 last name").fill("Diaz");
    await expect(index.getByRole("link", { name: "Judges, done" })).toBeVisible();
    await expectAccessible(page);

    // Each segment's part of the program, apart from the review below, which repeats some of what they say.
    const prelimProgram = page.locator("#preliminary-program");
    const properProgram = page.locator("#proper-program");
    // Preliminary: its share of the overall score, and its sub-activities.
    // Shares are percentages of the overall score, as score sheets write them. The preliminary going from 30% to
    // 40% takes its sub-activity's share with it (and pageant proper's from 70 to 60).
    await page.getByLabel("The preliminary counts for").fill("40");
    await page.getByLabel("Name of Preliminary sub-activity 1").fill("Interview");
    await expect(page.getByLabel("Share of the overall score for Interview")).toHaveValue("40");
    // Its only sub-activity can't be removed, and says why.
    // (It's marked unavailable rather than disabled, so it can still be pressed to hear why.)
    await page.getByRole("button", { name: "Remove Interview", exact: true }).click({ force: true });
    await expect(prelimProgram.getByText("The preliminary needs at least one sub-activity.")).toBeVisible();
    // The interview is scored in parts, each with its own scoring and share; their shares add up to the interview's 40.
    await page.getByRole("checkbox", { name: "Score it in parts for Interview" }).check();
    await page.getByLabel("Name of part 1 of Interview").fill("Questions");
    await page.getByLabel("Name of part 2 of Interview").fill("Advocacy");
    await expect(page.getByLabel("Share of the overall score for Interview · Advocacy")).toHaveValue("20");
    // A third part takes its share by splitting the interview's 40 evenly, rather than leaving a share to fix.
    await page.getByRole("button", { name: "Add a part to Interview" }).click();
    await expect(prelimProgram.getByText("Shares were split evenly to make room.").filter({ visible: true })).toBeVisible();
    await expect(page.getByLabel("Share of the overall score for Interview · Questions")).toHaveValue("14");
    await page.getByRole("button", { name: "Remove Interview · Part 3" }).click();
    // Removing can be undone, as long as nothing else has changed: focus waits on Undo, where the part was.
    await expect(page.getByRole("button", { name: "Undo removing Part 3" })).toBeFocused();
    await page.getByRole("button", { name: "Undo removing Part 3" }).click();
    await expect(page.getByRole("button", { name: "Remove Interview · Part 3" })).toBeFocused();
    await expect(page.getByLabel("Share of the overall score for Interview · Questions")).toHaveValue("14");
    await page.getByRole("button", { name: "Remove Interview · Part 3" }).click();
    // The other parts take its share, so the interview still counts for 40.
    await expect(prelimProgram.getByText("Shares total 40 of 40%").filter({ visible: true })).toBeVisible();
    await page.getByLabel("Share of the overall score for Interview · Questions").fill("24");
    // Its parts now add up to more than the preliminary's 40%: the interview's sum says so, in the danger colour.
    await expect(prelimProgram.getByText(/^sum of parts, [\d.]+% over$/)).toBeVisible();
    await expect(page.getByRole("button", { name: "Undo removing Part 3" })).toHaveCount(0);
    await page.getByLabel("Share of the overall score for Interview · Advocacy").fill("16");
    await expect(prelimProgram.getByText("Shares total 40 of 40%").filter({ visible: true })).toBeVisible();
    // In parts, the interview's share is theirs added up: shown, not typed.
    await expect(page.getByLabel("Share of the overall score for Interview", { exact: true })).toHaveCount(0);
    await expect(prelimProgram.getByText("sum of parts")).toBeVisible();
    // Deductions for violations: points off the preliminary score, given at the desk.
    await page.getByRole("checkbox", { name: "Deductions for violations" }).check();
    await page.getByLabel("Violation 1", { exact: true }).fill("Late for call time");
    await page.getByLabel("Violation 1 Points off").fill("1");

    // Pageant proper: evening wear with a Top 2 cut, then a timed Q&A with the final cut.
    await page.getByLabel("Name of Pageant proper sub-activity 1").fill("Evening wear");
    // Evening wear has all of pageant proper's 60, so adding Q&A splits it evenly instead of leaving Q&A a share to fix.
    await page.locator("#proper-program").getByRole("button", { name: "Add a sub-activity" }).click();
    await page.getByLabel("Name of Pageant proper sub-activity 2").fill("Q&A");
    await expect(page.getByLabel("Share of the overall score for Evening wear")).toHaveValue("30");
    await expect(page.getByLabel("Share of the overall score for Q&A")).toHaveValue("30");
    // Each segment has its own total.
    await expect(properProgram.getByText("Shares total 60 of 60%").filter({ visible: true })).toBeVisible();

    await page.getByRole("checkbox", { name: "Make a cut after Evening wear" }).check();
    // Scores start over after a cut: evening wear now has all of pageant proper's 60%, and Q&A, after the cut, 100%.
    await expect(page.getByLabel("Share of the overall score for Evening wear")).toHaveValue("60");
    // The cut knows how many candidates are left before it, and says so as soon as a size is too big.
    await expect(properProgram.getByText("of the 3 candidates left go through")).toBeVisible();
    await page.getByLabel("Top (candidates who go through after Evening wear)").fill("3");
    await expect(page.getByRole("alert").filter({ hasText: "Top 3 has to be fewer than the 3 candidates left before this cut." })).toBeVisible();
    await page.getByLabel("Top (candidates who go through after Evening wear)").fill("2");
    await expect(properProgram.getByText("of the 2 candidates left are placed")).toBeVisible();
    // Alone after the cut, Q&A counts for 100% of the score from there, so it has no share to give.
    await expect(properProgram.getByText("After the Top 2 cut, scores start over", { exact: true }).filter({ visible: true })).toBeVisible();
    await expect(page.getByLabel(/^Share .* for Q&A$/)).toHaveCount(0);
    // The first cut counts everything so far; the preliminary keeps its 40%.
    await expect(properProgram.getByText("Counts as Interview 40%, Evening wear 60%.")).toBeVisible();
    await page.getByLabel("Top (candidates placed in the final cut after Q&A)").fill("2");
    await expect(properProgram.getByText("Counts as Q&A 100%.")).toBeVisible();
    // Scoring and its timer fold to one line, the defaults until opened.
    await expect(page.locator("summary").filter({ hasText: "Scoring for Q&A" })).toContainText("Scores 1 to 10 · 2 decimal places");
    await page.locator("summary").filter({ hasText: "Scoring for Q&A" }).click();
    await page.getByRole("checkbox", { name: "Time limit for scoring Q&A" }).check();
    await page.getByLabel("Judges get this many seconds per candidate in Q&A").fill("5");
    await expect(index.getByRole("link", { name: "Preliminary, done" })).toBeVisible();
    await expect(index.getByRole("link", { name: "Pageant proper, done" })).toBeVisible();

    // The review, then create. It reads like the score sheet: each segment a table of shares and scoring, cuts in place.
    const preliminary = page.getByRole("table", { name: /^Preliminary/ });
    await expect(preliminary.getByRole("row").filter({ hasText: "Interview" }).first()).toContainText("40%");
    await expect(preliminary.getByRole("row").filter({ hasText: "Questions" })).toContainText("24%");
    await expect(preliminary.getByRole("row").filter({ hasText: "Questions" })).toContainText("Scores 1 to 10");
    const proper = page.getByRole("table", { name: /^Pageant proper/ });
    await expect(proper).toContainText("Cut: Top 2");
    await expect(proper).toContainText("Ranked by Interview 40%, Evening wear 60%");
    await expect(page.getByRole("heading", { name: "Deductions for violations" })).toBeVisible();
    await expect(page.getByRole("listitem").filter({ hasText: "Late for call time" }).filter({ visible: true })).toContainText("1 point");
    await expect(proper).toContainText("After the Top 2 cut, scores start over");
    await expect(proper.getByRole("row").filter({ hasText: "Q&A" }).first()).toContainText("100%");
    await expect(proper.getByRole("row").filter({ hasText: "Q&A" }).first()).toContainText("5 s to score");
    await expect(proper).toContainText("Final cut: Top 2");
    // The candidates in running order, and the judges by board with their chairs.
    await expect(page.getByText("3 in running order, 1 with photos")).toBeVisible();
    await expect(page.getByRole("listitem").filter({ hasText: "Dina Lopez" })).toContainText("Chair");
    await expect(page.getByRole("listitem").filter({ hasText: "Ana Cruz" })).toContainText("Chair");
    await expect(page.getByRole("listitem").filter({ hasText: "Ben Torres" })).not.toContainText("Chair");
    // Edit goes to that section.
    await page.getByRole("button", { name: "Edit the candidates" }).click();
    await expect(page.getByRole("heading", { level: 2, name: "Candidates" })).toBeFocused();
    await expectAccessible(page);
    await page.getByLabel("Signatory 1 full name").fill("Maria Reyes");
    await expect(index.getByRole("link", { name: "Results, done" })).toBeVisible();
    await snap(page, "pageant setup review");
    await page.getByRole("checkbox", { name: /I have their consent/ }).check();
    await page.getByRole("button", { name: "Create pageant" }).click();
    // Creating a pageant writes several tables; allow for a slow network.
    await expect(page).toHaveURL(/\/admin\/[0-9a-f-]{36}$/, { timeout: 20_000 });

    adminPath = new URL(page.url()).pathname;
    codes = await judgeCodes(page);
    // In board order: the preliminary's Dina, then Ana, Ben and Cara.
    expect(codes).toHaveLength(4);
    // A pageant calls its entries candidates, and its program has its own tab.
    await expect(page.getByRole("link", { name: "Candidates", exact: true })).toBeVisible();
    await expect(page.getByRole("link", { name: "Segments", exact: true })).toBeVisible();
    // Ayla's photo from the setup went up with the pageant, and her details with her.
    await page.goto(`${adminPath}?tab=entries`);
    await expect(page.getByRole("button", { name: "View photo of Ayla" })).toBeVisible();
    await expect(page.getByLabel("Details for Ayla")).toHaveValue("Cebu City");
    await expect(page.getByRole("heading", { name: "Add candidates" })).toBeVisible();
    await page.goto(`${adminPath}?tab=session`);
    livePath = await screenPath(page, "Open live results");
    // Before the start, the LED wall's preview plays a sample on the first part judged, with the pageant's candidates.
    await page.goto(`${adminPath}?tab=led`);
    await expect(page.getByText("once the preliminary starts, the wall follows the candidate you show")).toBeVisible();
    ledPath = new URL((await page.locator("code").allTextContents()).find((l) => l.includes("/led/"))!).pathname;
  });

  test("judges pair their devices and the preliminary starts, pageant proper's judges waiting", async ({ page }) => {
    await signInAsSuperAdmin(page);
    for (const [judge, code, name] of [
      [dina, codes[0], "Dina Lopez"],
      [ana, codes[1], "Ana Cruz"],
      [ben, codes[2], "Ben Torres"],
      [cara, codes[3], "Cara Diaz"],
    ] as const) {
      await openJudgeLink(judge, code);
      const pairing = await pairingCode(judge);
      await page.goto(`${adminPath}?tab=judges`);
      await page.getByRole("button", { name: `Approve ${name}'s device ${pairing}` }).click();
      await expect(judge.getByRole("heading", { level: 1 })).toHaveText("Waiting for the organizer to start", REALTIME);
    }

    // Every judge the preliminary opens screens for is in (Dina; pageant proper's judges start with it): the other
    // tabs say so, with the way to start it.
    await page.goto(`${adminPath}?tab=settings`);
    await expect(page.getByRole("region", { name: "The preliminary judge is in" })).toBeVisible();
    // Settings shows each sub-activity's scoring, chosen from the program.
    await page.getByLabel("Scoring of").selectOption({ label: "Q&A" });
    await expect(page.getByText("5 seconds per candidate")).toBeVisible();
    // The live results say the pageant hasn't started, then that judging starts soon.
    await page.goto(livePath);
    await expect(page.getByText("The pageant hasn't started yet.", { exact: false })).toBeVisible();

    // Before the start, the Session tab shows each sub-activity's scoring too, and no line about sharing the live results
    // (each sub-activity says how its results come out).
    await page.goto(`${adminPath}?tab=session`);
    await expect(page.getByRole("region", { name: "Scoring", exact: true }).getByLabel("Scoring of")).toBeVisible();
    await expect(page.getByText("Share it now", { exact: false })).toHaveCount(0);
    // The banner's button starts the preliminary from another tab: the Session tab opens asking.
    await page.goto(`${adminPath}?tab=judges`);
    await page.getByRole("region", { name: "The preliminary judge is in" }).getByRole("link", { name: "Start preliminary" }).click();
    await page.getByRole("dialog", { name: "Start the preliminary?" }).getByRole("button", { name: "Start preliminary" }).click();
    await expect(page.getByText("Live · Preliminary")).toBeVisible();
    await page.goto(livePath);
    await expect(page.getByText("Judging starts soon.", { exact: false })).toBeVisible(REALTIME);
    await page.goto(`${adminPath}?tab=session`);
    // No sub-activity is on yet: the desk offers the first one, and the preliminary's judges wait for it.
    await expect(page.getByText("Choose what to judge next")).toBeVisible();
    await expect(page.getByText("Live · Preliminary")).toBeVisible();
    await expect(page.getByRole("button", { name: "Judge Interview · Questions", exact: true })).toBeVisible();
    // Nothing is scored yet, so ending the preliminary isn't offered: it would only be refused.
    await expect(page.getByRole("button", { name: "End preliminary" })).toHaveCount(0);
    await expect(dina.getByRole("heading", { level: 1 })).toHaveText("Waiting for the first part of the preliminary", REALTIME);
    // Pageant proper's board waits for its own start.
    await expect(ana.getByRole("heading", { level: 1 })).toHaveText("Pageant proper starts soon", REALTIME);

    // The preliminary's part of the program is final once it starts; pageant proper's can change until it starts.
    await page.goto(`${adminPath}?tab=segments`);
    await expect(page.getByText("The preliminary has started, so its part of the program is final.")).toBeVisible();
    await expect(page.getByLabel("Name of Preliminary sub-activity 1")).toHaveCount(0);
    await expect(page.getByLabel("Name of Pageant proper sub-activity 2")).toHaveValue("Q&A");
    await snap(page, "segments with the preliminary locked");
    // So can pageant proper's own judges: the preliminary's are locked.
    await page.goto(`${adminPath}?tab=judges`);
    await expect(page.getByText("The preliminary has started, so its judges are locked.")).toBeVisible();
    await expect(page.getByRole("button", { name: "Remove Ben Torres" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Remove Dina Lopez" })).toHaveCount(0);
    await expect(page.getByRole("group", { name: "Add a pageant proper judge" })).toBeVisible();
    await expectAccessible(page);
  });

  test("the preliminary is judged part by part, candidate by candidate", async ({ page }) => {
    // Long by nature: candidate after candidate, and here the timer runs out too.
    test.slow();
    await openDesk(page);
    await page.getByRole("button", { name: "Judge Interview · Questions", exact: true }).click();
    await expect(page.getByRole("heading", { name: /^Interview · Questions · / })).toBeVisible();
    await expect(dina.getByText(`${NAME} · Interview · Questions`)).toBeVisible(REALTIME);
    // The preliminary has its own board, so pageant proper's judges wait for theirs to start.
    await expect(ana.getByRole("heading", { level: 1 })).toHaveText("Pageant proper starts soon", REALTIME);

    await judgeCandidate(page, preliminaryBoard(), "Show first candidate", "Ayla", "9", "9.00");
    await judgeCandidate(page, preliminaryBoard(), "Next: Bea", "Bea", "8", "8.00");
    await judgeCandidate(page, preliminaryBoard(), "Next: Cora", "Cora", "8", "8.00");

    // Pageant proper waits for its own start.
    const program = page.getByRole("region", { name: "Program" });
    await expect(program.getByRole("button", { name: "Judge now Evening wear" })).toHaveCount(0);
    await expect(program).toContainText("After the preliminary");

    // A deduction for a violation: from the pageant's list, then taken back, so the cut below ranks as before.
    await program.getByRole("button", { name: /^Deductions/ }).click();
    const deductions = page.getByRole("dialog", { name: "Deductions" });
    await deductions.getByLabel("Candidate").selectOption({ label: "No. 1 Ayla" });
    await deductions.getByLabel("Violation").selectOption({ label: "Late for call time, 1 point" });
    await deductions.getByRole("button", { name: "Deduct" }).click();
    await expect(deductions.getByRole("status")).toHaveText("1 point off Ayla's preliminary score: Late for call time.");
    await expect(deductions.getByRole("listitem").filter({ hasText: "Ayla" })).toContainText("Late for call time");
    await expectAccessible(page);
    await deductions.getByRole("button", { name: "Take back Ayla's deduction for Late for call time" }).click();
    await expect(deductions).toContainText("None yet.");
    await deductions.getByRole("button", { name: "Close" }).click();
    await expect(deductions).toBeHidden();

    // The interview's next part, judged the same way.
    await page.getByRole("button", { name: "Next: Interview · Advocacy" }).click();
    await expect(page.getByRole("heading", { name: /^Interview · Advocacy · / })).toBeVisible(REALTIME);
    await judgeCandidate(page, preliminaryBoard(), "Show first candidate", "Ayla", "9", "9.00");
    await judgeCandidate(page, preliminaryBoard(), "Next: Bea", "Bea", "8", "8.00");
    await judgeCandidate(page, preliminaryBoard(), "Next: Cora", "Cora", "8", "8.00");

    // A judged sub-activity can go back on judges' screens.
    await expect(program.getByRole("button", { name: "Show again Interview · Questions" })).toBeVisible();

    // The last preliminary candidate in, the desk offers the preliminary's end, rather than pageant proper.
    const end = page.getByRole("dialog", { name: "End the preliminary?" });
    await page.getByRole("button", { name: "End preliminary" }).click();
    await end.getByLabel("Your password").fill(ADMIN_PASSWORD);
    await end.getByRole("button", { name: "End preliminary" }).click();
    // Dina judges only the preliminary: she's done. Pageant proper's board still waits.
    await expect(dina.getByRole("heading", { level: 1 })).toHaveText("Your part of the pageant is done", REALTIME);
    await expect(page.getByText("The preliminary has ended", { exact: true })).toBeVisible(REALTIME);
    await expect(page.getByText("Preliminary done · Waiting for pageant proper")).toBeVisible();
    await snap(page, "desk between the segments");
    await snap(dina, "judge whose part is done");
    // The break, in the order the work goes: deductions (open until pageant proper starts), then pageant proper's
    // judges (their devices approved right here, ticked once all are paired). Its start is in the action bar.
    const steps = page.getByRole("region", { name: "Before pageant proper" }).getByRole("heading", { level: 3 });
    await expect(steps).toHaveText(["Record deductions", "Pair pageant proper's judges, done"]);
    await page.getByRole("listitem", { name: "Record deductions" }).getByRole("button", { name: "Add a deduction" }).click();
    await expect(page.getByRole("dialog", { name: "Deductions" }).getByRole("button", { name: "Deduct" })).toBeVisible();
    await page.getByRole("dialog", { name: "Deductions" }).getByRole("button", { name: "Close" }).click();
    await expect(page.getByRole("list", { name: "Pageant proper's judges" }).getByRole("listitem")).toHaveCount(3);
    // Everyone's paired, so the action bar has no one to name: the step's tick says it.
    await expect(page.getByRole("group", { name: "Pageant proper's start" }).getByRole("status")).toHaveText("");

    await page.getByRole("button", { name: "Start pageant proper" }).click();
    await page.getByRole("dialog", { name: "Start pageant proper?" }).getByRole("button", { name: "Start pageant proper" }).click();
    await expect(page.getByText("Live · Pageant proper")).toBeVisible(REALTIME);
    await expect(ana.getByRole("heading", { level: 1 })).toHaveText("Waiting for the first part of pageant proper", REALTIME);
    // Deductions closed with pageant proper's start.
    await program.getByRole("button", { name: /^Deductions/ }).click();
    await expect(page.getByRole("dialog", { name: "Deductions" }).getByRole("button", { name: "Deduct" })).toHaveCount(0);
    await page.getByRole("dialog", { name: "Deductions" }).getByRole("button", { name: "Close" }).click();
    await page.getByRole("button", { name: "Judge Evening wear", exact: true }).click();
    await expect(page.getByRole("heading", { name: /^Evening wear · / })).toBeVisible(REALTIME);
  });

  test("a tie on the cut line is broken by the organizer", async ({ page }) => {
    await openDesk(page);
    await judgeCandidate(page, properBoard(), "Show first candidate", "Ayla", "9", "9.00");
    await judgeCandidate(page, properBoard(), "Next: Bea", "Bea", "7", "7.00");
    await judgeCandidate(page, properBoard(), "Next: Cora", "Cora", "7", "7.00");

    await page.getByRole("button", { name: "Review the Top 2", exact: true }).click();
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
    // Long by nature: candidate after candidate, and here the timer runs out too.
    test.slow();
    await openDesk(page);
    await page.getByRole("button", { name: "Show first candidate", exact: true }).click();
    await expect(ana.getByRole("heading", { level: 1 })).toHaveText("Ayla", REALTIME);
    await expect(ana.getByText("No. 1", { exact: true })).toBeVisible();

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
    await expect(ana.getByRole("status").filter({ hasText: "Saved" })).toHaveText("Saved 9.00 for Ayla", SAVED);

    // The program is final, so the desk gives Ben and Cara more time instead: 15 seconds more each press.
    const more = page.getByRole("button", { name: "+15 s", exact: true });
    for (let press = 0; press < 3; press++) {
      await expect(more).toBeEnabled(REALTIME);
      await more.click();
    }
    await submitScore(ben, "Ayla", "9", "9.00");
    await submitScore(cara, "Ayla", "9", "9.00");

    // The LED wall and the live results follow the sub-activity, with only the candidates still in it.
    const led = await (await browser.newContext({ viewport: { width: 1920, height: 1080 } })).newPage();
    await led.goto(ledPath);
    await expect(led.getByText("Ayla", { exact: true })).toBeVisible(REALTIME);
    // Under her name, her details (a candidate without them has the sub-activity's name there).
    await expect(led.getByText("Cebu City", { exact: true })).toBeVisible();
    // Ayla's photo from the setup sits beside her name, on the green screen and full screen alike.
    await expect.poll(() => led.locator("img[data-entry-photo]").evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth > 0)).toBe(true);
    await snap(led, "LED lower third in a pageant");
    await page.goto(`${adminPath}?tab=led`);
    await page.getByLabel("Full screen").check();
    await expect.poll(() => led.locator("main > div").first().evaluate((el) => getComputedStyle(el).backgroundColor), REALTIME).toBe("rgb(11, 37, 69)");
    await expect(led.locator("img[data-entry-photo]")).toBeVisible();
    await snap(led, "LED full screen in a pageant");
    await page.getByLabel("Green screen").check();
    await expect.poll(() => led.locator("main > div").first().evaluate((el) => getComputedStyle(el).backgroundColor), REALTIME).toBe("rgb(0, 255, 0)");
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
    await page.getByRole("button", { name: "Next: Cora", exact: true }).click();
    // Cora keeps her number from the full running order.
    await expect(ana.getByText("No. 3", { exact: true })).toBeVisible(REALTIME);
    // Q&A gives judges 5 seconds each: the board scores together.
    await Promise.all(properBoard().map((judge) => submitScore(judge, "Cora", "10", "10.00")));
    await expect(page.getByRole("status").filter({ hasText: "Every judge has scored Cora." })).toBeVisible(REALTIME);

    await page.getByRole("button", { name: "Review the Top 2", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "Final cut: Top 2" });
    await dialog.getByRole("button", { name: "Confirm the final results" }).click();
    await expect(dialog.getByRole("status").filter({ hasText: "Final results confirmed." })).toBeVisible();
    await expect(dialog).toContainText("The order below is the final placement.");
    // Cora won the Q&A, so she wins; Ayla is the 1st runner-up.
    const rows = dialog.locator("tbody tr");
    await expect(rows.nth(0)).toContainText("Winner");
    await expect(rows.nth(0)).toContainText("Cora");
    await expect(rows.nth(1)).toContainText("1st Runner-up");
    await expect(rows.nth(1)).toContainText("Ayla");
    await snap(page, "final results");
    await dialog.getByRole("button", { name: "Close" }).click();
    // The desk turns to the placements, for the announcement, with the pageant's end as its next step.
    await expect(page.getByText("Cora wins", { exact: true })).toBeVisible();
    await expect(page.getByRole("list", { name: "Final placements" }).getByRole("listitem")).toHaveText([/^Winner\s*No\. 3 Cora/, /^1st Runner-up\s*No\. 1 Ayla/]);
    await snap(page, "desk with the final placements");

    // Nothing is left to judge, so the desk offers to end pageant proper, and with it the pageant.
    await page.getByRole("button", { name: "End pageant proper" }).click();
    const end = page.getByRole("dialog", { name: "End pageant proper?" });
    await end.getByLabel("Your password").fill(ADMIN_PASSWORD);
    await end.getByRole("button", { name: "End pageant proper" }).click();
    await expect(page.getByRole("heading", { name: "Judging has ended" })).toBeVisible();
    await expect(page.getByText(/scores? (is|are) missing/)).toHaveCount(0);
  });

  test("each sub-activity, the cuts and the preliminary have their own results, as PDF and CSV", async ({ page }) => {
    await openDesk(page);
    const slug = NAME.toLowerCase().replace(/\s+/g, "-");
    for (const [of, link, file] of [
      ["Interview · Questions", "Results (PDF)", `${slug}-interview-questions-results.pdf`],
      ["Interview · Questions", "Judges' score sheets (PDF)", `${slug}-interview-questions-judges-score-sheets.pdf`],
      ["Interview", "Standings (PDF)", `${slug}-interview-results.pdf`],
      // A sub-activity in parts: each judge's sheets for every part, in one PDF.
      ["Interview", "Judges' score sheets (PDF)", `${slug}-interview-judges-score-sheets.pdf`],
      ["Q&A", "Results (PDF)", `${slug}-qa-results.pdf`],
      ["Q&A", "Judges' score sheets (PDF)", `${slug}-qa-judges-score-sheets.pdf`],
      ["the preliminary", "Standings (PDF)", `${slug}-preliminary-results.pdf`],
      ["the Top 2", "Results (PDF)", `${slug}-top-2-results.pdf`],
      ["the final results", "Results (PDF)", `${slug}-final-results.pdf`],
    ] as const) {
      const download = await exportFile(page, `${link} for ${of}`, `Export ${of}`);
      expect(download.suggestedFilename()).toBe(file);
      expect(readFileSync(await download.path()).subarray(0, 5).toString()).toBe("%PDF-");
    }
    // The same sheets as CSV: a sub-activity's results, and the final results with each candidate's place.
    const qa = await exportFile(page, "Results (CSV) for Q&A", "Export Q&A");
    expect(qa.suggestedFilename()).toBe(`${slug}-qa-results.csv`);
    expect(readFileSync(await qa.path(), "utf8")).toContain("Rank,No.,Candidate,Details,");
    expect(readFileSync(await qa.path(), "utf8")).toContain("Cebu City");
    const final = await exportFile(page, "Results (CSV) for the final results", "Export the final results");
    expect(final.suggestedFilename()).toBe(`${slug}-final-results.csv`);
    expect(readFileSync(await final.path(), "utf8")).toContain("Place,Rank,No.,Candidate,");
    expect(readFileSync(await final.path(), "utf8")).toMatch(/\nWinner,\d+,3,Cora,/);
  });
});
