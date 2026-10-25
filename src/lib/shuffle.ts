import { randomInt } from "node:crypto";

/**
 * The items in a random order, each order as likely as any other (Fisher–Yates): an event's running order drawn at
 * random. The pick is the system's secure random number generator, as access codes are, so no one can predict or steer
 * the draw. Returns a new array. `pick(n)` gives a whole number from 0 up to n, not including n; tests pass their own.
 */
export function shuffle<T>(items: readonly T[], pick: (n: number) => number = randomInt): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = pick(i + 1);
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}
