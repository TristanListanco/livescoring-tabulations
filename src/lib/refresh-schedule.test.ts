import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { checkInterval, createRefresher } from "./refresh-schedule";

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
    // One candidate: ten judges' scores over 12 seconds, each one a change the phone's checks find.
    const scores = Array.from({ length: 10 }, (_, i) => i * 1_200);
    expect(simulate(scores, { minGapMs: 0 })).toHaveLength(10);
    expect(simulate(scores, { minGapMs: 2_000 })).toHaveLength(7);
  });
});

describe("checkInterval", () => {
  const base = { pollMs: 4_000, liveCheckMs: 20_000, subscribed: false, failures: 0, unchanged: 0 };

  it("checks every pollMs while realtime isn't connected", () => {
    expect(checkInterval(base)).toBe(4_000);
    expect(checkInterval({ ...base, unchanged: 10 })).toBe(4_000);
  });

  it("only checks now and then while realtime hears every change", () => {
    expect(checkInterval({ ...base, subscribed: true })).toBe(20_000);
    // Never more often than the page asked for.
    expect(checkInterval({ ...base, pollMs: 30_000, subscribed: true })).toBe(30_000);
  });

  it("backs off while checks fail, up to 30 seconds", () => {
    expect(checkInterval({ ...base, failures: 1 })).toBe(8_000);
    expect(checkInterval({ ...base, failures: 2 })).toBe(16_000);
    expect(checkInterval({ ...base, failures: 5 })).toBe(30_000);
  });

  it("stretches the checks while nothing changes, and only up to idleMaxMs", () => {
    const idle = { ...base, idleMaxMs: 12_000 };
    expect(checkInterval({ ...idle, unchanged: 2 })).toBe(4_000);
    expect(checkInterval({ ...idle, unchanged: 3 })).toBe(6_000);
    expect(checkInterval({ ...idle, unchanged: 4 })).toBe(9_000);
    expect(checkInterval({ ...idle, unchanged: 5 })).toBe(12_000);
    expect(checkInterval({ ...idle, unchanged: 50 })).toBe(12_000);
    // A change puts it back to every pollMs.
    expect(checkInterval({ ...idle, unchanged: 0 })).toBe(4_000);
  });
});
