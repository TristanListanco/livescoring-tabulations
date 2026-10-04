import { describe, expect, it } from "vitest";
import { ledScene } from "./led";
import { activityFixture } from "./test-fixtures";
import type { Board } from "./types";

function board(options: { hold: boolean; onAir: string | null; scores: [string, string, number][] }): Board {
  return {
    activity: activityFixture({ ledEntryId: options.onAir, ledHoldScores: options.hold }),
    judges: [
      { id: "j1", name: "Ana", photoUrl: null, position: 0 },
      { id: "j2", name: "Ben", photoUrl: null, position: 1 },
    ],
    entries: [
      { id: "e1", name: "Agila", position: 0 },
      { id: "e2", name: "Bagwis", position: 1 },
    ],
    scores: options.scores.map(([entryId, judgeId, value]) => ({ entryId, judgeId, value })),
  };
}

describe("ledScene", () => {
  it("is empty when nothing is on air", () => {
    expect(ledScene(board({ hold: false, onAir: null, scores: [] }))).toEqual({ kind: "empty" });
  });

  it("shows scores as they arrive with a running average", () => {
    const scene = ledScene(board({ hold: false, onAir: "e2", scores: [["e2", "j1", 9.5]] }));
    if (scene.kind !== "entry") throw new Error("expected an entry");
    expect(scene.number).toBe(2);
    expect(scene.tiles.map((t) => [t.state, t.value])).toEqual([
      ["shown", 9.5],
      ["waiting", null],
    ]);
    expect(scene.average).toMatchObject({ state: "running", hundredths: 950, count: 1, total: 2 });
  });

  it("holds scores back until every judge has scored", () => {
    const partial = ledScene(board({ hold: true, onAir: "e1", scores: [["e1", "j1", 9.5]] }));
    if (partial.kind !== "entry") throw new Error("expected an entry");
    expect(partial.tiles.map((t) => [t.state, t.value])).toEqual([
      ["submitted", null],
      ["waiting", null],
    ]);
    expect(partial.average).toMatchObject({ state: "hidden", hundredths: null });

    const complete = ledScene(board({ hold: true, onAir: "e1", scores: [["e1", "j1", 9.5], ["e1", "j2", 9]] }));
    if (complete.kind !== "entry") throw new Error("expected an entry");
    expect(complete.tiles.every((t) => t.state === "shown")).toBe(true);
    expect(complete.average).toMatchObject({ state: "final", hundredths: 925 });
  });

  it("has no average before the first score", () => {
    const scene = ledScene(board({ hold: false, onAir: "e1", scores: [] }));
    if (scene.kind !== "entry") throw new Error("expected an entry");
    expect(scene.average.state).toBe("none");
  });
});
