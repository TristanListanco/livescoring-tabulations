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
