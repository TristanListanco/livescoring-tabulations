import "server-only";

/** The live site on Vercel. Developer tools (resetting scores) are hidden and refused there. */
export function isProductionSite(): boolean {
  return process.env.VERCEL_ENV === "production";
}
