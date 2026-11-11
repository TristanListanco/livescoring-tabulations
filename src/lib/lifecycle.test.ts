import { describe, expect, it } from "vitest";
import { canApprove, canMove, editable, hasLedWall, phaseOf, scoresGoOutLive, SESSION_MOVES, type Move, type Phase } from "./lifecycle";
import type { SessionState } from "./types";

const at = (sessionState: SessionState, extra: { sessionStartedAt?: string | null; signedOffAt?: string | null; archivedAt?: string | null } = {}) => ({
  sessionState,
  sessionStartedAt: null,
  signedOffAt: null,
  archivedAt: null,
  ...extra,
});
const T = "2026-11-11T09:00:00Z";

/** One activity in each phase. */
const PHASES: Record<Phase, ReturnType<typeof at>> = {
  setup: at("draft"),
  "setup-after-reset": at("draft", { sessionStartedAt: T }),
  live: at("live", { sessionStartedAt: T }),
  deliberation: at("deliberation", { sessionStartedAt: T }),
  ended: at("ended", { sessionStartedAt: T }),
  "signed-off": at("ended", { sessionStartedAt: T, signedOffAt: T }),
  archived: at("ended", { sessionStartedAt: T, archivedAt: T }),
};

describe("phaseOf", () => {
  it("names every phase from the columns that store it", () => {
    for (const [phase, activity] of Object.entries(PHASES)) expect(phaseOf(activity)).toBe(phase);
  });
  it("calls an archived activity archived, whatever else it says", () => {
    expect(phaseOf(at("ended", { signedOffAt: T, archivedAt: T }))).toBe("archived");
  });
});

describe("SESSION_MOVES", () => {
  /** Each move, and the phases it may start from: the rules the server actions applied one by one before. */
  const allowed: Record<Move, Phase[]> = {
    start: ["setup", "setup-after-reset"],
    deliberate: ["live"],
    end: ["live", "deliberation"],
    reopen: ["ended"],
    redeliberate: ["signed-off"],
    reset: ["setup", "setup-after-reset", "live", "deliberation", "ended", "signed-off"],
    archive: ["ended", "signed-off"],
  };
  it("allows each move from exactly its phases", () => {
    for (const move of Object.keys(SESSION_MOVES) as Move[]) {
      for (const [phase, activity] of Object.entries(PHASES)) expect([move, phase, canMove(activity, move)]).toEqual([move, phase, allowed[move].includes(phase as Phase)]);
    }
  });
  it("never goes back to live from a deliberation, nor reopens signed results, nor changes anything archived", () => {
    expect(canMove(PHASES.deliberation, "reopen")).toBe(false);
    expect(canMove(PHASES.deliberation, "start")).toBe(false);
    expect(canMove(PHASES["signed-off"], "reopen")).toBe(false);
    for (const move of Object.keys(SESSION_MOVES) as Move[]) expect(canMove(PHASES.archived, move)).toBe(false);
  });
});

describe("editable", () => {
  it("keeps the panel and the scoring rules for before judging first starts, even after a reset", () => {
    expect(editable(PHASES.setup, "judges")).toBe(true);
    expect(editable(PHASES.setup, "rules")).toBe(true);
    for (const phase of ["setup-after-reset", "live", "deliberation", "ended", "signed-off", "archived"] as Phase[]) {
      expect(editable(PHASES[phase], "judges")).toBe(false);
      expect(editable(PHASES[phase], "rules")).toBe(false);
    }
  });
  it("lets the running order, program and guides change before the start and again after a reset", () => {
    for (const part of ["order", "program", "guides"] as const) {
      expect(editable(PHASES.setup, part)).toBe(true);
      expect(editable(PHASES["setup-after-reset"], part)).toBe(true);
      expect(editable(PHASES.live, part)).toBe(false);
    }
  });
  it("lets entries and the judges' options change until judging ends", () => {
    for (const part of ["entries", "judgeOptions"] as const) {
      expect(editable(PHASES.deliberation, part)).toBe(true);
      expect(editable(PHASES.ended, part)).toBe(false);
      expect(editable(PHASES.archived, part)).toBe(false);
    }
  });
});

describe("modes", () => {
  it("sends scores out live for a pageant or an event with live scoring, which have an LED wall until archived", () => {
    expect(scoresGoOutLive({ kind: "pageant", liveScoring: false })).toBe(true);
    expect(scoresGoOutLive({ kind: "event", liveScoring: true })).toBe(true);
    expect(scoresGoOutLive({ kind: "event", liveScoring: false })).toBe(false);
    expect(hasLedWall({ kind: "event", liveScoring: true, archivedAt: null })).toBe(true);
    expect(hasLedWall({ kind: "event", liveScoring: true, archivedAt: T })).toBe(false);
    expect(hasLedWall({ kind: "event", liveScoring: false, archivedAt: null })).toBe(false);
  });
  it("approves only a device still waiting", () => {
    expect(canApprove("pending")).toBe(true);
    expect(canApprove("approved")).toBe(false);
    expect(canApprove("revoked")).toBe(false);
  });
});
