import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createRefresher, pollEvery } from "./refresh-schedule";

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(0);
});
afterEach(() => vi.useRealTimers());

/** Notifications at these times (ms); returns when each refresh ran. */
function simulate(at: number[], options: { minGapMs?: number }, until = 120_000): number[] {
  const start = Date.now();
  const runs: number[] = [];
  const refresher = createRefresher(() => runs.push(Date.now() - start), options);
  for (const t of [...at].sort((x, y) => x - y)) {
    // Time moves on to the next notification, running any refresh due before it.
    vi.advanceTimersByTime(start + t - Date.now());
    refresher.request();
  }
  vi.advanceTimersByTime(until);
  return runs;
}

describe("refreshes", () => {
  it("fold a burst of changes into one", () => {
    const runs: number[] = [];
    const refresher = createRefresher(() => runs.push(Date.now()));
    for (let i = 0; i < 10; i++) {
      refresher.request();
      vi.advanceTimersByTime(10);
    }
    vi.advanceTimersByTime(1_000);
    expect(runs).toEqual([150]);
  });

  it("on a crowded page, come at most one per gap, and still pick up the last change", () => {
    const runs: number[] = [];
    const refresher = createRefresher(() => runs.push(Date.now()), { minGapMs: 2_000 });
    // A judging burst: ten scores 400 ms apart.
    for (let i = 0; i < 10; i++) {
      refresher.request();
      vi.advanceTimersByTime(400);
    }
    vi.advanceTimersByTime(10_000);
    expect(runs).toEqual([150, 2_150, 4_150]);
    // The last score (at 3.6 s) is in the refresh at 4.15 s: nothing is left waiting.
    expect(runs.at(-1)!).toBeGreaterThan(3_600);
  });

  it("can be cancelled when the screen closes", () => {
    const run = vi.fn();
    const refresher = createRefresher(run);
    refresher.request();
    refresher.cancel();
    vi.advanceTimersByTime(1_000);
    expect(run).not.toHaveBeenCalled();
  });

  it("cut an audience phone's page renders during judging", () => {
    // One candidate: ten judges' scores over 12 seconds, in a minute with realtime up.
    const scores = Array.from({ length: 10 }, (_, i) => i * 1_200);
    const before = simulate(scores, { minGapMs: 0 }).length + 60_000 / 15_000; // every score, plus a poll every 15 s
    const after = simulate(scores, { minGapMs: 2_000 }).length + 60_000 / pollEvery(15_000, true);
    expect(before).toBe(14);
    expect(after).toBe(8);
  });
});

describe("polling", () => {
  it("is frequent while realtime is down, and a slow safety net while it's up", () => {
    expect(pollEvery(5_000, false)).toBe(5_000);
    expect(pollEvery(5_000, true)).toBe(20_000);
    expect(pollEvery(2_500, true)).toBe(15_000);
    expect(pollEvery(15_000, true)).toBe(60_000);
  });
});
