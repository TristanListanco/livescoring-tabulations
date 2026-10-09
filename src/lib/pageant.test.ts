import { describe, expect, it } from "vitest";
import {
  basisWeights,
  clock,
  cutPlan,
  cutResult,
  judgingOrder,
  partWeights,
  programOrder,
  roundLabel,
  roundPool,
  roundProgress,
  showingBoard,
  standings,
  standingsBy,
  timerPhase,
  warningSeconds,
} from "./pageant";
import { activityFixture, roundFixture } from "./test-fixtures";
import { PRELIMINARY, type Board, type Round, type Score } from "./types";

const entry = (id: string, position: number) => ({ id, name: id, photoUrl: null, position });
const judge = (id: string) => ({ id, name: id, firstName: id, lastName: "X", photoUrl: null, position: 0, isChair: false });

const interview = roundFixture({ id: "interview", segment: "preliminary", position: 0, weight: 60 });
const costume = roundFixture({ id: "costume", segment: "preliminary", position: 1, weight: 40 });
const swim = roundFixture({ id: "swim", segment: "proper", position: 2, weight: 50, cutSize: 3, cutBasis: [PRELIMINARY, "swim"] });
const qa = roundFixture({ id: "qa", segment: "proper", position: 3, weight: 50, min: 0, max: 100, decimals: 0, cutSize: 2, cutBasis: ["qa"] });

/** Both judges give the same score, so a candidate's average is that score. */
function both(roundId: string, scores: Record<string, number>): Score[] {
  return Object.entries(scores).flatMap(([entryId, value]) => ["j1", "j2"].map((judgeId) => ({ entryId, judgeId, value, roundId })));
}

function pageant(rounds: Round[], scores: Score[], currentRoundId: string | null = null): Board {
  return {
    activity: activityFixture({ kind: "pageant", preliminaryWeight: 30, currentRoundId, currentEntryId: "A" }),
    judges: [judge("j1"), judge("j2")],
    entries: ["A", "B", "C", "D", "E"].map(entry),
    scores,
    rounds,
  };
}

const prelimAndSwim = [
  ...both("interview", { A: 9, B: 8, C: 10, D: 7, E: 9 }),
  ...both("costume", { A: 8, B: 8, C: 8, D: 8, E: 8 }),
  ...both("swim", { A: 9, B: 7, C: 9, D: 6, E: 8 }),
];

describe("pageant weights", () => {
  it("keeps the preliminary's share when it's counted with pageant proper", () => {
    const weights = basisWeights([interview, costume, swim, qa], 30, [PRELIMINARY, "swim"]);
    expect(weights.map((w) => [w.round.id, w.weight])).toEqual([
      ["interview", 18],
      ["costume", 12],
      ["swim", 70],
    ]);
  });

  it("gives the whole 100 to whichever side is counted alone", () => {
    expect(basisWeights([interview, costume, swim, qa], 30, [PRELIMINARY]).map((w) => w.weight)).toEqual([60, 40]);
    expect(basisWeights([interview, costume, swim, qa], 30, ["swim", "qa"]).map((w) => w.weight)).toEqual([50, 50]);
  });
});

describe("pageant flow", () => {
  it("judges everyone until a cut, then only those who went through, keeping their numbers", () => {
    const board = pageant([interview, costume, swim, qa], []);
    expect(roundPool(board, "swim").entries.map((e) => e.id)).toEqual(["A", "B", "C", "D", "E"]);
    // The Top 3 isn't confirmed yet, so Q&A can't start.
    expect(roundPool(board, "qa").blockedBy?.id).toBe("swim");

    const confirmed = pageant([interview, costume, { ...swim, cutEntryIds: ["C", "A", "E"] }, qa], []);
    const pool = roundPool(confirmed, "qa");
    expect(pool.blockedBy).toBeNull();
    expect(pool.entries.map((e) => [e.id, e.number])).toEqual([
      ["A", 1],
      ["C", 3],
      ["E", 5],
    ]);
  });

  it("shows judges and screens the sub-activity being judged, with its own rules and scores", () => {
    const board = pageant([interview, costume, { ...swim, cutEntryIds: ["C", "A", "E"] }, qa], [...prelimAndSwim, ...both("qa", { A: 90 })], "qa");
    const { board: showing, round } = showingBoard(board);
    expect(round?.id).toBe("qa");
    expect(showing.activity).toMatchObject({ min: 0, max: 100, decimals: 0 });
    expect(showing.entries.map((e) => e.id)).toEqual(["A", "C", "E"]);
    expect(showing.scores.every((s) => s.roundId === "qa")).toBe(true);

    const between = showingBoard(pageant([interview], [], null));
    expect(between.round).toBeNull();
    expect(between.board.entries).toEqual([]);
  });

  it("tracks each sub-activity's progress", () => {
    const board = pageant([interview, costume, swim, qa], prelimAndSwim);
    expect(roundProgress(board, interview)).toMatchObject({ submitted: 10, possible: 10, complete: true });
    expect(roundProgress(board, qa)).toMatchObject({ submitted: 0, possible: 10, complete: false });
  });
});

describe("cuts", () => {
  it("ranks the cut by its basis, as weighted percentages", () => {
    const board = pageant([interview, costume, swim, qa], prelimAndSwim);
    const { rows, complete } = standings(board, roundPool(board, "swim").entries, swim.cutBasis);
    expect(complete).toBe(true);
    expect(rows.map((r) => [r.entry.id, r.total, r.rank])).toEqual([
      ["C", 90.6, 1],
      ["A", 88.8, 2],
      ["E", 81.8, 3],
      ["B", 73, 4],
      ["D", 64.2, 5],
    ]);
    expect(rows[0].parts.get("interview")).toBe(100);

    const plan = cutPlan(board, swim);
    expect(plan).toMatchObject({ size: 3, final: false, ready: true, ties: [] });
    expect(cutResult(plan, [])).toEqual({ ok: true, entryIds: ["C", "A", "E"] });
  });

  it("waits for every score before the cut can be confirmed", () => {
    const board = pageant([interview, costume, swim, qa], prelimAndSwim.slice(0, -1));
    const plan = cutPlan(board, swim);
    expect(plan.ready).toBe(false);
    expect(cutResult(plan, []).ok).toBe(false);
  });

  it("asks the organizer to choose who goes through a tie on the line", () => {
    const only = roundFixture({ id: "only", segment: "proper", cutSize: 2, cutBasis: ["only"] });
    const later = roundFixture({ id: "later", segment: "proper", position: 1, cutSize: 1, cutBasis: ["later"] });
    const board = pageant([interview, only, later], both("only", { A: 9, B: 9, C: 9, D: 5, E: 4 }));
    const plan = cutPlan(board, only);
    expect(plan.ties).toHaveLength(1);
    expect(plan.ties[0]).toMatchObject({ places: 2, onTheLine: true });
    expect(plan.ties[0].rows.map((r) => r.entry.id)).toEqual(["A", "B", "C"]);

    expect(cutResult(plan, [["C", "A"]])).toEqual({ ok: true, entryIds: ["C", "A"] });
    expect(cutResult(plan, [["C"]])).toEqual({ ok: false, error: "Choose 2 of the 3 tied candidates to go through." });
    expect(cutResult(plan, [["C", "D"]]).ok).toBe(false);
  });

  it("in the final cut, asks the organizer to order a tie for a placement", () => {
    const final = roundFixture({ id: "final", segment: "proper", cutSize: 3, cutBasis: ["final"] });
    const board = pageant([interview, final], both("final", { A: 9, B: 9, C: 8, D: 5, E: 4 }));
    const plan = cutPlan(board, final);
    expect(plan.final).toBe(true);
    expect(plan.ties).toHaveLength(1);
    expect(plan.ties[0]).toMatchObject({ places: 2, onTheLine: false });
    expect(cutResult(plan, [["B", "A"]])).toEqual({ ok: true, entryIds: ["B", "A", "C"] });
    expect(cutResult(plan, [["B"]])).toEqual({ ok: false, error: "Put the 2 tied candidates in order." });
  });
});

describe("scoring timer", () => {
  const closesAt = new Date(60_000).toISOString();

  it("is green, then yellow for the last seconds, then red", () => {
    expect(timerPhase(closesAt, 0, 60)).toEqual({ phase: "open", secondsLeft: 60 });
    expect(timerPhase(closesAt, 50_000, 60)).toEqual({ phase: "closing", secondsLeft: 10 });
    expect(timerPhase(closesAt, 59_500, 60)).toEqual({ phase: "closing", secondsLeft: 1 });
    expect(timerPhase(closesAt, 60_000, 60)).toEqual({ phase: "closed", secondsLeft: 0 });
  });

  it("warns for the last 10 seconds, or the last third of a short timer", () => {
    expect(warningSeconds(60)).toBe(10);
    expect(warningSeconds(15)).toBe(5);
    expect(warningSeconds(5)).toBe(3);
  });

  it("reads like a clock", () => {
    expect(clock(65)).toBe("1:05");
    expect(clock(9)).toBe("0:09");
  });
});

describe("sub-activities with parts", () => {
  // The interview is scored in two parts: its Q&A (60%) and the advocacy (40%).
  const qna = roundFixture({ id: "qna", name: "Q&A", segment: "preliminary", position: 0, weight: 60, parentId: "interview" });
  const advocacy = roundFixture({ id: "advocacy", name: "Advocacy", segment: "preliminary", position: 1, weight: 40, parentId: "interview" });
  const rounds = [interview, qna, advocacy, costume, swim, qa];

  it("judges the parts in the sub-activity's place, under its name", () => {
    expect(programOrder(rounds).map((r) => r.id)).toEqual(["interview", "costume", "swim", "qa"]);
    expect(judgingOrder(rounds).map((r) => r.id)).toEqual(["qna", "advocacy", "costume", "swim", "qa"]);
    expect(roundLabel(rounds, advocacy)).toBe("interview · Advocacy");
    expect(roundLabel(rounds, costume)).toBe("costume");
    const showing = showingBoard(pageant(rounds, [], "advocacy"));
    expect(showing.round?.name).toBe("interview · Advocacy");
  });

  it("scores the sub-activity as its parts weighted by their shares", () => {
    // Ayla: Q&A 10 of 10 (100%), advocacy 5 of 10 (50%), so the interview is 100 × 60% + 50 × 40% = 80%.
    const scores = [...both("qna", { A: 10 }), ...both("advocacy", { A: 5 })];
    const board = pageant(rounds, scores);
    const { rows } = standings(board, roundPool(board, "qna").entries, [PRELIMINARY]);
    const ayla = rows.find((r) => r.entry.id === "A")!;
    expect(ayla.parts.get("interview")).toBe(80);
    // The costume has no scores yet, so the preliminary total waits for it.
    expect(ayla.total).toBeNull();
    expect(partWeights(rounds, interview).map((w) => [w.round.id, w.weight])).toEqual([
      ["qna", 60],
      ["advocacy", 40],
    ]);
    expect(standingsBy(board, [board.entries[0]], partWeights(rounds, interview)).rows[0].total).toBe(80);
  });

  it("counts every part toward the sub-activity's progress", () => {
    const board = pageant(rounds, both("qna", { A: 9, B: 9, C: 9, D: 9, E: 9 }));
    expect(roundProgress(board, qna)).toMatchObject({ submitted: 10, possible: 10, complete: true });
    expect(roundProgress(board, interview)).toMatchObject({ submitted: 10, possible: 20, complete: false });
  });

  it("judges a part's candidates the same as its sub-activity's", () => {
    const later = roundFixture({ id: "later", segment: "proper", position: 9 });
    const latePart = roundFixture({ id: "late-part", segment: "proper", position: 0, parentId: "later" });
    const board = pageant([interview, { ...swim, cutEntryIds: ["C", "A", "E"] }, later, latePart], []);
    expect(roundPool(board, "late-part").entries.map((e) => e.id)).toEqual(["A", "C", "E"]);
  });
});
