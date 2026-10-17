/**
 * One JSON object per line, so the host's logs (Vercel's, or wherever they're drained) can be searched and counted by
 * field: every failed score save, the slowest actions, the error rate per action, p95 and p99 of `ms`. Never a
 * password, judge code, session cookie or query string (which can carry a code); names and ids are fine.
 */
export type LogFields = Record<string, string | number | boolean | null | undefined>;

export function log(level: "info" | "warn" | "error", event: string, fields: LogFields = {}): void {
  const line = JSON.stringify({ level, event, ...fields });
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);
}

/** An error's message, whatever was thrown. */
export const messageOf = (error: unknown): string => (error instanceof Error ? error.message : typeof error === "string" ? error : JSON.stringify(error) ?? String(error));
