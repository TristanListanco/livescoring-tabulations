import { describe, expect, it } from "vitest";
import { entryNeighbors, eventTimer, judgesLocked, judgeView, LATE_SCORE_MS, pageantScoreRound, scoreWindowOpen, showColumns, showEntryColumns, startReady } from "./judging";
import { activityFixture, roundFixture } from "./test-fixtures";

const entries = [
  { id: "e1", name: "Agila", photoUrl: null, position: 0 },
  { id: "e2", name: "Bagwis", photoUrl: null, position: 1 },
];
const none = new Map<string, number>();

describe("judgeView", () => {
  it("keeps judges waiting until the session starts", () => {
    expect(judgeView({ sessionState: "draft", currentEntryId: "e1" }, entries, none)).toEqual({ kind: "not-started" });
  });

  it("waits for the organizer to show an entry", () => {
    expect(judgeView({ sessionState: "live", currentEntryId: null }, entries, none)).toEqual({ kind: "waiting" });
    expect(judgeView({ sessionState: "live", currentEntryId: "deleted" }, entries, none)).toEqual({ kind: "waiting" });
  });

  it("shows only the entry the organizer picked", () => {
    expect(judgeView({ sessionState: "live", currentEntryId: "e2" }, entries, none)).toEqual({ kind: "scoring", entry: entries[1], number: 2 });
  });

  it("waits for the next entry once the judge has scored the current one", () => {
    const mine = new Map([["e2", 9.5]]);
    expect(judgeView({ sessionState: "live", currentEntryId: "e2" }, entries, mine)).toEqual({ kind: "scored", entry: entries[1], number: 2, value: 9.5 });
  });

  it("closes when the session ends", () => {
    expect(judgeView({ sessionState: "ended", currentEntryId: "e1" }, entries, none)).toEqual({ kind: "ended" });
    expect(judgeView({ sessionState: "deliberation", currentEntryId: null }, entries, none)).toEqual({ kind: "deliberation" });
  });
});

describe("entryNeighbors", () => {
  it("starts at the first entry when nothing is on screen", () => {
    expect(entryNeighbors(entries, null)).toMatchObject({ index: -1, entry: null, previous: null, next: entries[0] });
  });

  it("finds the entries before and after the current one", () => {
    expect(entryNeighbors(entries, "e1")).toMatchObject({ index: 0, entry: entries[0], previous: null, next: entries[1] });
    expect(entryNeighbors(entries, "e2")).toMatchObject({ index: 1, entry: entries[1], previous: entries[0], next: null });
  });
});

describe("showEntryColumns", () => {
  it("puts the entry judges are shown on the LED wall too", () => {
    expect(showEntryColumns("e2")).toEqual({ current_entry_id: "e2", led_entry_id: "e2" });
  });

  it("leaves the LED wall alone when judges go back to waiting", () => {
    expect(showEntryColumns(null)).toEqual({ current_entry_id: null });
  });
});

describe("scoreWindowOpen", () => {
  const movedAt = Date.parse("2026-10-23T10:00:00Z");
  const event = {
    kind: "event" as const,
    liveScoring: false,
    independentScoring: false,
    currentEntryId: "e2",
    previousEntryId: "e1",
    entryShownAt: new Date(movedAt).toISOString(),
  };

  it("at their own pace, takes a score for any entry, whatever is on screen", () => {
    const ownPace = { ...event, independentScoring: true, currentEntryId: null };
    expect(scoreWindowOpen(ownPace, "e3", movedAt + 600_000)).toBe(true);
    // Not with live scoring, where it doesn't apply.
    expect(scoreWindowOpen({ ...ownPace, liveScoring: true }, "e3", movedAt + 600_000)).toBe(false);
  });

  it("takes a score for the entry on screen", () => {
    expect(scoreWindowOpen(event, "e2", movedAt + 60_000)).toBe(true);
  });

  it("takes a score for the entry judges were just moved on from, confirmed before the move", () => {
    expect(scoreWindowOpen(event, "e1", movedAt + 5_500)).toBe(true);
    expect(scoreWindowOpen(event, "e1", movedAt + LATE_SCORE_MS)).toBe(true);
  });

  it("not once the window has passed, nor for any other entry", () => {
    expect(scoreWindowOpen(event, "e1", movedAt + LATE_SCORE_MS + 1)).toBe(false);
    expect(scoreWindowOpen(event, "e3", movedAt + 1_000)).toBe(false);
  });

  it("not when judges were sent to wait without a time, nor before the first move", () => {
    expect(scoreWindowOpen({ ...event, entryShownAt: null }, "e1", movedAt + 1_000)).toBe(false);
    expect(scoreWindowOpen({ ...event, previousEntryId: null }, "e1", movedAt + 1_000)).toBe(false);
  });

  it("keeps a judge sent back to waiting able to land the score they just confirmed", () => {
    expect(scoreWindowOpen({ ...event, currentEntryId: null }, "e1", movedAt + 3_000)).toBe(true);
  });

});

describe("pageantScoreRound", () => {
  const movedAt = Date.parse("2026-10-23T10:00:00Z");
  const talent = roundFixture({ id: "talent", segment: "preliminary", name: "Talent", position: 0 });
  const gown = roundFixture({ id: "gown", segment: "proper", name: "Gown", position: 1 });
  const rounds = [talent, gown];
  // Talent's Cora (e1) was on screen; the organizer has just shown Bea (e2).
  const on = { currentRoundId: "talent", currentEntryId: "e2", previousEntryId: "e1", entryShownAt: new Date(movedAt).toISOString(), liveScoring: true, independentScoring: false };
  const where = (r: ReturnType<typeof pageantScoreRound>) => ("error" in r ? r.error : r.round.id);

  it("goes in the sub-activity it was given in: the candidate on screen, or the one just moved on from", () => {
    expect(where(pageantScoreRound(on, rounds, "talent", "e2", movedAt + 1_000))).toBe("talent");
    expect(where(pageantScoreRound(on, rounds, "talent", "e1", movedAt + 1_000))).toBe("talent");
    expect(where(pageantScoreRound(on, rounds, "talent", "e1", movedAt + LATE_SCORE_MS + 1))).toMatch(/moved to another candidate/);
  });

  it("a score confirmed just before judges moved to the next sub-activity stays in the one it was given in", () => {
    const switched = { ...on, currentRoundId: "gown", currentEntryId: null };
    const late = pageantScoreRound(switched, rounds, "talent", "e1", movedAt + 3_000);
    expect("error" in late ? late.error : [late.round.id, late.onScreen]).toEqual(["talent", false]);
    // Once Gown shows its first candidate (Cora again), a late Talent score is turned away, never put in Gown; Gown's own goes in Gown.
    const shown = { ...switched, currentEntryId: "e1", previousEntryId: null };
    expect(where(pageantScoreRound(shown, rounds, "talent", "e1", movedAt + 3_000))).toMatch(/moved to another candidate/);
    expect(where(pageantScoreRound(shown, rounds, "gown", "e1", movedAt + 3_000))).toBe("gown");
  });

  it("a screen that doesn't say: only the candidate on screen, in the sub-activity on screen", () => {
    expect(where(pageantScoreRound(on, rounds, undefined, "e2", movedAt + 1_000))).toBe("talent");
    expect(where(pageantScoreRound(on, rounds, undefined, "e1", movedAt + 1_000))).toMatch(/moved to another candidate/);
    expect(where(pageantScoreRound({ ...on, currentRoundId: null }, rounds, undefined, "e2", movedAt))).toMatch(/isn't open/);
  });

  it("at its own pace, any candidate; never once its deliberation has started", () => {
    const paced = [{ ...talent, liveScoring: false, independentScoring: true }, gown];
    expect(where(pageantScoreRound({ ...on, currentEntryId: null }, paced, "talent", "e3", movedAt + 600_000))).toBe("talent");
    const deliberating = [{ ...paced[0], deliberationStartedAt: new Date(movedAt).toISOString() }, gown];
    expect(where(pageantScoreRound({ ...on, currentEntryId: null }, deliberating, "talent", "e3", movedAt))).toMatch(/deliberating Talent/);
  });
});

describe("an event's scoring timer", () => {
  const entries = [{ id: "e1", name: "Agila", photoUrl: null, position: 0 }];
  const board = (over: Parameters<typeof activityFixture>[0]) => ({ activity: activityFixture(over), judges: [], entries, scores: [], rounds: [] });
  const now = Date.parse("2026-11-07T00:00:00Z");

  it("starts as an entry is shown, an entry at a time, with simple or criteria scoring", () => {
    expect(showColumns(board({ timerSeconds: 30 }), "e1", now)).toEqual({
      columns: { current_entry_id: "e1", led_entry_id: "e1", scoring_closes_at: "2026-11-07T00:00:30.000Z" },
    });
    // Judges sent back to wait: no timer running.
    expect(showColumns(board({ timerSeconds: 30 }), null, now)).toEqual({ columns: { current_entry_id: null, scoring_closes_at: null } });
    expect(eventTimer(activityFixture({ timerSeconds: 30, scoringMode: "criteria" }))).toBe(30);
  });
  it("doesn't run without one, or at judges' own pace", () => {
    expect(showColumns(board({}), "e1", now)).toEqual({ columns: { current_entry_id: "e1", led_entry_id: "e1" } });
    expect(eventTimer(activityFixture({ timerSeconds: 30, liveScoring: false, independentScoring: true }))).toBeNull();
    expect(eventTimer(activityFixture({ timerSeconds: 30, kind: "pageant" }))).toBeNull();
  });
});

describe("judgesLocked", () => {
  it("locks the panel once judging has started, and keeps it locked after the scores are reset", () => {
    expect(judgesLocked({ sessionState: "draft", sessionStartedAt: null })).toBe(false);
    expect(judgesLocked({ sessionState: "live", sessionStartedAt: "2026-11-08T00:00:00Z" })).toBe(true);
    expect(judgesLocked({ sessionState: "ended", sessionStartedAt: "2026-11-08T00:00:00Z" })).toBe(true);
    // Reset: back to not started, but it started once.
    expect(judgesLocked({ sessionState: "draft", sessionStartedAt: "2026-11-08T00:00:00Z" })).toBe(true);
  });
});

describe("startReady", () => {
  const approved = (judgeId: string) => ({ judgeId, status: "approved" as const });
  const judges = [
    { id: "a", panel: "all" as const },
    { id: "p", panel: "preliminary" as const },
    { id: "q", panel: "proper" as const },
  ];
  const at = (extra: Parameters<typeof startReady>[0]) => extra;

  it("starts an event's session once every judge is in", () => {
    const event = at({ kind: "event", sessionState: "draft", preliminaryEndedAt: null, properStartedAt: null });
    expect(startReady(event, judges, [approved("a"), approved("p")])).toBeNull();
    expect(startReady(event, judges, judges.map((j) => approved(j.id)))).toEqual({ what: "session", count: 3 });
    expect(startReady({ ...event, sessionState: "live" }, judges, judges.map((j) => approved(j.id)))).toBeNull();
  });

  it("starts a pageant's preliminary once its board is in, pageant proper's own judges aside", () => {
    const pageant = at({ kind: "pageant", sessionState: "draft", preliminaryEndedAt: null, properStartedAt: null });
    expect(startReady(pageant, judges, [approved("a")])).toBeNull();
    expect(startReady(pageant, judges, [approved("a"), approved("p")])).toEqual({ what: "preliminary", count: 2 });
  });

  it("starts pageant proper in the break once its board is in", () => {
    const live = at({ kind: "pageant", sessionState: "live", preliminaryEndedAt: null, properStartedAt: null });
    expect(startReady(live, judges, judges.map((j) => approved(j.id)))).toBeNull();
    const between = { ...live, preliminaryEndedAt: "2026-11-12T09:00:00Z" };
    expect(startReady(between, judges, [approved("a")])).toBeNull();
    expect(startReady(between, judges, [approved("a"), approved("q")])).toEqual({ what: "proper", count: 2 });
    expect(startReady({ ...between, properStartedAt: "2026-11-12T09:30:00Z" }, judges, judges.map((j) => approved(j.id)))).toBeNull();
  });
});

describe("a pageant sub-activity at its judges' own pace", () => {
  const round = roundFixture({ id: "r", segment: "preliminary", name: "Talent", liveScoring: false, independentScoring: true });
  const board = {
    activity: activityFixture({ kind: "pageant", sessionState: "live", currentRoundId: "r" }),
    judges: [],
    entries,
    scores: [],
    rounds: [round],
  };

  it("shows no candidate, though judges can be sent to wait", () => {
    expect(showColumns(board, "e1", 0)).toEqual({ error: "Judges score Talent at their own pace, so no candidate is shown." });
    expect(showColumns(board, null, 0)).toEqual({ columns: { current_entry_id: null, scoring_closes_at: null } });
  });
});
