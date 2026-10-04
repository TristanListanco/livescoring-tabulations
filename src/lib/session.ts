import "server-only";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { ADMIN_COOKIE, JUDGE_COOKIE, safeEqual, signToken, verifyToken } from "./token";

const ADMIN_TTL_S = 60 * 60 * 12;
const JUDGE_TTL_S = 60 * 60 * 24 * 3;

/**
 * Secure only when the request really arrived over HTTPS. A production server on the venue
 * Wi-Fi is plain http://192.168.x.x, where browsers silently drop Secure cookies.
 */
async function cookieOptions(maxAge: number) {
  const proto = (await headers()).get("x-forwarded-proto")?.split(",")[0]?.trim();
  return { httpOnly: true, sameSite: "lax" as const, secure: proto === "https", path: "/", maxAge };
}

export function checkAdminPassword(input: string): boolean {
  const password = process.env.ADMIN_PASSWORD;
  if (!password) throw new Error("ADMIN_PASSWORD is not set.");
  return safeEqual(input, password);
}

export async function startAdminSession() {
  const token = signToken({ role: "admin", sub: "admin", exp: Date.now() + ADMIN_TTL_S * 1000 });
  (await cookies()).set(ADMIN_COOKIE, token, await cookieOptions(ADMIN_TTL_S));
}

export async function endAdminSession() {
  (await cookies()).delete(ADMIN_COOKIE);
}

export async function isAdmin(): Promise<boolean> {
  return verifyToken((await cookies()).get(ADMIN_COOKIE)?.value, "admin") !== null;
}

/** Call at the top of every admin page and action. Rendering a page is not a security boundary on its own. */
export async function requireAdmin() {
  if (!(await isAdmin())) redirect("/admin/login");
}

export async function startJudgeSession(judgeId: string) {
  const token = signToken({ role: "judge", sub: judgeId, exp: Date.now() + JUDGE_TTL_S * 1000 });
  (await cookies()).set(JUDGE_COOKIE, token, await cookieOptions(JUDGE_TTL_S));
}

export async function endJudgeSession() {
  (await cookies()).delete(JUDGE_COOKIE);
}

export async function sessionJudgeId(): Promise<string | null> {
  return verifyToken((await cookies()).get(JUDGE_COOKIE)?.value, "judge")?.sub ?? null;
}
