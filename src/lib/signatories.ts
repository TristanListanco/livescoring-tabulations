import type { Signatory } from "./types";

/** As many signature lines as fit under the results. */
export const MAX_SIGNATORIES = 12;

/**
 * An activity's signatories as sent (from Settings or a create form), tidied: spaces collapsed, each part capped at 120
 * characters, empty rows dropped. A row with a designation but no name, or more rows than fit, is refused, with why.
 */
export function cleanSignatories(input: unknown): Signatory[] | { error: string } {
  const tidy = (v: unknown) => String(v ?? "").replace(/\s+/g, " ").trim().slice(0, 120);
  const clean = (Array.isArray(input) ? input : [])
    .map((s) => ({ name: tidy(s?.name), designation: tidy(s?.designation) }))
    .filter((s) => s.name || s.designation);
  if (clean.some((s) => !s.name)) return { error: "Every signatory needs a name." };
  if (clean.length > MAX_SIGNATORIES) return { error: `Up to ${MAX_SIGNATORIES} signatories fit on the sheet.` };
  return clean;
}
