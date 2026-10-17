/**
 * What a screen tells the server went wrong on it, for the log (see the client-events route): failures that happen in
 * the browser never reach the server otherwise, so the error rate judges and the desk actually see would stay unknown.
 */
export const PROBLEM_KINDS = [
  // A judge's score didn't reach the server (the request itself failed).
  "score_unreachable",
  // Any other action didn't reach the server: a desk control, a form.
  "action_unreachable",
  // The page was older than the deployed version and reloaded (see RequestGuard).
  "out_of_date",
  // Realtime couldn't connect, so the screen checks for changes on a timer instead.
  "realtime_down",
  // A screen failed and showed its error page.
  "screen_error",
] as const;
export type ProblemKind = (typeof PROBLEM_KINDS)[number];

/** Best effort: sent in the background (so it survives the page reloading), and dropped if it can't go. */
export function reportProblem(kind: ProblemKind, digest?: string): void {
  try {
    navigator.sendBeacon("/client-events", JSON.stringify({ kind, where: location.pathname, digest }));
  } catch {
    // Nothing to do: the screen already shows the problem.
  }
}
