import { expect, test } from "@playwright/test";
import { choosePhoto, deleteActivityNamed, signInAsSuperAdmin, supabaseAdmin } from "./helpers";

// Candidates' photos from the pageant setup go up a few to a request just after the pageant is created: twelve make
// two requests, and every one of them arrives.
const NAME = `E2E Photos ${Date.now().toString(36)}`;
const CANDIDATES = ["Ayla", "Bea", "Cora", "Dana", "Ella", "Faye", "Gia", "Hana", "Ivy", "Jade", "Kaye", "Lia"];
let activityId = "";

/** The photos in an activity's folder in Storage. */
async function photosOf(id: string): Promise<string[]> {
  const api = supabaseAdmin()!;
  const listed = await fetch(`${api.url}/storage/v1/object/list/judge-photos`, {
    method: "POST",
    headers: { ...api.headers, "Content-Type": "application/json" },
    body: JSON.stringify({ prefix: id, limit: 100 }),
  });
  return ((await listed.json()) as { name: string }[]).map((f) => `${id}/${f.name}`);
}

test.afterAll(async () => {
  // In case the test stopped before deleting the pageant: its photos too, which a delete straight from the database
  // leaves behind.
  const api = supabaseAdmin();
  const files = api && activityId ? await photosOf(activityId) : [];
  if (api && files.length) {
    await fetch(`${api.url}/storage/v1/object/judge-photos`, {
      method: "DELETE",
      headers: { ...api.headers, "Content-Type": "application/json" },
      body: JSON.stringify({ prefixes: files }),
    });
  }
  await deleteActivityNamed(NAME);
});

test("twelve candidates' photos go up with the new pageant", async ({ page }) => {
  await signInAsSuperAdmin(page);
  await page.goto("/admin/new");
  await page.getByRole("radio", { name: /^Pageant/ }).check();
  await page.getByLabel("Pageant name").fill(NAME);
  await page.getByLabel("Candidate 1 name").evaluate((field, text) => {
    const data = new DataTransfer();
    data.setData("text/plain", text);
    field.dispatchEvent(new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true }));
  }, CANDIDATES.join("\n"));
  await expect(page.getByLabel(`Candidate ${CANDIDATES.length} name`)).toHaveValue(CANDIDATES.at(-1)!);
  for (const name of CANDIDATES) await choosePhoto(page, `Photo for ${name}`);
  await page.getByRole("button", { name: "Continue to judges" }).click();

  for (const [i, [first, last]] of [["Ana", "Cruz"], ["Ben", "Torres"], ["Cara", "Diaz"]].entries()) {
    await page.getByLabel(`Judge ${i + 1} first name`).fill(first);
    await page.getByLabel(`Judge ${i + 1} last name`).fill(last);
  }
  await page.getByRole("radio", { name: "Chair of the board of judges: judge 1" }).check();
  await page.getByRole("button", { name: "Continue to preliminary" }).click();
  await page.getByLabel("Name of Preliminary sub-activity 1").fill("Interview");
  await page.getByRole("button", { name: "Continue to pageant proper" }).click();
  await page.getByLabel("Name of Pageant proper sub-activity 1").fill("Evening wear");
  await page.getByLabel("Top (candidates placed in the final cut after Evening wear)").fill("3");
  await page.getByRole("button", { name: "Continue to review" }).click();
  await expect(page.getByText(`${CANDIDATES.length} in running order, ${CANDIDATES.length} with photos`)).toBeVisible();

  // One request creates the pageant, and the photos follow in two more (ten, then two), rather than one each.
  let requests = 0;
  page.on("request", (request) => {
    if (request.method() === "POST" && request.headers()["next-action"]) requests++;
  });
  await page.getByRole("button", { name: "Create pageant" }).click();
  await expect(page).toHaveURL(/\/admin\/[0-9a-f-]{36}$/, { timeout: 30_000 });
  activityId = new URL(page.url()).pathname.split("/").at(-1)!;
  expect(requests).toBe(3);
  await page.goto(`/admin/${activityId}?tab=entries`);
  for (const name of CANDIDATES) await expect(page.getByRole("button", { name: `Remove photo of ${name}` })).toBeVisible();
  expect(await photosOf(activityId)).toHaveLength(CANDIDATES.length);

  // Deleting the pageant takes its photos with it, just after the page has moved on.
  await page.goto(`/admin/${activityId}?tab=settings`);
  await page.getByRole("button", { name: "Delete activity" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("textbox").fill(NAME);
  await dialog.getByRole("button", { name: "Delete activity" }).click();
  await expect(page).toHaveURL(/\/admin$/);
  await expect.poll(async () => (await photosOf(activityId)).length, { timeout: 10_000 }).toBe(0);
});
