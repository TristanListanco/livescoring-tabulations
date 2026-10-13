/**
 * When an open screen fetches the latest scores again. Realtime says when something changed; these decide how
 * often that turns into a refresh, so a screen many people watch (the public live results) doesn't multiply
 * every score into a page render per phone, and a screen judges depend on stays instant.
 */

/** The safety net while realtime is up: rarely, since realtime brings the changes, but never less than this often. */
const LIVE_POLL_MIN_MS = 15_000;
const LIVE_POLL_MAX_MS = 60_000;

/**
 * How often a screen checks on its own: every `pollMs` while realtime is down (polling is then all it has), and four
 * times less often (15 to 60 seconds) while realtime is up, to catch anything it missed.
 */
export function pollEvery(pollMs: number, realtimeUp: boolean): number {
  return realtimeUp ? Math.min(LIVE_POLL_MAX_MS, Math.max(LIVE_POLL_MIN_MS, pollMs * 4)) : pollMs;
}

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
