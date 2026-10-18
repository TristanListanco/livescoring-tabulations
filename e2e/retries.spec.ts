import { randomBytes, randomUUID } from "node:crypto";
import { devices, expect, test, type Page, type Request } from "@playwright/test";
import { deleteActivityNamed, openJudgeLink, SAVED, signInAsSuperAdmin, supabaseAdmin, tapScore } from "./helpers";

// On venue Wi-Fi a request can reach the server and its reply be lost: the screen says it didn't go through, and the
// person sends it again. The second send is answered with what the first did, never done twice.

const api = supabaseAdmin()!;
const RUN = Date.now().toString(36);
const activity = { id: randomUUID(), publicId: randomBytes(5).toString("hex") };
const judge = randomUUID();
const entry = randomUUID();
// Six characters from the codes' alphabet, unique to this run.
const CODE = `R${RUN.toUpperCase().replace(/[^A-Z2-9]/g, "X").slice(-5).padStart(5, "X")}`;
const EVENT = `E2E Retry ${RUN}`;

async function rest(path: string, body: unknown, method = "POST") {
  const response = await fetch(`${api.url}/rest/v1/${path}`, {
    method,
    headers: { ...api.headers, "Content-Type": "application/json", Prefer: "return=minimal" },
    body: JSON.stringify(body),
  });
  expect(response.ok, await response.text()).toBe(true);
}

const count = async (path: string) => ((await (await fetch(`${api.url}/rest/v1/${path}`, { headers: api.headers })).json()) as unknown[]).length;

/**
 * The next server action this page sends reaches the server, but its reply never reaches the page. Resolves with that
 * request, to send again exactly as it was.
 */
async function loseNextReply(page: Page): Promise<Request> {
  return new Promise((resolve) => {
    let lost = false;
    void page.route("**/*", async (route) => {
      if (lost || route.request().method() !== "POST" || !route.request().headers()["next-action"]) return route.fallback();
      lost = true;
      await route.fetch();
      await route.abort("connectionreset");
      resolve(route.request());
    });
  });
}

test.beforeAll(async () => {
  await rest("activities", { id: activity.id, name: "E2E Retry scores", public_id: activity.publicId, min_score: 1, max_score: 10, decimals: 2, session_state: "live" });
  await rest("judges", { id: judge, activity_id: activity.id, name: "Ana Cruz", first_name: "Ana", last_name: "Cruz", position: 0, is_chair: true });
  await rest("judge_access", { judge_id: judge, code: CODE });
  await rest("entries", { id: entry, activity_id: activity.id, name: "Agila", position: 0 });
  await rest(`activities?id=eq.${activity.id}`, { current_entry_id: entry }, "PATCH");
});

test.afterAll(async () => {
  await fetch(`${api.url}/rest/v1/activities?id=eq.${activity.id}`, { method: "DELETE", headers: api.headers });
  await deleteActivityNamed(EVENT);
});

test("a score sent again after its reply was lost is saved once", async ({ browser }) => {
  const phone = await (await browser.newContext({ ...devices["Pixel 7"] })).newPage();
  await openJudgeLink(phone, CODE);
  // The organizer approves this phone.
  await rest(`judge_devices?judge_id=eq.${judge}`, { status: "approved" }, "PATCH");
  await expect(phone.getByRole("heading", { level: 1 })).toHaveText("Agila", { timeout: 20_000 });

  const lost = loseNextReply(phone);
  await tapScore(phone, "8");
  await phone.getByRole("button", { name: "Submit score" }).click();
  await phone.getByRole("dialog").getByRole("button", { name: "Submit", exact: true }).click();
  const request = await lost;
  // The screen catches up from the database: the score is in.
  await expect(phone.getByText("Your score is in, and it's final.")).toBeVisible(SAVED);

  // The same request again, as a retry would send it: answered "saved", not "already scored".
  const again = await phone.request.fetch(request.url(), { method: "POST", headers: await request.allHeaders(), data: request.postData() ?? "" });
  const reply = await again.text();
  expect(reply).toContain('"ok":true');
  expect(reply).not.toContain("already scored");
  expect(await count(`scores?select=id&activity_id=eq.${activity.id}`)).toBe(1);
  await phone.context().close();
});

test("an activity sent again after its reply was lost is created once", async ({ page }) => {
  await signInAsSuperAdmin(page);
  await page.goto("/admin/new");
  await page.getByLabel("Name", { exact: true }).fill(EVENT);
  await page.getByRole("button", { name: "Remove judge 3" }).click();
  await page.getByRole("button", { name: "Remove judge 2" }).click();
  await page.getByLabel("Judge 1 first name").fill("Ana");
  await page.getByLabel("Judge 1 last name").fill("Cruz");
  await page.getByRole("radio", { name: "Chair of the board of judges: judge 1" }).check();
  await page.getByLabel("Entry names, one per line").fill("Agila");

  const lost = loseNextReply(page);
  await page.getByRole("button", { name: "Create activity" }).click();
  await lost;
  await expect(page.getByText("That didn't reach the server. Check this screen's connection and try again.")).toBeVisible({ timeout: 20_000 });
  // Sent again: it goes to the activity the first send made.
  await page.getByRole("button", { name: "Create activity" }).click();
  await expect(page).toHaveURL(/\/admin\/[0-9a-f-]{36}$/, { timeout: 20_000 });
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(EVENT);
  expect(await count(`activities?select=id&name=eq.${encodeURIComponent(EVENT)}`)).toBe(1);
});
