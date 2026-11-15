import { describe, expect, it } from "vitest";
import { entryNeighbors, showColumns } from "./judging";
import { cutPlan, roundProgress, standings } from "./pageant";
import { liveStandings, rankEntries, scoreProgress } from "./scoring";
import { activityFixture, roundFixture } from "./test-fixtures";
import { PRELIMINARY, type Board, type Entry, type Round, type Score } from "./types";
import { reinstateGap, withdrawGap } from "./withdrawn";

const OUT = "2026-11-15T09:00:00Z";
const entry = (id: string, position: number, withdrawnAt: string | null = null): Entry => ({ id, name: id, photoUrl: null, position, withdrawnAt });
const judge = (id: string) => ({ id, name: id, firstName: id, lastName: "X", photoUrl: null, position: 0, isChair: false, panel: "all" as const });
const judges = [judge("j1"), judge("j2")];
const score = (entryId: string, judgeId: string, value: number, roundId: string | null = null): Score => ({ entryId, judgeId, value, roundId });

describe("a withdrawn entry in an event", () => {
  // B withdrew after one judge scored it: it has a score, but no average, rank or place in the count.
  const entries = [entry("A", 0), entry("B", 1, OUT), entry("C", 2)];
  const scores = [score("A", "j1", 8), score("A", "j2", 9), score("B", "j1", 10), score("C", "j1", 7), score("C", "j2", 7)];
  const activity = activityFixture({ sessionState: "live" });

  it("isn't ranked and comes last, though its scores stay", () => {
    const rows = rankEntries(entries, judges, scores, activity);
    expect(rows.map((r) => [r.entry.id, r.rank, r.average])).toEqual([
      ["A", 1, 8.5],
      ["C", 2, 7],
      ["B", null, null],
    ]);
    expect(rows[2].scores.get("j1")).toBe(10);
    expect(liveStandings(rows, 2).map((r) => r.entry.id)).toEqual(["A", "C", "B"]);
  });

  it("isn't waited for: every score is in once the others are scored", () => {
    expect(scoreProgress({ activity, judges, entries, scores, rounds: [] })).toEqual({ submitted: 4, possible: 4, complete: true });
  });

  it("is passed over going through the running order, and can't be shown", () => {
    expect(entryNeighbors(entries, "A").next?.id).toBe("C");
    expect(entryNeighbors(entries, "C").previous?.id).toBe("A");
    expect(entryNeighbors([entry("B", 0, OUT), ...entries.slice(0, 1)], null).next?.id).toBe("A");
    expect(showColumns({ activity, judges, entries, scores, rounds: [] }, "B", 0)).toEqual({ error: "B has withdrawn, so they can't be judged." });
  });

  it("can be withdrawn and reinstated only while judging is live, and not while it's on screen", () => {
    const board = (over: Partial<Board["activity"]>): Board => ({ activity: activityFixture({ sessionState: "live", ...over }), judges, entries, scores, rounds: [] });
    expect(withdrawGap(board({}), entries[0])).toBeNull();
    expect(withdrawGap(board({ currentEntryId: "A" }), entries[0])).toBe("A is on the judges' screens. Show another entry first.");
    expect(withdrawGap(board({ sessionState: "draft" }), entries[0])).toBe("Judging hasn't started, so remove the entry instead.");
    expect(withdrawGap(board({ sessionState: "deliberation" }), entries[0])).toMatch(/deliberating/);
    expect(reinstateGap(board({}), entries[1])).toBeNull();
    expect(reinstateGap(board({ sessionState: "ended" }), entries[1])).toBe("Judging isn't live.");
  });
});

describe("a withdrawn candidate in a pageant", () => {
  const talent = roundFixture({ id: "talent", segment: "preliminary", position: 0, weight: 40 });
  const swim = roundFixture({ id: "swim", segment: "proper", position: 1, weight: 100, cutSize: 2, cutBasis: [PRELIMINARY, "swim"] });
  // C withdrew after Talent: no swim scores, and the Top 2 is decided between A, B and D.
  const candidates = [entry("A", 0), entry("B", 1), entry("C", 2, OUT), entry("D", 3)];
  const scores = [
    ...["A", "B", "C", "D"].flatMap((id, i) => judges.map((j) => score(id, j.id, 9 - i, "talent"))),
    ...["A", "B", "D"].flatMap((id, i) => judges.map((j) => score(id, j.id, 9 - i, "swim"))),
  ];
  const board = (rounds: Round[] = [talent, swim], over: Partial<Board["activity"]> = {}): Board => ({
    activity: activityFixture({ kind: "pageant", preliminaryWeight: 40, sessionState: "live", ...over }),
    judges,
    entries: candidates,
    scores,
    rounds,
  });

  it("isn't waited for in a sub-activity, nor ranked in its standings", () => {
    expect(roundProgress(board(), swim)).toMatchObject({ submitted: 6, possible: 6, complete: true });
    const { rows, complete } = standings(board(), candidates, [PRELIMINARY, "swim"]);
    expect(complete).toBe(true);
    expect(rows.at(-1)).toMatchObject({ entry: { id: "C" }, total: null, rank: null });
    expect(rows.slice(0, 3).map((r) => r.rank)).toEqual([1, 2, 3]);
  });

  it("leaves a cut to the candidates still in", () => {
    const plan = cutPlan(board(), swim);
    expect(plan).toMatchObject({ ready: true, size: 2 });
    expect(plan.rows.slice(0, 2).map((r) => r.entry.id)).toEqual(["A", "B"]);
    // Fewer still in than the cut's size: everyone left goes through.
    const out = [entry("A", 0), entry("B", 1, OUT), entry("C", 2, OUT), entry("D", 3, OUT)];
    expect(cutPlan({ ...board(), entries: out }, swim).size).toBe(1);
  });

  it("can't be withdrawn while a sub-activity is deliberated, or once the placements are confirmed", () => {
    const deliberating = { ...talent, liveScoring: false, deliberationStartedAt: OUT };
    expect(withdrawGap(board([deliberating, swim]), candidates[0])).toBe("The judges are deliberating talent. Sign it off first.");
    expect(withdrawGap(board([talent, { ...swim, cutEntryIds: ["A", "B"] }]), candidates[3])).toBe("The final placements are confirmed.");
    expect(withdrawGap(board(), candidates[0])).toBeNull();
  });

  it("can be reinstated only while nothing went ahead without them", () => {
    // Pageant proper is under way and C has no swim scores yet: they can come back and be scored.
    expect(reinstateGap(board(), candidates[2])).toBeNull();
    // The Top 2 was confirmed while they were out.
    expect(reinstateGap(board([talent, { ...swim, cutEntryIds: ["A", "B"] }]), candidates[2])).toBe("The swim cut was confirmed without C.");
    // Swim's judges have signed it off without their scores.
    const signed = { ...swim, liveScoring: false, deliberationStartedAt: OUT, signedOffAt: OUT };
    expect(reinstateGap(board([talent, signed]), candidates[2])).toBe("swim went ahead without C's scores.");
    // The preliminary ended without their Talent scores.
    const missing = { ...board(), scores: scores.filter((s) => !(s.entryId === "C" && s.roundId === "talent")) };
    expect(reinstateGap({ ...missing, activity: { ...missing.activity, preliminaryEndedAt: OUT } }, candidates[2])).toBe(
      "The preliminary ended without C's scores in talent.",
    );
  });
});
