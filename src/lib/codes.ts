import "server-only";
import { randomInt } from "node:crypto";

// No 0/O, 1/I/L: codes get read aloud and typed on tablets.
const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const ID_ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789";

function random(alphabet: string, length: number): string {
  let out = "";
  for (let i = 0; i < length; i++) out += alphabet[randomInt(alphabet.length)];
  return out;
}

export const newAccessCode = () => random(CODE_ALPHABET, 6);
export const newPublicId = () => random(ID_ALPHABET, 10);
export const newFileTag = () => random(ID_ALPHABET, 8);

export function normalizeCode(input: string): string {
  return input.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (value: string) => UUID.test(value);
