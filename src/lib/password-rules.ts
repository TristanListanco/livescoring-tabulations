/** Shared by the server (validation) and the browser (form hints). */
export const MIN_PASSWORD_LENGTH = 8;
export const MAX_PASSWORD_LENGTH = 200;

/** What an organizer password needs, in the order the form lists them. */
export const PASSWORD_RULES = [
  { id: "length", label: `At least ${MIN_PASSWORD_LENGTH} characters`, test: (p: string) => p.length >= MIN_PASSWORD_LENGTH },
  { id: "number", label: "A number", test: (p: string) => /\d/.test(p) },
  // Anything that isn't a letter, a digit or whitespace: "!", "-", "#", "_" and the like.
  { id: "special", label: "A special character, such as ! # - or _", test: (p: string) => /[^\p{L}\p{N}\s]/u.test(p) },
] as const;

/** Why a new password isn't allowed, as one sentence, or null when it meets every rule. */
export function passwordProblem(password: string): string | null {
  if (password.length > MAX_PASSWORD_LENGTH) return "That password is too long.";
  const missing = PASSWORD_RULES.filter((r) => !r.test(password));
  if (missing.length === 0) return null;
  const parts = missing.map((r) => (r.id === "length" ? `at least ${MIN_PASSWORD_LENGTH} characters` : r.id === "number" ? "a number" : "a special character"));
  const list = parts.length === 1 ? parts[0] : `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
  return `Passwords need ${list}.`;
}
