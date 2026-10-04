import { describe, expect, it } from "vitest";
import { reportId } from "./report";
import { activityFixture } from "./test-fixtures";
import type { Board } from "./types";

const board: Board = {
  activity: activityFixture({ id: "a1" }),
  judges: [
    { id: "j1", name: "Ana", photoUrl: null, position: 0, firstName: null, lastName: null, isChair: false },
    { id: "j2", name: "Ben", photoUrl: null, position: 1, firstName: null, lastName: null, isChair: false },
  ],
  entries: [{ id: "e1", name: "Agila", photoUrl: null, position: 0 }],
  scores: [
    { entryId: "e1", judgeId: "j1", value: 9.5 },
    { entryId: "e1", judgeId: "j2", value: 8.75 },
  ],
};

describe("reportId", () => {
  it("has the LS-XXXX-XXXX-XXXX shape", () => {
    expect(reportId(board)).toMatch(/^LS-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}$/);
  });

  it("is the same for the same results, whatever the order they were loaded in", () => {
    const shuffled = { ...board, judges: [...board.judges].reverse(), scores: [...board.scores].reverse() };
    expect(reportId(shuffled)).toBe(reportId(board));
  });

  it("changes when the results' decimal places change, since they decide ties", () => {
    const places = { ...board, activity: { ...board.activity, resultDecimals: 3 as const } };
    expect(reportId(places)).not.toBe(reportId(board));
  });

  it("changes when any score changes", () => {
    const changed = { ...board, scores: [board.scores[0], { ...board.scores[1], value: 8.5 }] };
    expect(reportId(changed)).not.toBe(reportId(board));
  });
});
