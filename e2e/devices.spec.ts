import { devices, expect, test, type Page } from "@playwright/test";
import { deleteActivityNamed, openJudgeLink, signInAsSuperAdmin } from "./helpers";

// A judge's phone whose realtime connection is down (venue Wi-Fi, or the browser was in the background
// while the camera scanned a QR code) must still open within seconds of the organizer's approval.
const NAME = `E2E Devices ${Date.now().toString(36)}`;
// Well under the general 15-second fallback: approval has to land fast without realtime.
const QUICKLY = { timeout: 8_000 };

let adminPath = "";
let codes: string[] = [];
let phone: Page;

const pairingCode = async (page: Page) =>
  (await page.locator("p").filter({ hasText: /^Pairing code [A-Z0-9]{4}$/ }).textContent())!.replace("Pairing code ", "");

test.describe.serial("judge devices without realtime", () => {
  test.beforeAll(async ({ browser }) => {
    const context = await browser.newContext({ ...devices["Pixel 7"] });
    await context.routeWebSocket(/realtime/, (ws) => ws.close());
    phone = await context.newPage();
  });

  test.afterAll(async () => {
    await phone?.context().close();
    await deleteActivityNamed(NAME);
  });

  test("set up an activity with two judges", async ({ page }) => {
    await signInAsSuperAdmin(page);
    await page.goto("/admin/new");
    await page.getByLabel("Name", { exact: true }).fill(NAME);
    await page.getByRole("button", { name: "Remove judge 3" }).click();
    await page.getByLabel("Judge 1 first name").fill("Judge");
    await page.getByLabel("Judge 1 last name").fill("Alpha");
    await page.getByLabel("Judge 2 first name").fill("Judge");
    await page.getByLabel("Judge 2 last name").fill("Bravo");
    await page.getByRole("radio", { name: "Chair of the board of judges: judge 1" }).check();
    await page.getByLabel("Entry names, one per line").fill("Agila");
    await page.getByRole("button", { name: "Create activity" }).click();
    // Creating an activity uploads photos and writes several tables; allow for a slow network.
    await expect(page).toHaveURL(/\/admin\/[0-9a-f-]{36}$/, { timeout: 20_000 });
    adminPath = new URL(page.url()).pathname;
    codes = (await page.locator("p").filter({ hasText: /^Judge code [A-Z0-9]{6}$/ }).allTextContents()).map((t) => t.replace("Judge code ", ""));
  });

  test("approval reaches a phone with no realtime connection within seconds", async ({ page, playwright }) => {
    // A messaging app building a preview of Judge Alpha's link (iMessage's fetcher passes for Safari on a Mac). The
    // link only opens the sign-in page with the code filled in, so the fetch asks the organizer for nothing.
    const preview = await playwright.request.newContext({
      baseURL: test.info().project.use.baseURL,
      userAgent:
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_11_1) AppleWebKit/601.2.4 (KHTML, like Gecko) Version/9.0.1 Safari/601.2.4 facebookexternalhit/1.1 Facebot Twitterbot/1.0",
    });
    const fetched = await preview.get(`/judge/join/${codes[0]}`, { maxRedirects: 0 });
    expect(fetched.headers().location).toBe(`/judge?code=${codes[0]}&link=1`);
    await preview.dispose();

    await openJudgeLink(phone, codes[0]);
    const code = await pairingCode(phone);
    await signInAsSuperAdmin(page);
    await page.goto(`${adminPath}?tab=judges`);
    // Only the phone's request is waiting.
    await expect(page.getByRole("button", { name: /^Approve Judge Alpha's device / })).toHaveCount(1);
    await page.getByRole("button", { name: `Approve Judge Alpha's device ${code}` }).click();
    await expect(phone.getByRole("heading", { level: 1 })).toHaveText("Waiting for the organizer to start", QUICKLY);
  });

  test("switching the phone to another judge signs it out of the first", async ({ page }) => {
    // A link for another judge doesn't switch an approved phone by itself: it asks first.
    await phone.goto(`/judge/join/${codes[1]}`);
    await expect(phone.getByRole("heading", { level: 1 })).toHaveText("Switch judge?");
    await expect(phone.getByRole("link", { name: "Keep judging as Judge Alpha" })).toBeVisible();
    await phone.getByRole("button", { name: "Switch judge" }).click();
    const code = await pairingCode(phone);
    await signInAsSuperAdmin(page);
    await page.goto(`${adminPath}?tab=judges`);
    const row = (name: string) => page.getByRole("listitem").filter({ hasText: name }).first();
    await expect(row("Judge Alpha")).toContainText("No device approved. Last device signed out");

    await page.getByRole("button", { name: `Approve Judge Bravo's device ${code}` }).click();
    await expect(phone.getByRole("heading", { level: 1 })).toHaveText("Waiting for the organizer to start", QUICKLY);
    await expect(phone.getByRole("banner")).toContainText("Judge Bravo");
    await expect(row("Judge Bravo")).toContainText("Approved:");
  });
});
