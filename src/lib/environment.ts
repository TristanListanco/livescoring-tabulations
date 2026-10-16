import "server-only";

/**
 * Where the test tools (Reset scores, deleting an activity mid-session) are offered. Never on the live site. Vercel
 * previews share the live site's database, so they're off there too unless TEST_TOOLS=on is set for a preview that
 * has a database of its own. Running locally (`vercel dev` included) and in CI, they're on.
 */
export function testToolsAllowed(): boolean {
  const env = process.env.VERCEL_ENV;
  if (env === "production") return false;
  if (env === "preview") return process.env.TEST_TOOLS === "on";
  return true;
}

/**
 * Pageant mode is still being finished: it's offered where the test tools are (locally, in CI and on a testing
 * preview) and shows "Coming soon" on the live site, where pageants can't be created or saved as drafts yet.
 */
export function pageantsAvailable(): boolean {
  return testToolsAllowed();
}
