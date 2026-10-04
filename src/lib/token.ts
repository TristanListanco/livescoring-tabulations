import "server-only";
import { createHash, createHmac, timingSafeEqual } from "node:crypto";

export const ADMIN_COOKIE = "ls_admin";
export const JUDGE_COOKIE = "ls_judge";

/** sub: "super", an organizer's id, or a judge's id. pv: the organizer's password version. dev: the judge's device. */
export type SessionPayload = { role: "admin" | "judge"; sub: string; pv?: string; dev?: string; exp: number };

function secret(): string {
  const value = process.env.SESSION_SECRET;
  if (!value || value.length < 32) throw new Error("SESSION_SECRET must be set to at least 32 characters.");
  return value;
}

function mac(body: string): Buffer {
  return createHmac("sha256", secret()).update(body).digest();
}

/** A tamper-proof token: base64url(payload).base64url(hmac). */
export function signToken(payload: SessionPayload): string {
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${body}.${mac(body).toString("base64url")}`;
}

export function verifyToken(token: string | undefined, role: SessionPayload["role"]): SessionPayload | null {
  if (!token) return null;
  const [body, signature] = token.split(".");
  if (!body || !signature) return null;

  const given = Buffer.from(signature, "base64url");
  const expected = mac(body);
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;

  try {
    const payload = JSON.parse(Buffer.from(body, "base64url").toString()) as SessionPayload;
    if (payload.role !== role || typeof payload.exp !== "number" || payload.exp < Date.now()) return null;
    return payload;
  } catch {
    return null;
  }
}

/** Constant-time comparison that does not leak the password length. */
export function safeEqual(a: string, b: string): boolean {
  const ha = createHash("sha256").update(a).digest();
  const hb = createHash("sha256").update(b).digest();
  return timingSafeEqual(ha, hb);
}
