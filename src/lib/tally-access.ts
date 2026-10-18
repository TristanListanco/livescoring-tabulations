import "server-only";
import { cookies } from "next/headers";
import { adminSessionId, cookieOptions, type AdminSession } from "./session";
import { signToken, verifyToken } from "./token";

/**
 * The private tally (an event's scores before the judges have signed, for the organizer to fall back on if judging
 * fails) opens only with the admin's password, entered on that page, for this browser alone and for a short while.
 * The unlock is a signed cookie naming the activity, the admin and their admin session; it's sent only to the tally's
 * own address, never to another site (SameSite strict), and ends with the session: signing out, a new password, or
 * TALLY_UNLOCK_S. A link to the tally shows nothing to anyone else, who would need the account and its password.
 */
const TALLY_COOKIE = "ls_tally";
export const TALLY_UNLOCK_S = 10 * 60;

export const tallyPath = (activityId: string) => `/admin/${activityId}/tally`;
const subject = (session: AdminSession) => (session.kind === "super" ? "super" : session.admin.id);

export async function unlockTally(session: AdminSession, activityId: string): Promise<void> {
  const sid = await adminSessionId();
  const exp = Date.now() + TALLY_UNLOCK_S * 1000;
  const token = signToken({ role: "tally", sub: subject(session), act: activityId, exp, ...(sid ? { sid } : {}) });
  (await cookies()).set(TALLY_COOKIE, token, { ...(await cookieOptions(TALLY_UNLOCK_S)), sameSite: "strict", path: tallyPath(activityId) });
}

/** When this browser's unlock of the activity's tally ends (ms), or null when it's locked. */
export async function tallyUnlockedUntil(session: AdminSession, activityId: string): Promise<number | null> {
  const payload = verifyToken((await cookies()).get(TALLY_COOKIE)?.value, "tally");
  if (!payload || payload.act !== activityId || payload.sub !== subject(session)) return null;
  // Only in the admin session it was unlocked in: a copied cookie, or one from before signing in again, opens nothing.
  if ((payload.sid ?? null) !== (await adminSessionId())) return null;
  return payload.exp;
}
