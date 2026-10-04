import type { Judge } from "./types";

/** Longest first or last name. Together they fit the 120-character full name. */
export const MAX_NAME_PART = 59;

/** "Maria" and "Santos" → "Maria Santos": the full name on the results PDF and in the admin panel. */
export function fullName(first: string, last: string): string {
  return `${first} ${last}`.replace(/\s+/g, " ").trim();
}

/**
 * A judge's first and last name for editing. Judges saved before names were split only have a full name:
 * its last word becomes the last name.
 */
export function nameParts(judge: Pick<Judge, "name" | "firstName" | "lastName">): { first: string; last: string } {
  if (judge.firstName) return { first: judge.firstName, last: judge.lastName ?? "" };
  const words = judge.name.trim().split(/\s+/);
  return words.length > 1 ? { first: words.slice(0, -1).join(" "), last: words[words.length - 1] } : { first: words[0] ?? "", last: "" };
}

/**
 * What the LED wall calls each judge: their first name. Judges who share a first name also get their last
 * initial ("Maria S."), and judges saved before names were split show their full name.
 */
export function ledNames(judges: Pick<Judge, "id" | "name" | "firstName" | "lastName">[]): Map<string, string> {
  const key = (first: string) => first.trim().toLowerCase();
  const count = new Map<string, number>();
  for (const j of judges) if (j.firstName) count.set(key(j.firstName), (count.get(key(j.firstName)) ?? 0) + 1);
  return new Map(
    judges.map((j) => {
      if (!j.firstName) return [j.id, j.name];
      const shared = (count.get(key(j.firstName)) ?? 0) > 1;
      return [j.id, shared && j.lastName ? `${j.firstName} ${j.lastName.trim()[0]}.` : j.firstName];
    }),
  );
}
