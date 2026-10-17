import "server-only";
import { headers } from "next/headers";
import { after } from "next/server";
import { db } from "./supabase/server";

/**
 * Limits on guessing sign-ins: failures are counted per key (a network address, an account) over a window, and too
 * many refuse further tries until the oldest fall out of it. Judges at a venue often share one address, so their
 * limit is looser. Without migration 017 nothing is counted and nobody is refused: a missing table never locks
 * anyone out.
 */
const WINDOW_MS = 15 * 60_000;
/**
 * Per address, admin sign-ins allow 10 failures and judge codes 25. Per account, 50: high enough that someone guessing
 * can't easily lock an organizer (or the super admin) out of their own account.
 */
export const LIMITS = { adminAddress: 10, adminAccount: 50, judgeAddress: 25 } as const;

/**
 * The address the request came from: the platform's own header first, then the first hop of the forwarded chain.
 * Vercel overwrites both, so there they can be trusted. A server run with `next start` keeps whatever the browser
 * sent, so there the per-address limits can be dodged and only the per-account one holds.
 */
export async function clientAddress(): Promise<string> {
  const h = await headers();
  return (h.get("x-real-ip") ?? h.get("x-forwarded-for")?.split(",")[0] ?? "unknown").trim().slice(0, 64) || "unknown";
}

const since = () => new Date(Date.now() - WINDOW_MS).toISOString();

/** Whether any of these keys has reached its limit of failures within the window. */
export async function tooManyFailures(limits: [key: string, limit: number][]): Promise<boolean> {
  for (const [key, limit] of limits) {
    const { count, error } = await db().from("sign_in_failures").select("id", { count: "exact", head: true }).eq("key", key).gte("created_at", since());
    if (error) return false; // before migration 017: no limit rather than no sign-in
    if ((count ?? 0) >= limit) return true;
  }
  return false;
}

/** Count a failed try against each key; old rows are cleared as they go. */
export async function recordFailure(keys: string[]): Promise<void> {
  const { error } = await db()
    .from("sign_in_failures")
    .insert(keys.map((key) => ({ key: key.slice(0, 300) })));
  if (error) return;
  after(async () => {
    await db().from("sign_in_failures").delete().lt("created_at", new Date(Date.now() - 24 * 60 * 60_000).toISOString());
  });
}

export const TOO_MANY = "Too many tries. Wait 15 minutes, then try again.";
