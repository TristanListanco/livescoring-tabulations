import { describe, expect, it } from "vitest";
import { cleanSignature, deliberationGap, deliberationResults, MAX_SIGNATURE_LENGTH, unsignedJudges } from "./deliberation";
import { withheldScores } from "./scoring";
import { tieKey } from "./ties";
import { activityFixture } from "./test-fixtures";
import type { Board, Judge, JudgeSignature } from "./types";

const judge = (id: string): Judge => ({ id, name: id.toUpperCase(), photoUrl: null, position: 0, firstName: null, lastName: null, isChair: false, panel: "all" });
const board = (over: Partial<Board["activity"]> = {}, scored = 4): Board => {
  const judges = [judge("ana"), judge("ben")];
  const entries = [
    { id: "e1", name: "Agila", photoUrl: null, position: 0 },
    { id: "e2", name: "Bagwis", photoUrl: null, position: 1 },
  ];
  const all = judges.flatMap((j) => entries.map((e) => ({ entryId: e.id, judgeId: j.id, value: 9 })));
  return { activity: activityFixture({ liveScoring: false, sessionState: "live", ...over }), judges, entries, scores: all.slice(0, scored), rounds: [] };
};
const signature = (judgeId: string): JudgeSignature => ({ judgeId, method: "checked", drawing: null, signedAt: "" });

describe("deliberationGap", () => {
  it("opens once every judge has scored every entry of an event without live scoring", () => {
    expect(deliberationGap(board())).toBeNull();
  });
  it("waits for the last score", () => {
    expect(deliberationGap(board({}, 3))).toBe("Every judge scores every entry before the deliberation.");
  });
  it("is only for events without live scoring", () => {
    expect(deliberationGap(board({ liveScoring: true }))).toMatch(/without live scoring/);
    expect(deliberationGap(board({ kind: "pageant" }))).toMatch(/without live scoring/);
  });
  it("needs the session running", () => {
    expect(deliberationGap(board({ sessionState: "deliberation" }))).toBe("The session isn't running.");
    expect(deliberationGap(board({ sessionState: "ended" }))).toBe("The session isn't running.");
  });
});

describe("unsignedJudges", () => {
  it("lists who hasn't signed, in board order", () => {
    const judges = [judge("ana"), judge("ben"), judge("cara")];
    expect(unsignedJudges(judges, [signature("ben")]).map((j) => j.id)).toEqual(["ana", "cara"]);
    expect(unsignedJudges(judges, judges.map((j) => signature(j.id)))).toEqual([]);
  });
});

describe("cleanSignature", () => {
  const stroke = "M10 150L20 140L30 130L40 120L50 115L60 118L70 125L80 130";
  it("keeps a drawn signature", () => {
    expect(cleanSignature(stroke)).toBe(stroke);
    expect(cleanSignature(`${stroke}M100 100L110 110`)).toBe(`${stroke}M100 100L110 110`);
  });
  it("refuses a tap, or too little drawn", () => {
    expect(cleanSignature("M10 10")).toBeNull();
    expect(cleanSignature("M10 10L11 11L12 12")).toBeNull();
  });
  it("refuses anything that isn't moves and lines between whole-number points", () => {
    expect(cleanSignature(`${stroke}Z`)).toBeNull();
    expect(cleanSignature(`${stroke}L1.5 2`)).toBeNull();
    expect(cleanSignature(`L10 10${stroke}`)).toBeNull();
    expect(cleanSignature(`<script>${stroke}`)).toBeNull();
    expect(cleanSignature(null)).toBeNull();
  });
  it("refuses points outside the box", () => {
    expect(cleanSignature(`${stroke}L601 10`)).toBeNull();
    expect(cleanSignature(`${stroke}L10 201`)).toBeNull();
  });
  it("refuses one that's too long", () => {
    expect(cleanSignature(`M1 1${"L599 199".repeat(MAX_SIGNATURE_LENGTH / 8)}`)).toBeNull();
  });
});

describe("withheldScores", () => {
  it("keeps who has scored what, without the scores", () => {
    const held = withheldScores(board());
    expect(held.scores).toEqual([]);
    expect(held.scored).toEqual([
      { entryId: "e1", judgeId: "ana", roundId: null },
      { entryId: "e2", judgeId: "ana", roundId: null },
      { entryId: "e1", judgeId: "ben", roundId: null },
      { entryId: "e2", judgeId: "ben", roundId: null },
    ]);
  });
});

describe("deliberationResults", () => {
  // Every score is 9: Agila and Bagwis are tied for 1st.
  const deliberating = (tieBreaks: Board["tieBreaks"] = []): Board => ({ ...board({ sessionState: "deliberation" }), tieBreaks });
  const both = [signature("ana"), signature("ben")];
  const broken = [{ tieKey: tieKey(["e1", "e2"]), entryIds: ["e2", "e1"], reason: "Stronger finish", judgeId: "ben", createdAt: "" }];

  it("sends the ties, which entries are level and for what place, but no results until every judge has signed", () => {
    const results = deliberationResults(deliberating(broken), [signature("ana")]);
    expect(results.ties).toHaveLength(1);
    expect(results.ties[0]).toMatchObject({ rank: 1, key: tieKey(["e1", "e2"]) });
    expect([...results.ties[0].entryIds].sort()).toEqual(["e1", "e2"]);
    expect(results.ranking).toBeNull();
  });

  it("waits for every tie to be broken too", () => {
    expect(deliberationResults(deliberating(), both).ranking).toBeNull();
  });

  it("then sends the signed results, in the chair's order, with each entry's average but no judge's score", () => {
    const ranking = deliberationResults(deliberating(broken), both).ranking;
    expect(ranking?.map((row) => [row.entry.id, row.rank, row.average])).toEqual([
      ["e2", 1, 9],
      ["e1", 2, 9],
    ]);
    expect(ranking?.every((row) => row.scores.size === 0)).toBe(true);
  });
});
