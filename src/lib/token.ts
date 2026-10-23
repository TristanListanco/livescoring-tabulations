import "server-only";
import { createHash, createHmac, timingSafeEqual } from "node:crypto";

export const ADMIN_COOKIE = "ls_admin";
export const JUDGE_COOKIE = "ls_judge";

/**
 * sub: "super", an organizer's id, or a judge's id. pv: the password version (the organizer's, or the super admin's).
 * dev: the judge's device. sid: an admin session's row in admin_sessions, which signing out deletes.
 * role "tally": an admin's unlock of one activity's private tally (act), for that admin session (sid) alone.
 */
export type SessionPayload = { role: "admin" | "judge" | "tally"; sub: string; pv?: string; dev?: string; sid?: string; act?: string; exp: number };

/**
 * The secrets tokens are checked with: SESSION_SECRET, which signs every new one, and while it's being rotated the one
 * before it (SESSION_SECRET_PREVIOUS), so changing the secret doesn't sign every admin and judge out mid-event. Keep the
 * previous one until the longest session it signed has run out (a judge's: 3 days), then remove it.
 */
function secrets(): string[] {
  const current = process.env.SESSION_SECRET;
  if (!current || current.length < 32) throw new Error("SESSION_SECRET must be set to at least 32 characters.");
  const previous = process.env.SESSION_SECRET_PREVIOUS;
  return previous && previous.length >= 32 && previous !== current ? [current, previous] : [current];
}

function mac(body: string, key = secrets()[0]): Buffer {
  return createHmac("sha256", key).update(body).digest();
}

/** A tamper-proof token: base64url(payload).base64url(hmac), signed with SESSION_SECRET. */
export function signToken(payload: SessionPayload): string {
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${body}.${mac(body).toString("base64url")}`;
}

export function verifyToken(token: string | undefined, role: SessionPayload["role"]): SessionPayload | null {
  if (!token) return null;
  const [body, signature] = token.split(".");
  if (!body || !signature) return null;

  const given = Buffer.from(signature, "base64url");
  const signed = secrets().some((key) => {
    const expected = mac(body, key);
    return given.length === expected.length && timingSafeEqual(given, expected);
  });
  if (!signed) return null;

  try {
    const payload = JSON.parse(Buffer.from(body, "base64url").toString()) as SessionPayload;
    if (payload.role !== role || typeof payload.exp !== "number" || payload.exp < Date.now()) return null;
    return payload;
  } catch {
    return null;
  }
}

/**
 * A short fingerprint of a secret, keyed with SESSION_SECRET: it changes when the secret does, and a session can carry
 * it without giving away anything to guess the secret from.
 */
export function fingerprint(value: string): string {
  return mac(`fingerprint:${value}`).toString("base64url").slice(0, 16);
}

/** The fingerprints a session may carry for a secret: under SESSION_SECRET, and under the previous one while it rotates. */
export function fingerprints(value: string): string[] {
  return secrets().map((key) => mac(`fingerprint:${value}`, key).toString("base64url").slice(0, 16));
}

/** Constant-time comparison that does not leak the password length. */
export function safeEqual(a: string, b: string): boolean {
  const ha = createHash("sha256").update(a).digest();
  const hb = createHash("sha256").update(b).digest();
  return timingSafeEqual(ha, hb);
}
