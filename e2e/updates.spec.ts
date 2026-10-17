import { expect, test, type Page } from "@playwright/test";

// A page left open across a deploy calls the server with ids from the version it was loaded with, which the new
// version doesn't have. It says LiveScoring was updated and reloads into the new version, once.

/** Answer the page's server actions as a newer deployment would: it doesn't know them. */
async function deployedSinceLoaded(page: Page) {
  await page.route("**/judge", (route) =>
    route.request().method() === "POST" && route.request().headers()["next-action"]
      ? route.fulfill({ status: 404, headers: { "x-nextjs-action-not-found": "1", "content-type": "text/plain" }, body: "Server action not found." })
      : route.continue(),
  );
}

test("a page from before a deploy reloads into the new version", async ({ page }) => {
  await page.goto("/judge");
  await deployedSinceLoaded(page);
  await page.getByLabel("Judge code").fill("000000");
  // The page tells the server it was out of date, for the log.
  const reported = page.waitForRequest((r) => r.url().endsWith("/client-events") && r.method() === "POST");
  await page.getByRole("button", { name: "Start judging" }).click();
  expect(JSON.parse((await reported).postData() ?? "{}")).toEqual({ kind: "out_of_date", where: "/judge" });
  await expect(page.getByRole("status").filter({ hasText: "updated" })).toHaveText("LiveScoring was just updated. Reloading…");
  await page.waitForEvent("load");
  await expect(page.getByRole("status").filter({ hasText: "updated" })).toHaveCount(0);

  // Still out of date straight after (the deploy hasn't reached it): it asks rather than reloading over and over.
  await page.getByLabel("Judge code").fill("000000");
  await page.getByRole("button", { name: "Start judging" }).click();
  await expect(page.getByRole("status").filter({ hasText: "updated" })).toHaveText("LiveScoring was just updated. Reload this page to carry on.");
});
