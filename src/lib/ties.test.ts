import { describe, expect, it } from "vitest";
import { rankEntries } from "./scoring";
import { activityFixture } from "./test-fixtures";
import { applyTieBreaks, breakFor, ordinal, tieKey, tiesIn, unbrokenTies } from "./ties";
import type { TieBreak } from "./types";

const rules = activityFixture();
const judges = [
  { id: "j1", name: "A", photoUrl: null, position: 0, firstName: null, lastName: null, isChair: true, panel: "all" as const },
  { id: "j2", name: "B", photoUrl: null, position: 1, firstName: null, lastName: null, isChair: false, panel: "all" as const },
];
const entries = ["One", "Two", "Three", "Four", "Five"].map((name, position) => ({ id: `e${position + 1}`, name, photoUrl: null, position }));
// Two and Three tie for 1st (9.00); Four and Five tie for 3rd (8.00); One is 5th.
const scores = [
  ["e1", 7, 7],
  ["e2", 9, 9],
  ["e3", 8.5, 9.5],
  ["e4", 8, 8],
  ["e5", 7.5, 8.5],
].flatMap(([entryId, a, b]) => [
  { entryId: entryId as string, judgeId: "j1", value: a as number },
  { entryId: entryId as string, judgeId: "j2", value: b as number },
]);
const rows = rankEntries(entries, judges, scores, rules);
const broke = (entryIds: string[], reason = "Stronger finish."): TieBreak => ({ tieKey: tieKey(entryIds), entryIds, reason, judgeId: "j1", createdAt: "2026-10-22T00:00:00Z" });

describe("ties", () => {
  it("finds every tie in the ranking, highest place first", () => {
    expect(tiesIn(rows)).toEqual([
      { rank: 1, key: "e2,e3", entryIds: ["e2", "e3"] },
      { rank: 3, key: "e4,e5", entryIds: ["e4", "e5"] },
    ]);
  });

  it("knows a tie by its entries, in any order", () => {
    expect(tieKey(["e3", "e2"])).toBe(tieKey(["e2", "e3"]));
    expect(breakFor({ key: "e2,e3" }, [broke(["e3", "e2"])])?.entryIds).toEqual(["e3", "e2"]);
  });

  it("leaves the ties nobody has broken", () => {
    expect(unbrokenTies(rows, [broke(["e3", "e2"])]).map((t) => t.rank)).toEqual([3]);
    expect(unbrokenTies(rows, [broke(["e3", "e2"]), broke(["e5", "e4"])])).toEqual([]);
  });

  it("puts a broken tie in the chair's order, each with its own place", () => {
    const ranked = applyTieBreaks(rows, [broke(["e3", "e2"]), broke(["e5", "e4"])]);
    expect(ranked.map((r) => [r.entry.id, r.rank])).toEqual([
      ["e3", 1],
      ["e2", 2],
      ["e5", 3],
      ["e4", 4],
      ["e1", 5],
    ]);
    // The ranking passed in stays as it was.
    expect(rows.map((r) => r.rank)).toEqual([1, 1, 3, 3, 5]);
  });

  it("keeps an unbroken tie sharing its rank", () => {
    expect(applyTieBreaks(rows, [broke(["e3", "e2"])]).map((r) => r.rank)).toEqual([1, 2, 3, 3, 5]);
  });

  it("drops a break once its entries aren't tied any more", () => {
    // A corrected score leaves Two alone at the top: the old break for Two and Three no longer applies.
    const corrected = rankEntries(
      entries,
      judges,
      scores.map((s) => (s.entryId === "e2" && s.judgeId === "j1" ? { ...s, value: 10 } : s)),
      rules,
    );
    expect(applyTieBreaks(corrected, [broke(["e3", "e2"])]).slice(0, 2).map((r) => [r.entry.id, r.rank])).toEqual([
      ["e2", 1],
      ["e3", 2],
    ]);
  });

  it("names places", () => {
    expect([1, 2, 3, 4, 11, 12, 13, 21, 22, 23].map(ordinal)).toEqual(["1st", "2nd", "3rd", "4th", "11th", "12th", "13th", "21st", "22nd", "23rd"]);
  });
});
