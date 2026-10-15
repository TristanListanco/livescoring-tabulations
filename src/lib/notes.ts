/** The longest note a judge can keep on one entry. */
export const MAX_NOTE = 2000;

/** A judge's note as typed: line breaks kept, control characters dropped, trimmed and cut to MAX_NOTE. Empty means no note. */
export function cleanNote(value: unknown): string {
  return String(value ?? "")
    .replace(/\r\n?/g, "\n")
    .replace(/[\u0000-\u0008\u000B-\u001F\u007F]/g, "")
    .trim()
    .slice(0, MAX_NOTE)
    .trim();
}
