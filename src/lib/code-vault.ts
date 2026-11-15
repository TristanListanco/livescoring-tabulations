import "server-only";
import { createCipheriv, createDecipheriv, createHmac, hkdfSync, randomBytes } from "node:crypto";

/**
 * Judges' access codes at rest (migration 044). A code lets a device ask to judge, so the database keeps none in the
 * clear: `code_lookup` is a keyed hash of it (HMAC-SHA256), to find the judge it was typed for, and `code_sealed` the
 * code itself, encrypted (AES-256-GCM, bound to its judge), so the Judges tab and QR codes can still show it. Both keys
 * come from DATA_KEY, a secret of at least 32 characters kept with the app, never in the database: a copy of the
 * database alone (a leaked backup, say) holds no usable code.
 *
 * Without DATA_KEY the codes are kept as before (`code`, in the clear), so a deployment that hasn't set it yet works
 * unchanged. Codes kept in the clear are sealed as they're next read (see getActivityAccessCodes).
 *
 * DATA_KEY can't change once codes are sealed with it: they couldn't be found or shown. The Preview environment and
 * .env.local share the testing database, so they share a DATA_KEY too.
 */

const MIN_KEY_LENGTH = 32;
const VERSION = "v1";

function keys(): { lookup: Buffer; seal: Buffer } | null {
  const secret = process.env.DATA_KEY;
  if (!secret || secret.length < MIN_KEY_LENGTH) return null;
  const derive = (info: string) => Buffer.from(hkdfSync("sha256", secret, "tabulous", info, 32));
  return { lookup: derive("judge code lookup"), seal: derive("judge code seal") };
}

/** Whether codes are sealed here: DATA_KEY is set. */
export const vaultReady = () => keys() !== null;

/** The keyed hash a normalized code is found by, or null without DATA_KEY. */
export function codeLookup(code: string): string | null {
  const k = keys();
  return k ? createHmac("sha256", k.lookup).update(code).digest("hex") : null;
}

/** A normalized code, encrypted for its judge (whose id it's bound to), or null without DATA_KEY. */
export function sealCode(code: string, judgeId: string): string | null {
  const k = keys();
  if (!k) return null;
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", k.seal, iv).setAAD(Buffer.from(judgeId));
  const sealed = Buffer.concat([cipher.update(code, "utf8"), cipher.final()]);
  return [VERSION, iv.toString("base64url"), sealed.toString("base64url"), cipher.getAuthTag().toString("base64url")].join(".");
}

/** The code a judge's sealed code holds, or null when it can't be opened (no DATA_KEY, another key, or tampered with). */
export function openCode(sealed: string, judgeId: string): string | null {
  const k = keys();
  const [version, iv, data, tag] = sealed.split(".");
  if (!k || version !== VERSION || !iv || !data || !tag) return null;
  try {
    const decipher = createDecipheriv("aes-256-gcm", k.seal, Buffer.from(iv, "base64url")).setAAD(Buffer.from(judgeId));
    decipher.setAuthTag(Buffer.from(tag, "base64url"));
    return Buffer.concat([decipher.update(Buffer.from(data, "base64url")), decipher.final()]).toString("utf8");
  } catch {
    return null;
  }
}
