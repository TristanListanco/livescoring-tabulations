import type { Judge } from "./types";

/** Longest first or last name. Together they fit the 120-character full name. */
export const MAX_NAME_PART = 59;

/**
 * Whether a first or last name is made of letters: any alphabet, with accents (José, Ñora), plus the spaces,
 * hyphens, apostrophes and periods real names carry ("Ma. Cristina", "Dela Cruz", "O'Neil", "Jean-Luc").
 * Digits and other symbols are refused. It has to start with a letter.
 */
export function isPersonName(value: string): boolean {
  return /^\p{L}[\p{L}\p{M} .'’-]*$/u.test(value.trim());
}

/** What's wrong with a name part, for the form, or null when it's fine (blank is left to `required`). */
export function personNameProblem(value: string, part: "first" | "last"): string | null {
  if (value.trim() === "" || isPersonName(value)) return null;
  return `Use letters only for the ${part} name. Spaces, hyphens, apostrophes and periods are fine.`;
}

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
 * What the LED wall and the live results call each judge: their first name. Judges who share a first name
 * also get their last initial ("Maria S."), and judges saved before names were split show their full name.
 */
export function firstNames(judges: Pick<Judge, "id" | "name" | "firstName" | "lastName">[]): Map<string, string> {
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
