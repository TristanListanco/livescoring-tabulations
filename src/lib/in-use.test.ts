import { describe, expect, it } from "vitest";
import { activityInUse, inUseMessage } from "./in-use";

describe("activityInUse", () => {
  const a = (id: string, sessionState: "draft" | "live" | "deliberation" | "ended") => ({ id, name: id.toUpperCase(), sessionState });
  it("holds the account while a show runs, before judges waiting on one that hasn't started", () => {
    expect(activityInUse([a("x", "draft"), a("y", "live")], new Set(["x"]))).toEqual({ id: "y", name: "Y", running: true });
    expect(activityInUse([a("x", "deliberation")], new Set())).toEqual({ id: "x", name: "X", running: true });
    expect(activityInUse([a("x", "draft"), a("z", "ended")], new Set(["x"]))).toEqual({ id: "x", name: "X", running: false });
  });
  it("lets go of a pageant paused between its segments, and says how to pause one", () => {
    const T = "2026-11-26T10:00:00Z";
    const between = { ...a("p", "live"), kind: "pageant" as const, preliminaryEndedAt: T, properStartedAt: null };
    expect(activityInUse([between], new Set())).toEqual({ id: "p", name: "P", running: true, pausable: true });
    expect(inUseMessage(activityInUse([between], new Set())!, "sign out")).toBe("P is between its preliminary and pageant proper, so you can't sign out now. Pause it on its Session tab first.");
    expect(activityInUse([{ ...between, pausedAt: T }], new Set())).toBeNull();
    // Its show isn't over, though: deleting its organizer still waits.
    expect(activityInUse([{ ...between, pausedAt: T }], new Set(), true)).toEqual({ id: "p", name: "P", running: true });
    // Judging pageant proper, it can't be paused.
    expect(activityInUse([{ ...between, properStartedAt: T }], new Set())).toEqual({ id: "p", name: "P", running: true });
  });
  it("lets go once nothing is running and no judge is waiting", () => {
    expect(activityInUse([a("x", "draft"), a("z", "ended")], new Set())).toBeNull();
    // A device on an ended activity doesn't count.
    expect(activityInUse([a("z", "ended")], new Set(["z"]))).toBeNull();
  });
});
