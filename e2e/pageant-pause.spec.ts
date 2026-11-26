import { randomBytes, randomUUID } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";
import { deleteOrganizerByEmail, expectAccessible, openJudgeLink, signInAsOrganizer, signInAsSuperAdmin, supabaseAdmin } from "./helpers";

// A pageant paused in the break between its preliminary and pageant proper: its organizer can sign out, its judges are
// signed out and can't sign in, and once it's resumed (each with the organizer's password) the break picks up again and
// pageant proper starts as usual. Seeded in the break, owned by an organizer of its own (the super admin's account may
// hold other running test activities).

const api = supabaseAdmin()!;
const RUN = Date.now().toString(36);
const REALTIME = { timeout: 20_000 };
const ORGANIZER = { name: `E2E Pause ${RUN}`, email: `e2e-pause-${RUN}@example.com`, password: `e2e-pass-pause-${RUN}-1` };
const pageant = { id: randomUUID(), publicId: randomBytes(5).toString("hex"), name: `E2E Pageant pause ${RUN}` };
const judges = [randomUUID(), randomUUID(), randomUUID()];
const CODE = `Z${RUN.toUpperCase().replace(/[^A-Z2-9]/g, "X").slice(-5).padStart(5, "X")}`;
const PAUSED = "The organizer paused the pageant after the preliminary. Sign in again once it resumes.";
// Before migration 047 there's nowhere to keep the pause: the file skips.
let missing047 = false;

async function rest(path: string, body: unknown, method = "POST") {
  const response = await fetch(`${api.url}/rest/v1/${path}`, {
    method,
    headers: { ...api.headers, "Content-Type": "application/json", Prefer: "return=minimal" },
    body: JSON.stringify(body),
  });
  expect(response.ok, await response.text()).toBe(true);
}

const pairingCode = async (page: Page) =>
  (await page.locator("p").filter({ hasText: /^Pairing code [A-Z0-9]{4}$/ }).textContent())!.replace("Pairing code ", "");

/** Ana pairs her device, approved on the Judges tab. */
async function pairAna(page: Page, ana: Page) {
  await openJudgeLink(ana, CODE);
  const pairing = await pairingCode(ana);
  await page.goto(`/admin/${pageant.id}?tab=judges`);
  await page.getByRole("button", { name: `Approve Ana Cruz's device ${pairing}` }).click();
  await expect(ana.getByRole("heading", { level: 1 })).toHaveText("Pageant proper starts soon", REALTIME);
}

test.beforeAll(async ({ browser }) => {
  missing047 = !(await fetch(`${api.url}/rest/v1/activities?select=paused_at&limit=1`, { headers: api.headers })).ok;
  if (missing047) return;
  // Its organizer, made as the super admin makes one.
  await deleteOrganizerByEmail(ORGANIZER.email);
  const admin = await (await browser.newContext()).newPage();
  await signInAsSuperAdmin(admin);
  await admin.goto("/admin/organizers/new");
  await admin.getByLabel("Organizer name").fill(ORGANIZER.name);
  await admin.getByLabel("Email").fill(ORGANIZER.email);
  await admin.getByLabel("Password").fill(ORGANIZER.password);
  await admin.getByRole("checkbox", { name: /The organizer asked for this account/ }).check();
  await admin.getByRole("button", { name: "Create organizer" }).click();
  await expect(admin).toHaveURL(/\/admin\/organizers$/);
  await admin.context().close();
  const [owner] = (await (await fetch(`${api.url}/rest/v1/admins?select=id&email=eq.${encodeURIComponent(ORGANIZER.email)}`, { headers: api.headers })).json()) as { id: string }[];

  // The pageant, in the break: the preliminary has ended, pageant proper hasn't started.
  await rest("activities", { id: pageant.id, name: pageant.name, public_id: pageant.publicId, owner_id: owner.id, min_score: 1, max_score: 10, decimals: 0, kind: "pageant", live_scoring: true, preliminary_weight: 40 });
  const round = (name: string, segment: string, position: number, weight: number, cut: number | null) => ({
    id: randomUUID(),
    activity_id: pageant.id,
    segment,
    name,
    position,
    weight,
    cut_size: cut,
    cut_basis: [],
    scoring_mode: "simple",
    min_score: 1,
    max_score: 10,
    decimals: 0,
    criteria: [],
    criteria_display: "percent",
    timer_seconds: null,
    live_scoring: true,
  });
  await rest("rounds", [round("Interview", "preliminary", 0, 40, null), round("Gown", "proper", 1, 60, 1)]);
  // Pageant proper's board: three judges and a chair. Judges go in before the session starts (the panel locks then).
  await rest(
    "judges",
    judges.map((id, position) => {
      const [first, last] = [["Ana", "Cruz"], ["Ben", "Torres"], ["Cara", "Diaz"]][position];
      return { id, activity_id: pageant.id, name: `${first} ${last}`, first_name: first, last_name: last, position, is_chair: position === 0, panel: "all" };
    }),
  );
  await rest("judge_access", { judge_id: judges[0], code: CODE });
  await rest("entries", [
    { activity_id: pageant.id, name: "Ayla", position: 0 },
    { activity_id: pageant.id, name: "Bea", position: 1 },
  ]);
  const now = new Date().toISOString();
  await rest(`activities?id=eq.${pageant.id}`, { session_state: "live", session_started_at: now, preliminary_ended_at: now }, "PATCH");
});

test.afterAll(async () => {
  await fetch(`${api.url}/rest/v1/activities?id=eq.${pageant.id}`, { method: "DELETE", headers: api.headers });
  await deleteOrganizerByEmail(ORGANIZER.email);
});

test("paused between the segments, the organizer signs out, then resumes it and starts pageant proper", async ({ page, browser }) => {
  test.skip(missing047, "This database doesn't have migration 047 yet.");
  test.slow();
  const ana = await (await browser.newContext({ viewport: { width: 390, height: 844 } })).newPage();
  await signInAsOrganizer(page, ORGANIZER.email, ORGANIZER.password);
  await pairAna(page, ana);

  // In the break the pageant holds its organizer, who's told how to let go.
  const signOut = async () => {
    await page.getByRole("button", { name: "Sign out" }).click();
    await page.getByRole("dialog", { name: "Sign out?" }).getByRole("button", { name: "Sign out" }).click();
  };
  await signOut();
  await expect(page.getByRole("dialog", { name: "Sign out?" }).getByRole("alert")).toHaveText(
    `${pageant.name} is between its preliminary and pageant proper, so you can't sign out now. Pause it on its Session tab first.`,
  );
  await page.getByRole("dialog", { name: "Sign out?" }).getByRole("button", { name: "Cancel" }).click();

  // Paused with the password (a wrong one is refused).
  await page.goto(`/admin/${pageant.id}?tab=session`);
  await expect(page.getByRole("heading", { name: "Waiting for pageant proper" })).toBeVisible();
  await page.getByRole("button", { name: "Pause pageant" }).click();
  const pause = page.getByRole("dialog", { name: "Pause the pageant?" });
  await pause.getByLabel("Your password").fill("not the password");
  await pause.getByRole("button", { name: "Pause pageant" }).click();
  await expect(pause.getByRole("alert")).toHaveText("That password isn't right.");
  await pause.getByLabel("Your password").fill(ORGANIZER.password);
  await pause.getByRole("button", { name: "Pause pageant" }).click();
  await expect(page.getByRole("heading", { name: "Paused after the preliminary" })).toBeVisible(REALTIME);
  await expect(page.getByText("Preliminary done · Paused").first()).toBeVisible();
  await expect(page.getByRole("button", { name: "Start pageant proper" })).toHaveCount(0);
  await expectAccessible(page);

  // Ana's device is signed out, and she can't sign in again until it resumes.
  await expect(ana.getByText(PAUSED)).toBeVisible(REALTIME);
  await openJudgeLink(ana, CODE).catch(() => {});
  await expect(ana.getByText(PAUSED)).toBeVisible();

  // The organizer can sign out now, and back in later.
  await signOut();
  await expect(page).toHaveURL(/\/admin\/login/);
  await signInAsOrganizer(page, ORGANIZER.email, ORGANIZER.password);

  // Resumed with the password: the break again, and pageant proper starts as usual once Ana has paired again.
  await page.goto(`/admin/${pageant.id}?tab=session`);
  await page.getByRole("button", { name: "Resume pageant" }).click();
  const resume = page.getByRole("dialog", { name: "Resume the pageant?" });
  await resume.getByLabel("Your password").fill(ORGANIZER.password);
  await resume.getByRole("button", { name: "Resume pageant" }).click();
  await expect(page.getByRole("heading", { name: "Waiting for pageant proper" })).toBeVisible(REALTIME);
  await pairAna(page, ana);
  await page.goto(`/admin/${pageant.id}?tab=session`);
  await page.getByRole("button", { name: "Start pageant proper" }).click();
  await page.getByRole("dialog", { name: "Start pageant proper?" }).getByRole("button", { name: "Start pageant proper" }).click();
  await expect(ana.getByRole("heading", { level: 1 })).toHaveText("Waiting for the first part of pageant proper", REALTIME);
  await ana.context().close();
});
