/**
 * When an open screen fetches the latest scores again. Realtime says when something changed; these decide how
 * often that turns into a refresh, so a screen many people watch (the public live results) doesn't multiply
 * every score into a page render per phone, and a screen judges depend on stays instant.
 */

/**
 * Turns change notifications into refreshes. A refresh runs `batchMs` after the first notification of a burst (so
 * several scores arriving together make one), and never sooner than `minGapMs` after the last refresh. Notifications
 * in between are folded into the next one; none is dropped.
 */
export function createRefresher(run: () => void, { batchMs = 150, minGapMs = 0 }: { batchMs?: number; minGapMs?: number } = {}) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let last = Number.NEGATIVE_INFINITY;
  return {
    request() {
      if (timer !== undefined) return;
      const wait = Math.max(batchMs, last + minGapMs - Date.now());
      timer = setTimeout(() => {
        timer = undefined;
        last = Date.now();
        run();
      }, wait);
    },
    cancel() {
      clearTimeout(timer);
      timer = undefined;
    },
  };
}

/** While checks keep failing, the gap between them doubles, up to this. */
export const MAX_BACKOFF_MS = 30_000;
/** Checks that found nothing new before the gaps start to stretch (see idleMaxMs). */
const IDLE_AFTER = 2;

/**
 * How long a live page waits before it next checks whether its activity changed (before the jitter). With realtime
 * connected the check is only a safety net for a notice that never came, so it's rare (`liveCheckMs`). Without it,
 * every `pollMs`; further apart while checks fail; and, with `idleMaxMs` (the audience's phones), further apart while
 * nothing changes, between entries say, up to `idleMaxMs`, and back to `pollMs` at the first change. Every check is a
 * request to the database, and each request adds to its logs.
 */
export function checkInterval({
  pollMs,
  liveCheckMs,
  idleMaxMs = 0,
  subscribed,
  failures,
  unchanged,
}: {
  pollMs: number;
  liveCheckMs: number;
  idleMaxMs?: number;
  subscribed: boolean;
  /** Checks in a row that couldn't reach the server. */
  failures: number;
  /** Checks in a row that found no change. */
  unchanged: number;
}): number {
  if (subscribed) return Math.max(pollMs, liveCheckMs);
  if (failures > 0) return Math.min(pollMs * 2 ** failures, Math.max(pollMs, MAX_BACKOFF_MS));
  if (idleMaxMs > pollMs && unchanged > IDLE_AFTER) return Math.min(idleMaxMs, pollMs * 1.5 ** (unchanged - IDLE_AFTER));
  return pollMs;
}
