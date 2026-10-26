import { randomBytes, randomUUID } from "node:crypto";
import { devices, expect, test, type Page } from "@playwright/test";
import { expectAccessible, openJudgeLink, signInAsSuperAdmin, snap, supabaseAdmin } from "./helpers";

// The chair of the board of judges is chosen when the activity is created, and another judge can take over on the
// Judges tab until the session starts: from the chair of the same segments, so each board keeps exactly one. Then it's
// locked, on the page and in the database itself (migration 031).

const api = supabaseAdmin()!;
const RUN = Date.now().toString(36);
const event = { id: randomUUID(), publicId: randomBytes(5).toString("hex") };
const pageant = { id: randomUUID(), publicId: randomBytes(5).toString("hex") };
const judge = { ana: randomUUID(), ben: randomUUID(), cora: randomUUID() };
const board = { dan: randomUUID(), eli: randomUUID(), fay: randomUUID(), gus: randomUUID(), hal: randomUUID() };
const BEN_CODE = `C${RUN.toUpperCase().replace(/[^A-Z2-9]/g, "X").slice(-5).padStart(5, "X")}`;

async function rest(path: string, body: unknown, method = "POST", headers: Record<string, string> = api.headers) {
  return fetch(`${api.url}/rest/v1/${path}`, {
    method,
    headers: { ...headers, "Content-Type": "application/json", Prefer: "return=minimal" },
    body: JSON.stringify(body),
  });
}
async function restOk(path: string, body: unknown, method = "POST") {
  const response = await rest(path, body, method);
  expect(response.ok, await response.text()).toBe(true);
}
/** Who chairs, as the database has it. */
async function chairs(activityId: string) {
  const response = await fetch(`${api.url}/rest/v1/judges?select=name&activity_id=eq.${activityId}&is_chair=is.true&order=position`, { headers: api.headers });
  return ((await response.json()) as { name: string }[]).map((j) => j.name);
}
const row = (page: Page, name: string) => page.getByRole("listitem").filter({ has: page.getByRole("button", { name: `Remove ${name}` }) });

test.describe.serial("the chair", () => {
  test.beforeAll(async () => {
    await restOk("activities", [
      { id: event.id, name: `E2E Chair ${RUN}`, public_id: event.publicId, min_score: 1, max_score: 10, decimals: 2, kind: "event" },
      { id: pageant.id, name: `E2E Chair pageant ${RUN}`, public_id: pageant.publicId, min_score: 1, max_score: 10, decimals: 2, kind: "pageant" },
    ]);
    const person = (id: string, activityId: string, first: string, last: string, position: number, extra = {}) => ({
      id,
      activity_id: activityId,
      name: `${first} ${last}`,
      first_name: first,
      last_name: last,
      position,
      is_chair: false,
      panel: "all",
      ...extra,
    });
    await restOk("judges", [
      person(judge.ana, event.id, "Ana", "Cruz", 0, { is_chair: true }),
      person(judge.ben, event.id, "Ben", "Torres", 1),
      person(judge.cora, event.id, "Cora", "Lim", 2),
      // Separate boards: Dan chairs the preliminary, Fay pageant proper; Hal judges both.
      person(board.dan, pageant.id, "Dan", "Reyes", 0, { is_chair: true, panel: "preliminary" }),
      person(board.eli, pageant.id, "Eli", "Santos", 1, { panel: "preliminary" }),
      person(board.fay, pageant.id, "Fay", "Ramos", 2, { is_chair: true, panel: "proper" }),
      person(board.gus, pageant.id, "Gus", "Tan", 3, { panel: "proper" }),
      person(board.hal, pageant.id, "Hal", "Uy", 4),
    ]);
    await restOk("judge_access", { judge_id: judge.ben, code: BEN_CODE });
    await restOk("entries", { activity_id: event.id, name: "Agila", position: 0 });
  });

  test.afterAll(async () => {
    await fetch(`${api.url}/rest/v1/activities?id=in.(${event.id},${pageant.id})`, { method: "DELETE", headers: api.headers });
  });

  test("before the session starts, another judge takes over as chair", async ({ page }) => {
    await signInAsSuperAdmin(page);
    await page.goto(`/admin/${event.id}?tab=judges`);
    // Ana chairs: she can't be removed (the board would be left without a chair), and the others can take over.
    await expect(row(page, "Ana Cruz")).toContainText("Chair");
    await expect(row(page, "Ana Cruz").getByRole("button", { name: /^Make chair/ })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Remove Ana Cruz" })).toBeDisabled();

    await page.getByRole("button", { name: "Make chair Ben Torres" }).click();
    await expect(page.getByRole("status").filter({ hasText: "Ben Torres is now the chair." })).toBeVisible();
    await expect(row(page, "Ben Torres")).toContainText("Chair");
    // The message stays with him once his button has gone.
    await expect(row(page, "Ben Torres").getByRole("status")).toHaveText("Ben Torres is now the chair.");
    await expect(page.getByRole("button", { name: "Make chair Ana Cruz" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Remove Ana Cruz" })).toBeEnabled();
    await expect(page.getByRole("button", { name: "Remove Ben Torres" })).toBeDisabled();
    expect(await chairs(event.id)).toEqual(["Ben Torres"]);
    await snap(page, "event judges");
    await expectAccessible(page);
  });

  test("in a pageant with separate boards, each board's chair is taken over by a judge on that board", async ({ page }) => {
    await signInAsSuperAdmin(page);
    await page.goto(`/admin/${pageant.id}?tab=judges`);
    await expect(page.getByText("Separate boards. Preliminary: 3 judges, chaired by Dan Reyes. Pageant proper: 3 judges, chaired by Fay Ramos.")).toBeVisible();
    // Hal judges both segments, which no chair does: he's offered neither.
    await expect(row(page, "Hal Uy").getByRole("button", { name: /^Make/ })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Make pageant proper chair Eli Santos" })).toHaveCount(0);

    await page.getByRole("button", { name: "Make preliminary chair Eli Santos" }).click();
    await expect(page.getByRole("status").filter({ hasText: "Eli Santos is now the preliminary chair." })).toBeVisible();
    await page.getByRole("button", { name: "Make pageant proper chair Gus Tan" }).click();
    await expect(page.getByRole("status").filter({ hasText: "Gus Tan is now the pageant proper chair." })).toBeVisible();
    await expect(row(page, "Eli Santos").getByRole("status")).toHaveText("Eli Santos is now the preliminary chair.");
    await expect(page.getByText("Separate boards. Preliminary: 3 judges, chaired by Eli Santos. Pageant proper: 3 judges, chaired by Gus Tan.")).toBeVisible();
    expect(await chairs(pageant.id)).toEqual(["Eli Santos", "Gus Tan"]);
    await snap(page, "pageant judges");
    await expectAccessible(page);
  });

  test("once the session starts, the new chair runs it from their screen, and the chair is locked", async ({ browser, page }) => {
    const context = await browser.newContext({ ...devices["Pixel 7"] });
    const phone = await context.newPage();
    await openJudgeLink(phone, BEN_CODE);
    await restOk(`judge_devices?judge_id=eq.${judge.ben}`, { status: "approved" }, "PATCH");
    await expect(phone.getByRole("heading", { level: 1 })).toHaveText("Waiting for the organizer to start", { timeout: 20_000 });
    await restOk(`activities?id=eq.${event.id}`, { session_state: "live" }, "PATCH");
    // The chair shows the first entry themselves.
    await expect(phone.getByRole("heading", { level: 1 })).toHaveText("Ready for the first entry", { timeout: 20_000 });
    await context.close();

    await signInAsSuperAdmin(page);
    await page.goto(`/admin/${event.id}?tab=judges`);
    await expect(page.getByRole("note")).toHaveText("The session has started, so the panel of judges is locked.");
    await expect(page.getByRole("button", { name: /^Make chair/ })).toHaveCount(0);

    // Even straight to the database, it refuses. (A database without migration 031 has only the app's check.)
    const late = await rest("rpc/set_judge_chair", { judge: judge.cora });
    const { code } = await late.json();
    test.skip(code === "PGRST202", "This database doesn't have migration 031 yet.");
    expect(code).toBe("55000");
    expect(await chairs(event.id)).toEqual(["Ben Torres"]);
  });

  test("only the server can change the chair", async () => {
    const publicKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!;
    const response = await rest("rpc/set_judge_chair", { judge: judge.ana }, "POST", { apikey: publicKey, Authorization: `Bearer ${publicKey}` });
    expect(response.ok).toBe(false);
  });
});
