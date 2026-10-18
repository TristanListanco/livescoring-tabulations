import { randomBytes, randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { ADMIN_PASSWORD, signInAsSuperAdmin, supabaseAdmin } from "./helpers";

// An event without live scoring: the organizer's private tally shows every score so far, judge by judge and criterion
// by criterion, marked partial and unofficial until the judges have signed. It opens with the admin's password, on that
// browser alone, and is watermarked with who's looking.

const api = supabaseAdmin()!;
const activity = { id: randomUUID(), publicId: randomBytes(5).toString("hex") };
const judges = [randomUUID(), randomUUID()];
const entries = [randomUUID(), randomUUID()];
const tally = `/admin/${activity.id}/tally`;

async function rest(path: string, body: unknown, method = "POST") {
  const response = await fetch(`${api.url}/rest/v1/${path}`, {
    method,
    headers: { ...api.headers, "Content-Type": "application/json", Prefer: "return=minimal" },
    body: JSON.stringify(body),
  });
  expect(response.ok, await response.text()).toBe(true);
}

test.beforeAll(async () => {
  await rest("activities", {
    id: activity.id,
    name: "E2E Private tally",
    public_id: activity.publicId,
    min_score: 0,
    max_score: 100,
    decimals: 2,
    scoring_mode: "criteria",
    criteria: [
      { id: "c1", name: "Choreography", max: 60 },
      { id: "c2", name: "Execution", max: 40 },
    ],
    criteria_display: "percent",
    live_scoring: false,
    session_state: "live",
  });
  await rest("judges", [
    { id: judges[0], activity_id: activity.id, name: "Ana Cruz", first_name: "Ana", last_name: "Cruz", position: 0, is_chair: true },
    { id: judges[1], activity_id: activity.id, name: "Ben Torres", first_name: "Ben", last_name: "Torres", position: 1, is_chair: false },
  ]);
  await rest("entries", [
    { id: entries[0], activity_id: activity.id, name: "Agila", position: 0 },
    { id: entries[1], activity_id: activity.id, name: "Bagwis", position: 1 },
  ]);
  // Ana has scored Agila; nobody has scored Bagwis yet.
  await rest("scores", { activity_id: activity.id, entry_id: entries[0], judge_id: judges[0], value: 87.5, breakdown: { c1: 52.5, c2: 35 } });
});

test.afterAll(async () => {
  await fetch(`${api.url}/rest/v1/activities?id=eq.${activity.id}`, { method: "DELETE", headers: api.headers });
});

test("the private tally opens with the admin's password, for that browser alone", async ({ page, browser }) => {
  await signInAsSuperAdmin(page);
  // The desk links to it.
  await page.goto(`/admin/${activity.id}?tab=session`);
  await expect(page.getByRole("link", { name: "Open the private tally" })).toHaveAttribute("href", tally);

  // Signed in isn't enough: it asks for the password, and shows nothing until then.
  await page.goto(tally);
  await expect(page.getByRole("heading", { name: "Private tally: E2E Private tally" })).toBeVisible();
  await expect(page.getByText("87.50%")).toHaveCount(0);
  await page.getByLabel("Super admin password").fill("not the password");
  await page.getByRole("button", { name: "Open the tally" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "isn't right" })).toHaveText("That password isn't right.");
  await page.getByLabel("Super admin password").fill(ADMIN_PASSWORD);
  await page.getByRole("button", { name: "Open the tally" }).click();

  // Every score so far, marked unofficial: by entry, and each judge's points per criterion.
  await expect(page.getByText("Partial and unofficial tally")).toBeVisible();
  await expect(page.getByText(/^1 of 4 scores in$/)).toBeVisible();
  const byEntry = page.getByRole("region", { name: "Scores by entry" });
  await expect(byEntry.getByRole("row").filter({ hasText: "Agila" })).toContainText("87.50%");
  await expect(byEntry.getByRole("row").filter({ hasText: "Bagwis" })).toContainText("0 of 2");
  const anas = page.getByRole("region", { name: "Ana Cruz's points by criterion" });
  await expect(anas.getByRole("row").filter({ hasText: "Agila" })).toContainText("52.50");
  await expect(anas.getByRole("row").filter({ hasText: "Agila" })).toContainText("35.00");

  // Watermarked with who's looking, and blank on paper.
  const mark = await page.locator("[style*='data:image/svg+xml']").first().getAttribute("style");
  expect(decodeURIComponent(mark ?? "")).toContain("Unofficial · Super admin");
  await page.emulateMedia({ media: "print" });
  await expect(page.getByText("The private tally can't be printed.")).toBeVisible();
  await expect(byEntry).toBeHidden();
  await page.emulateMedia({ media: "screen" });

  // Where the show stands, as on the live results: the judges deliberating, still unofficial...
  await rest(`activities?id=eq.${activity.id}`, { session_state: "deliberation" }, "PATCH");
  await expect(page.getByText("Judges deliberating")).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText("Partial and unofficial tally")).toBeVisible();
  // ...then every judge signs and the session ends: the tally is official.
  await rest("judge_signatures", judges.map((judge_id) => ({ judge_id, activity_id: activity.id, method: "checked" })));
  const now = new Date().toISOString();
  await rest(`activities?id=eq.${activity.id}`, { session_state: "ended", signed_off_at: now, session_ended_at: now }, "PATCH");
  await expect(page.getByText("Official tally")).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText("Partial and unofficial tally")).toHaveCount(0);
  await expect(page.getByText(/^Ended/)).toBeVisible();
  const official = await page.locator("[style*='data:image/svg+xml']").first().getAttribute("style");
  expect(decodeURIComponent(official ?? "")).toContain("Official · Super admin");

  // The same admin in another browser: still locked there. The link alone opens nothing.
  const other = await (await browser.newContext()).newPage();
  await signInAsSuperAdmin(other);
  await other.goto(tally);
  await expect(other.getByLabel("Super admin password")).toBeVisible();
  await expect(other.getByText("87.50%")).toHaveCount(0);
  await other.context().close();

  // Without signing in at all, the link goes to the sign-in page.
  const stranger = await (await browser.newContext()).newPage();
  await stranger.goto(tally);
  await expect(stranger).toHaveURL(/\/admin\/login$/);
  await stranger.context().close();
});
