import { afterEach, describe, expect, it, vi } from "vitest";
import { timeoutSignal } from "./timeout-signal";

afterEach(() => vi.useRealTimers());

describe("timeoutSignal", () => {
  it("aborts with a TimeoutError once the time is up", () => {
    vi.useFakeTimers();
    const signal = timeoutSignal(1_000);
    vi.advanceTimersByTime(999);
    expect(signal.aborted).toBe(false);
    vi.advanceTimersByTime(1);
    expect(signal.aborted).toBe(true);
    expect((signal.reason as DOMException).name).toBe("TimeoutError");
  });

  it("aborts with the other signal, for its reason", () => {
    const other = new AbortController();
    const signal = timeoutSignal(60_000, other.signal);
    other.abort(new DOMException("Superseded", "AbortError"));
    expect(signal.aborted).toBe(true);
    expect((signal.reason as DOMException).name).toBe("AbortError");
  });

  it("starts aborted when the other signal already is", () => {
    const other = new AbortController();
    other.abort();
    expect(timeoutSignal(60_000, other.signal).aborted).toBe(true);
  });
});
