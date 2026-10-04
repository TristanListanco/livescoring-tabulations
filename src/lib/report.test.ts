import { describe, expect, it } from "vitest";
import { reportId } from "./report";
import type { Board } from "./types";

const board: Board = {
  activity: {
    id: "a1",
    name: "Finals",
    publicId: "p",
    min: 1,
    max: 10,
    decimals: 2,
    showRank: true,
    ledEntryId: null,
    ledFullscreen: false,
    ledHoldScores: false,
    ownerId: null,
    createdAt: "",
  },
  judges: [
    { id: "j1", name: "Ana", photoUrl: null, position: 0 },
    { id: "j2", name: "Ben", photoUrl: null, position: 1 },
  ],
  entries: [{ id: "e1", name: "Agila", position: 0 }],
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

  it("changes when any score changes", () => {
    const changed = { ...board, scores: [board.scores[0], { ...board.scores[1], value: 8.5 }] };
    expect(reportId(changed)).not.toBe(reportId(board));
  });
});
