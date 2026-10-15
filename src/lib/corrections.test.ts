import { describe, expect, it } from "vitest";
import { cleanReason, correctionOutcome, correctionView, correctionVoters, MAX_CORRECTION_REASON, type Correction } from "./corrections";
import { activityFixture, roundFixture } from "./test-fixtures";
import type { Board, Judge, JudgePanel } from "./types";

const judge = (id: string, panel: JudgePanel = "all"): Judge => ({ id, name: id.toUpperCase(), photoUrl: null, position: 0, firstName: null, lastName: null, isChair: false, panel });
const entries = [
  { id: "e2", name: "Bea", photoUrl: null, position: 1 },
  { id: "e1", name: "Ayla", photoUrl: null, position: 0 },
];
const correction = (over: Partial<Correction> = {}): Correction => ({
  id: "c",
  judgeId: "ana",
  entryId: "e2",
  roundId: null,
  oldValue: 7.5,
  newValue: 8.5,
  oldBreakdown: null,
  newBreakdown: null,
  reason: "Typed 7.5 instead of 8.5",
  status: "open",
  decidedBy: null,
  createdAt: "",
  decidedAt: null,
  votes: [],
  ...over,
});

describe("correctionVoters", () => {
  it("is every other judge in an event", () => {
    const board: Board = { activity: activityFixture(), judges: [judge("ana"), judge("ben"), judge("cara")], entries, scores: [], rounds: [] };
    expect(correctionVoters(board, correction()).map((j) => j.id)).toEqual(["ben", "cara"]);
  });

  it("is the rest of the board that judges the score's sub-activity, with separate boards", () => {
    const swim = roundFixture({ id: "swim", segment: "proper" });
    const board: Board = {
      activity: activityFixture({ kind: "pageant" }),
      judges: [judge("ana", "proper"), judge("dina", "preliminary"), judge("ben", "proper"), judge("eve", "all")],
      entries,
      scores: [],
      rounds: [swim],
    };
    expect(correctionVoters(board, correction({ roundId: "swim" })).map((j) => j.id)).toEqual(["ben", "eve"]);
  });
});

describe("correctionOutcome", () => {
  const voters = [judge("ben"), judge("cara")];
  it("waits until every other judge has agreed", () => {
    expect(correctionOutcome(voters, [])).toBe("open");
    expect(correctionOutcome(voters, [{ judgeId: "ben", agree: true }])).toBe("open");
    expect(correctionOutcome(voters, [{ judgeId: "ben", agree: true }, { judgeId: "cara", agree: true }])).toBe("approved");
  });

  it("is turned down as soon as one judge disagrees", () => {
    expect(correctionOutcome(voters, [{ judgeId: "cara", agree: false }])).toBe("rejected");
    expect(correctionOutcome(voters, [{ judgeId: "ben", agree: true }, { judgeId: "cara", agree: false }])).toBe("rejected");
  });

  it("only counts the judges who vote, and leaves a judge alone on their panel to the organizer", () => {
    expect(correctionOutcome(voters, [{ judgeId: "ben", agree: true }, { judgeId: "zed", agree: true }])).toBe("open");
    expect(correctionOutcome(voters, [{ judgeId: "zed", agree: false }])).toBe("open");
    expect(correctionOutcome([], [])).toBe("open");
  });
});

describe("correctionView", () => {
  it("shows a criteria score before and after, marking the criteria that changed", () => {
    const activity = activityFixture({
      scoringMode: "criteria",
      decimals: 1,
      criteria: [
        { id: "poise", name: "Poise", max: 40 },
        { id: "wit", name: "Wit", max: 60 },
      ],
    });
    const board: Board = { activity, judges: [judge("ana"), judge("ben")], entries, scores: [], rounds: [] };
    const view = correctionView(
      board,
      correction({ oldValue: 75, newValue: 84, oldBreakdown: { poise: 30, wit: 45 }, newBreakdown: { poise: 39, wit: 45 }, votes: [{ judgeId: "ben", agree: true }] }),
    );
    expect(view).toMatchObject({ judgeName: "ANA", entryName: "Bea", entryNumber: 2, from: "75.0 / 100", to: "84.0 / 100", agreed: 1, voters: 1 });
    expect(view.criteria).toEqual([
      { name: "Poise (40)", from: "30.0", to: "39.0", changed: true },
      { name: "Wit (60)", from: "45.0", to: "45.0", changed: false },
    ]);
  });
});

describe("cleanReason", () => {
  it("keeps one trimmed paragraph, cut to the limit", () => {
    expect(cleanReason("  Typed 59\n instead of 95  ")).toBe("Typed 59 instead of 95");
    expect(cleanReason("x".repeat(MAX_CORRECTION_REASON + 5))).toHaveLength(MAX_CORRECTION_REASON);
    expect(cleanReason(undefined)).toBe("");
  });
});
