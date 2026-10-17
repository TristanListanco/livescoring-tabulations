import "server-only";

/**
 * Where the test tools (Reset scores, deleting an activity mid-session) are offered. They can wipe an event's scores,
 * so never where a real event runs: not on the live site, and not in any production build unless TEST_TOOLS=on says
 * it's a test one. That includes the production build on an organizer's laptop at the venue, which uses the live
 * database (`npm start`). Vercel previews need TEST_TOOLS=on too, set only for a preview with a database of its own.
 * The dev server has them; CI's production build sets TEST_TOOLS=on.
 */
export function testToolsAllowed(): boolean {
  if (process.env.VERCEL_ENV === "production") return false;
  if (process.env.TEST_TOOLS === "on") return true;
  return process.env.NODE_ENV !== "production" && process.env.VERCEL_ENV !== "preview";
}

/**
 * Pageant mode is still being finished: it's offered where the test tools are (locally, in CI and on a testing
 * preview) and shows "Coming soon" on the live site, where pageants can't be created or saved as drafts yet.
 */
export function pageantsAvailable(): boolean {
  return testToolsAllowed();
}
