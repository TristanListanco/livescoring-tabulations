import { describe, expect, it } from "vitest";
import { ledScene, wallBoard } from "./led";
import { scoreText } from "./scoring";
import { activityFixture, roundFixture } from "./test-fixtures";
import type { Board } from "./types";

function board(options: { hold: boolean; onAir: string | null; scores: [string, string, number][]; anonymous?: boolean }): Board {
  return {
    activity: activityFixture({ ledEntryId: options.onAir, ledHoldScores: options.hold, ledAnonymous: options.anonymous ?? false }),
    judges: [
      { id: "j1", name: "Ana", photoUrl: null, position: 0, firstName: null, lastName: null, isChair: false, panel: "all" as const },
      { id: "j2", name: "Ben", photoUrl: null, position: 1, firstName: null, lastName: null, isChair: false, panel: "all" as const },
    ],
    entries: [
      { id: "e1", name: "Agila", photoUrl: null, position: 0 },
      { id: "e2", name: "Bagwis", photoUrl: null, position: 1 },
    ],
    scores: options.scores.map(([entryId, judgeId, value]) => ({ entryId, judgeId, value })),
    rounds: [],
  };
}

describe("ledScene", () => {
  it("names judges by first name, or not at all when they're kept anonymous", () => {
    const named = ledScene(board({ hold: false, onAir: "e1", scores: [["e1", "j1", 9]] }));
    const anonymous = ledScene(board({ hold: false, onAir: "e1", scores: [["e1", "j1", 9]], anonymous: true }));
    if (named.kind !== "entry" || anonymous.kind !== "entry") throw new Error("expected an entry");
    expect(named.tiles.map((t) => t.label)).toEqual(["Ana", "Ben"]);
    expect(anonymous.tiles.map((t) => t.label)).toEqual([null, null]);
    // Scores and the average are unaffected.
    expect(anonymous.tiles.map((t) => [t.state, t.value])).toEqual([
      ["shown", 9],
      ["waiting", null],
    ]);
  });

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
    expect(scene.average).toMatchObject({ state: "running", value: 9.5, count: 1, total: 2 });
  });

  it("holds scores back until every judge has scored", () => {
    const partial = ledScene(board({ hold: true, onAir: "e1", scores: [["e1", "j1", 9.5]] }));
    if (partial.kind !== "entry") throw new Error("expected an entry");
    expect(partial.tiles.map((t) => [t.state, t.value])).toEqual([
      ["submitted", null],
      ["waiting", null],
    ]);
    expect(partial.average).toMatchObject({ state: "hidden", value: null });

    const complete = ledScene(
      board({
        hold: true,
        onAir: "e1",
        scores: [
          ["e1", "j1", 9.5],
          ["e1", "j2", 9],
        ],
      }),
    );
    if (complete.kind !== "entry") throw new Error("expected an entry");
    expect(complete.tiles.every((t) => t.state === "shown")).toBe(true);
    expect(complete.average).toMatchObject({ state: "final", value: 9.25 });
  });

  it("has no average before the first score", () => {
    const scene = ledScene(board({ hold: false, onAir: "e1", scores: [] }));
    if (scene.kind !== "entry") throw new Error("expected an entry");
    expect(scene.average.state).toBe("none");
  });
});

describe("a pageant sub-activity that deliberates", () => {
  // Its board as the wall gets it (see showingBoard): not live until it's signed off.
  const held = (b: Board, marks?: Board["scored"]): Board => ({ ...b, activity: { ...b.activity, liveScoring: false }, ...(marks ? { scored: marks } : {}) });

  it("shows only that each judge has scored, from the marks the public board carries", () => {
    const scene = ledScene(held(board({ hold: false, onAir: "e1", scores: [] }), [{ entryId: "e1", judgeId: "j1", roundId: "r" }]));
    if (scene.kind !== "entry") throw new Error("expected an entry");
    expect(scene.tiles.map((t) => [t.state, t.value])).toEqual([
      ["submitted", null],
      ["waiting", null],
    ]);
    expect(scene.average).toEqual({ state: "hidden", value: null, count: 1, total: 2 });
  });

  it("holds the scores back in the organizer's preview too, which has them", () => {
    const scene = ledScene(held(board({ hold: false, onAir: "e1", scores: [["e1", "j1", 9], ["e1", "j2", 8]] })));
    if (scene.kind !== "entry") throw new Error("expected an entry");
    expect(scene.tiles.map((t) => t.state)).toEqual(["submitted", "submitted"]);
    expect(scene.average.state).toBe("hidden");
    expect(scene.average.value).toBeNull();
  });
});

describe("a pageant sub-activity shown out of 10 on the wall", () => {
  // Evening Gown, by criteria out of 100 shown as percentages; Ana gave 87.5, Ben 90.
  const gown = (ledOutOfTen: boolean) =>
    roundFixture({ id: "gown", segment: "proper", name: "Evening Gown", scoringMode: "criteria", min: 0, max: 100, criteria: [{ id: "c1", name: "Poise", max: 100, min: 0 }], ledOutOfTen });
  const pageant = (ledOutOfTen: boolean): Board => {
    const b = board({ hold: false, onAir: "e1", scores: [] });
    return {
      ...b,
      activity: { ...b.activity, kind: "pageant", currentRoundId: "gown", currentEntryId: "e1" },
      rounds: [gown(ledOutOfTen)],
      scores: [
        { entryId: "e1", judgeId: "j1", value: 87.5, roundId: "gown" },
        { entryId: "e1", judgeId: "j2", value: 90, roundId: "gown" },
      ],
    };
  };

  it("shows each score and the average out of 10", () => {
    const { board: wall } = wallBoard(pageant(true));
    const scene = ledScene(wall);
    if (scene.kind !== "entry") throw new Error("expected an entry");
    expect(scene.tiles.map((t) => scoreText(t.value!, wall.activity))).toEqual(["8.75", "9.00"]);
    expect(scene.average.value).toBe(8.88);
  });

  it("keeps the percentages when it isn't asked for, and everywhere off the wall", () => {
    const { board: wall } = wallBoard(pageant(false));
    const scene = ledScene(wall);
    if (scene.kind !== "entry") throw new Error("expected an entry");
    expect(scene.tiles.map((t) => scoreText(t.value!, wall.activity))).toEqual(["87.50%", "90.00%"]);
    expect(scene.average.value).toBe(88.75);
  });
});
