import "server-only";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { after } from "next/server";
import { cache } from "react";
import { isUuid } from "./codes";
import { getAdminCredentials } from "./data";
import { deviceLabel } from "./device-label";
import { passwordVersion } from "./password";
import { db } from "./supabase/server";
import { ADMIN_COOKIE, fingerprint, fingerprints, JUDGE_COOKIE, safeEqual, signToken, verifyToken } from "./token";
import type { AdminAccount } from "./types";

const ADMIN_TTL_S = 60 * 60 * 12;
const JUDGE_TTL_S = 60 * 60 * 24 * 3;

/** The super admin (the developer, signed in with ADMIN_PASSWORD) or an organizer account. */
export type AdminSession = { kind: "super" } | { kind: "organizer"; admin: AdminAccount };

/**
 * Who may open and manage an activity: its organizer, or the super admin for activities no organizer owns.
 * Organizers' activities are private to them; the super admin only sees their names.
 */
export function canManageActivity(session: AdminSession | null, ownerId: string | null): boolean {
  if (!session) return false;
  return session.kind === "super" ? ownerId === null : ownerId === session.admin.id;
}

/**
 * Secure only when the request really arrived over HTTPS. A production server on the venue
 * Wi-Fi is plain http://192.168.x.x, where browsers silently drop Secure cookies.
 */
export async function cookieOptions(maxAge: number) {
  const proto = (await headers()).get("x-forwarded-proto")?.split(",")[0]?.trim();
  return { httpOnly: true, sameSite: "lax" as const, secure: proto === "https", path: "/", maxAge };
}

export function checkSuperAdminPassword(input: string): boolean {
  const password = process.env.ADMIN_PASSWORD;
  if (!password) throw new Error("ADMIN_PASSWORD is not set.");
  return safeEqual(input, password);
}

/** The super admin's password version: it changes with ADMIN_PASSWORD, so changing that signs the super admin out everywhere. */
function superPasswordVersion(): string | null {
  const password = process.env.ADMIN_PASSWORD;
  return password ? fingerprint(password) : null;
}

/**
 * A row in admin_sessions for a new sign-in (adminId null: the super admin), labelled with the browser it's in. Its id
 * goes in the session cookie, so signing out (deleting the row) ends the session wherever the cookie is. Undefined
 * before migration 022: the session is then signed as before, and lasts until it expires.
 */
async function openAdminSession(adminId: string | null, exp: number): Promise<string | undefined> {
  const label = deviceLabel((await headers()).get("user-agent")).slice(0, 80);
  const { data, error } = await db()
    .from("admin_sessions")
    .insert({ admin_id: adminId, label, expires_at: new Date(exp).toISOString() })
    .select("id")
    .single();
  if (error) return undefined;
  // Sessions that have run out go as new ones start, once this sign-in's response has been sent.
  after(async () => {
    await db().from("admin_sessions").delete().lt("expires_at", new Date().toISOString());
  });
  return (data as { id: string }).id;
}

export async function startSuperAdminSession() {
  const pv = superPasswordVersion();
  if (!pv) throw new Error("ADMIN_PASSWORD is not set.");
  const exp = Date.now() + ADMIN_TTL_S * 1000;
  const sid = await openAdminSession(null, exp);
  const token = signToken({ role: "admin", sub: "super", pv, exp, ...(sid ? { sid } : {}) });
  (await cookies()).set(ADMIN_COOKIE, token, await cookieOptions(ADMIN_TTL_S));
}

export async function startOrganizerSession(adminId: string, passwordHash: string) {
  const exp = Date.now() + ADMIN_TTL_S * 1000;
  const sid = await openAdminSession(adminId, exp);
  const token = signToken({ role: "admin", sub: adminId, pv: passwordVersion(passwordHash), exp, ...(sid ? { sid } : {}) });
  (await cookies()).set(ADMIN_COOKIE, token, await cookieOptions(ADMIN_TTL_S));
}

/** Signing out: the session's row goes, so a copy of the cookie stops working too, and then the cookie. */
export async function endAdminSession() {
  const payload = verifyToken((await cookies()).get(ADMIN_COOKIE)?.value, "admin");
  if (payload?.sid && isUuid(payload.sid)) await db().from("admin_sessions").delete().eq("id", payload.sid);
  (await cookies()).delete(ADMIN_COOKIE);
}

/**
 * Whether the admin session a cookie names is still open: its row is there, for the same admin, and hasn't run out.
 * A cookie from before migration 022 has no row to check: it counts only where there's no table to keep rows in yet,
 * so once the migration runs, sessions from before it end. Before migration 022, every session counts.
 */
async function sessionStillOpen(payload: { sub: string; sid?: string }): Promise<boolean> {
  if (!payload.sid) {
    const { error } = await db().from("admin_sessions").select("id", { head: true, count: "exact" }).limit(1);
    return !!error;
  }
  if (!isUuid(payload.sid)) return false;
  const { data, error } = await db().from("admin_sessions").select("admin_id, expires_at").eq("id", payload.sid).maybeSingle();
  if (error) return true;
  const row = data as { admin_id: string | null; expires_at: string } | null;
  return !!row && row.admin_id === (payload.sub === "super" ? null : payload.sub) && Date.parse(row.expires_at) > Date.now();
}

/** The id of this browser's admin session (its row in admin_sessions), or null. */
export async function adminSessionId(): Promise<string | null> {
  return verifyToken((await cookies()).get(ADMIN_COOKIE)?.value, "admin")?.sid ?? null;
}

/**
 * Who is signed in to the admin panel, or null. A session ends when it's signed out (its row in admin_sessions goes,
 * wherever the cookie is), when an organizer's account is deleted or their password changes, and when ADMIN_PASSWORD
 * changes for the super admin. The session and the account are read at once, so checking costs no extra wait.
 */
export const currentAdmin = cache(async (): Promise<AdminSession | null> => {
  const payload = verifyToken((await cookies()).get(ADMIN_COOKIE)?.value, "admin");
  if (!payload) return null;
  if (payload.sub === "super") {
    // The password version as signed under SESSION_SECRET, or the previous secret while it's being rotated.
    const password = process.env.ADMIN_PASSWORD;
    if (!password || !payload.pv || !fingerprints(password).includes(payload.pv)) return null;
    return (await sessionStillOpen(payload)) ? { kind: "super" } : null;
  }
  const [open, account] = await Promise.all([sessionStillOpen(payload), getAdminCredentials(payload.sub)]);
  if (!open || !account || passwordVersion(account.passwordHash) !== payload.pv) return null;
  return { kind: "organizer", admin: account.admin };
});

/** A browser signed in to an admin's account: what it is, when it signed in, and whether it's this one. */
export type AdminSessionInfo = { id: string; label: string; createdAt: string; current: boolean };

/** The browsers signed in to this admin's account, newest first; null before migration 022. */
export async function listAdminSessions(session: AdminSession): Promise<AdminSessionInfo[] | null> {
  const payload = verifyToken((await cookies()).get(ADMIN_COOKIE)?.value, "admin");
  const query = db().from("admin_sessions").select("id, label, created_at").gt("expires_at", new Date().toISOString());
  const { data, error } = await (session.kind === "super" ? query.is("admin_id", null) : query.eq("admin_id", session.admin.id)).order("created_at", {
    ascending: false,
  });
  if (error) return null;
  return (data as { id: string; label: string; created_at: string }[]).map((r) => ({
    id: r.id,
    label: r.label || "Unknown device",
    createdAt: r.created_at,
    current: r.id === payload?.sid,
  }));
}

/**
 * Sign this admin's account out of other browsers: one (`sessionId`), or every one but this. Only ever their own
 * account's sessions.
 */
export async function endOtherAdminSessions(session: AdminSession, sessionId?: string): Promise<boolean> {
  const payload = verifyToken((await cookies()).get(ADMIN_COOKIE)?.value, "admin");
  let query = db().from("admin_sessions").delete();
  query = session.kind === "super" ? query.is("admin_id", null) : query.eq("admin_id", session.admin.id);
  if (sessionId !== undefined) {
    if (!isUuid(sessionId)) return false;
    query = query.eq("id", sessionId);
  }
  if (payload?.sid) query = query.neq("id", payload.sid);
  const { error } = await query;
  return !error;
}

/** Call at the top of every admin page and action. Rendering a page is not a security boundary on its own. */
export async function requireAdmin(): Promise<AdminSession> {
  const session = await currentAdmin();
  if (!session) redirect("/admin/login");
  return session;
}

/** Managing organizer accounts is for the super admin only. */
export async function requireSuperAdmin(): Promise<AdminSession> {
  const session = await requireAdmin();
  if (session.kind !== "super") redirect("/admin");
  return session;
}

/** Signs this browser in as a judge's device. The device still needs the organizer's approval to score. */
export async function startJudgeSession(judgeId: string, deviceId: string) {
  const token = signToken({ role: "judge", sub: judgeId, dev: deviceId, exp: Date.now() + JUDGE_TTL_S * 1000 });
  (await cookies()).set(JUDGE_COOKIE, token, await cookieOptions(JUDGE_TTL_S));
}

export async function endJudgeSession() {
  (await cookies()).delete(JUDGE_COOKIE);
}

/** The judge and device this browser signed in as, if any. */
export async function judgeSession(): Promise<{ judgeId: string; deviceId: string | null } | null> {
  const payload = verifyToken((await cookies()).get(JUDGE_COOKIE)?.value, "judge");
  return payload ? { judgeId: payload.sub, deviceId: payload.dev ?? null } : null;
}
