import "server-only";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";
import { getAdminCredentials } from "./data";
import { passwordVersion } from "./password";
import { ADMIN_COOKIE, JUDGE_COOKIE, safeEqual, signToken, verifyToken } from "./token";
import type { AdminAccount } from "./types";

const ADMIN_TTL_S = 60 * 60 * 12;
const JUDGE_TTL_S = 60 * 60 * 24 * 3;

/** The super admin (the developer, signed in with ADMIN_PASSWORD) or an organizer account. */
export type AdminSession = { kind: "super" } | { kind: "organizer"; admin: AdminAccount };

/**
 * Secure only when the request really arrived over HTTPS. A production server on the venue
 * Wi-Fi is plain http://192.168.x.x, where browsers silently drop Secure cookies.
 */
async function cookieOptions(maxAge: number) {
  const proto = (await headers()).get("x-forwarded-proto")?.split(",")[0]?.trim();
  return { httpOnly: true, sameSite: "lax" as const, secure: proto === "https", path: "/", maxAge };
}

export function checkSuperAdminPassword(input: string): boolean {
  const password = process.env.ADMIN_PASSWORD;
  if (!password) throw new Error("ADMIN_PASSWORD is not set.");
  return safeEqual(input, password);
}

export async function startSuperAdminSession() {
  const token = signToken({ role: "admin", sub: "super", exp: Date.now() + ADMIN_TTL_S * 1000 });
  (await cookies()).set(ADMIN_COOKIE, token, await cookieOptions(ADMIN_TTL_S));
}

export async function startOrganizerSession(adminId: string, passwordHash: string) {
  const token = signToken({ role: "admin", sub: adminId, pv: passwordVersion(passwordHash), exp: Date.now() + ADMIN_TTL_S * 1000 });
  (await cookies()).set(ADMIN_COOKIE, token, await cookieOptions(ADMIN_TTL_S));
}

export async function endAdminSession() {
  (await cookies()).delete(ADMIN_COOKIE);
}

/**
 * Who is signed in to the admin panel, or null. An organizer session ends as soon as the account
 * is deleted or its password changes.
 */
export const currentAdmin = cache(async (): Promise<AdminSession | null> => {
  const payload = verifyToken((await cookies()).get(ADMIN_COOKIE)?.value, "admin");
  if (!payload) return null;
  if (payload.sub === "super") return { kind: "super" };
  const account = await getAdminCredentials(payload.sub);
  if (!account || passwordVersion(account.passwordHash) !== payload.pv) return null;
  return { kind: "organizer", admin: account.admin };
});

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
