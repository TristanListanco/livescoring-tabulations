import { describe, expect, it } from "vitest";
import { activityInUse } from "./in-use";

describe("activityInUse", () => {
  const a = (id: string, sessionState: "draft" | "live" | "deliberation" | "ended") => ({ id, name: id.toUpperCase(), sessionState });
  it("holds the account while a show runs, before judges waiting on one that hasn't started", () => {
    expect(activityInUse([a("x", "draft"), a("y", "live")], new Set(["x"]))).toEqual({ id: "y", name: "Y", running: true });
    expect(activityInUse([a("x", "deliberation")], new Set())).toEqual({ id: "x", name: "X", running: true });
    expect(activityInUse([a("x", "draft"), a("z", "ended")], new Set(["x"]))).toEqual({ id: "x", name: "X", running: false });
  });
  it("lets go once nothing is running and no judge is waiting", () => {
    expect(activityInUse([a("x", "draft"), a("z", "ended")], new Set())).toBeNull();
    // A device on an ended activity doesn't count.
    expect(activityInUse([a("z", "ended")], new Set(["z"]))).toBeNull();
  });
});
