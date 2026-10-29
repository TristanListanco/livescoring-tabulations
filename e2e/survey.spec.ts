import { randomBytes, randomUUID } from "node:crypto";
import { devices, expect, test, type Locator } from "@playwright/test";
import { SURVEY_URL } from "../src/lib/survey";
import { expectAccessible, openJudgeLink, signInAsSuperAdmin, snap, supabaseAdmin } from "./helpers";

// The feedback survey is offered where people finish using Tabulous: the judge's screen, the organizer's desk and the
// live results, once judging has ended, and at the foot of the organizer's panel. It opens apart, and isn't told where
// the link was: the survey is anonymous.

const api = supabaseAdmin()!;
const RUN = Date.now().toString(36);
const activity = { id: randomUUID(), publicId: randomBytes(5).toString("hex") };
const judge = randomUUID();
const CODE = `V${RUN.toUpperCase().replace(/[^A-Z2-9]/g, "X").slice(-5).padStart(5, "X")}`;

async function restOk(path: string, body: unknown, method = "POST") {
  const response = await fetch(`${api.url}/rest/v1/${path}`, {
    method,
    headers: { ...api.headers, "Content-Type": "application/json", Prefer: "return=minimal" },
    body: JSON.stringify(body),
  });
  expect(response.ok, await response.text()).toBe(true);
}

async function expectSurvey(link: Locator) {
  await expect(link).toHaveAttribute("href", SURVEY_URL!);
  await expect(link).toHaveAttribute("target", "_blank");
  await expect(link).toHaveAttribute("rel", "noreferrer");
}

test.describe.serial("feedback survey", () => {
  test.skip(!SURVEY_URL, "No survey yet: src/lib/survey.ts has no link.");

  test.beforeAll(async () => {
    await restOk("activities", { id: activity.id, name: `E2E Survey ${RUN}`, public_id: activity.publicId, min_score: 1, max_score: 10, decimals: 2, session_state: "live" });
    await restOk("judges", { id: judge, activity_id: activity.id, name: "Ana Cruz", first_name: "Ana", last_name: "Cruz", position: 0, is_chair: true });
    await restOk("judge_access", { judge_id: judge, code: CODE });
    await restOk("entries", { id: randomUUID(), activity_id: activity.id, name: "Agila", position: 0 });
    await restOk(`activities?id=eq.${activity.id}`, { session_state: "ended", session_ended_at: new Date().toISOString() }, "PATCH");
  });

  test.afterAll(async () => {
    await fetch(`${api.url}/rest/v1/activities?id=eq.${activity.id}`, { method: "DELETE", headers: api.headers });
  });

  test("the judge is asked once judging has ended", async ({ browser }) => {
    const context = await browser.newContext({ ...devices["Pixel 7"] });
    const phone = await context.newPage();
    await openJudgeLink(phone, CODE);
    await restOk(`judge_devices?judge_id=eq.${judge}`, { status: "approved" }, "PATCH");
    // As the organizer's approval does: the judge's screen hears of it.
    await restOk(`judges?id=eq.${judge}`, { devices_updated_at: new Date().toISOString() }, "PATCH");
    await expect(phone.getByRole("heading", { level: 1 })).toHaveText("Judging has ended", { timeout: 20_000 });
    await expectSurvey(phone.getByRole("link", { name: "Take the survey (opens in a new tab)" }));
    await snap(phone, "judge");
    await expectAccessible(phone);
    await context.close();
  });

  test("so is the audience, on the live results on their phones (not on a venue screen)", async ({ browser, page }) => {
    const context = await browser.newContext({ ...devices["Pixel 7"] });
    const phone = await context.newPage();
    await phone.goto(`/live/${activity.publicId}`);
    await expectSurvey(phone.getByRole("link", { name: "Take the survey (opens in a new tab)" }));
    await snap(phone, "live results");
    await expectAccessible(phone);
    await context.close();

    await page.goto(`/live/${activity.publicId}`);
    await expect(page.getByText(/^Ended · /).first()).toBeVisible();
    await expect(page.getByRole("link", { name: "Take the survey (opens in a new tab)" })).toHaveCount(0);
  });

  test("and the organizer, on the desk and at the foot of the panel", async ({ page }) => {
    await signInAsSuperAdmin(page);
    await expectSurvey(page.getByRole("contentinfo").getByRole("link", { name: "Feedback survey (opens in a new tab)" }));
    await page.goto(`/admin/${activity.id}?tab=session`);
    const desk = page.getByRole("region", { name: "Judging has ended" });
    await expectSurvey(desk.getByRole("link", { name: "Take the survey (opens in a new tab)" }));
    await snap(page, "desk");
    await expectAccessible(page);
  });
});
