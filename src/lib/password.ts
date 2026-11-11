import { createHash, randomBytes, scrypt as scryptCb, timingSafeEqual, type ScryptOptions } from "node:crypto";

const scrypt = (password: string, salt: Buffer, keylen: number, options: ScryptOptions) =>
  new Promise<Buffer>((resolve, reject) => scryptCb(password, salt, keylen, options, (err, key) => (err ? reject(err) : resolve(key))));

const N = 16384;
const R = 8;
const P = 1;
const KEYLEN = 64;

export { MIN_PASSWORD_LENGTH } from "./password-rules";

/**
 * Hashing a password is slow on purpose (scrypt, 16 MB) and runs on Node's small shared pool of worker threads, which
 * also looks up the database's address for every request. At most two at a time, so a burst of sign-in attempts waits
 * its turn instead of holding up judges' scores. A finished check hands its place straight to the next one waiting.
 */
const MAX_HASHING = 2;
let hashing = 0;
const waiting: (() => void)[] = [];
export async function oneOfFew<T>(work: () => Promise<T>): Promise<T> {
  if (hashing < MAX_HASHING) hashing++;
  else await new Promise<void>((take) => waiting.push(take));
  try {
    return await work();
  } finally {
    const next = waiting.shift();
    if (next) next();
    else hashing--;
  }
}

/** scrypt with a random salt, stored as `scrypt$N$r$p$salt$hash` (base64url). */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await oneOfFew(() => scrypt(password, salt, KEYLEN, { N, r: R, p: P }));
  return ["scrypt", N, R, P, salt.toString("base64url"), key.toString("base64url")].join("$");
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [scheme, n, r, p, saltText, hashText] = stored.split("$");
  if (scheme !== "scrypt" || !saltText || !hashText) return false;
  const expected = Buffer.from(hashText, "base64url");
  const key = await oneOfFew(() => scrypt(password, Buffer.from(saltText, "base64url"), expected.length, { N: Number(n), r: Number(r), p: Number(p) }));
  return key.length === expected.length && timingSafeEqual(key, expected);
}

/** A short fingerprint of the stored hash. Sessions carry it, so changing a password signs out other devices. */
export function passwordVersion(stored: string): string {
  return createHash("sha256").update(stored).digest("base64url").slice(0, 10);
}
