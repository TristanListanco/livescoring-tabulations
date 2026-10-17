import { judgesFor, roundLabel, withRoundRules } from "./pageant";
import { formatBound, formatScore } from "./scoring";
import type { Activity, Board, Judge } from "./types";

/**
 * Score corrections. A judge who entered a wrong score asks to change it, with a reason; it changes only if every other
 * judge on their panel agrees (any one disagreeing turns it down). A judge alone on their panel has no one to ask, so
 * the organizer approves or turns it down instead. The database refuses any other change to a submitted score.
 */

export type CorrectionStatus = "open" | "approved" | "rejected" | "withdrawn";

export type Correction = {
  id: string;
  judgeId: string;
  entryId: string;
  /** The pageant sub-activity (or part) the score was given in; null for events. */
  roundId: string | null;
  oldValue: number;
  newValue: number;
  /** Criteria scoring: points per criterion before and after. */
  oldBreakdown: Record<string, number> | null;
  newBreakdown: Record<string, number> | null;
  reason: string;
  status: CorrectionStatus;
  decidedBy: "judges" | "organizer" | null;
  createdAt: string;
  decidedAt: string | null;
  votes: { judgeId: string; agree: boolean }[];
};

export const MAX_CORRECTION_REASON = 300;

/** A reason as typed: one paragraph, trimmed, cut to MAX_CORRECTION_REASON. Empty means none was given. */
export function cleanReason(value: unknown): string {
  return String(value ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_CORRECTION_REASON)
    .trim();
}

/** Who votes on a correction: every other judge on the panel that judges the score's sub-activity (an event: every other judge). */
export function correctionVoters(board: Pick<Board, "activity" | "judges" | "rounds">, c: Pick<Correction, "judgeId" | "roundId">): Judge[] {
  const round = c.roundId ? board.rounds.find((r) => r.id === c.roundId) : undefined;
  const panel = round ? judgesFor(board, round) : board.judges;
  return panel.filter((j) => j.id !== c.judgeId);
}

/**
 * Where a correction stands after its votes: turned down as soon as any voter disagrees, approved once every voter
 * has agreed. With no one to vote it stays open for the organizer.
 */
export function correctionOutcome(voters: Pick<Judge, "id">[], votes: Correction["votes"]): "approved" | "rejected" | "open" {
  const ids = new Set(voters.map((j) => j.id));
  const counted = votes.filter((v) => ids.has(v.judgeId));
  if (counted.some((v) => !v.agree)) return "rejected";
  if (voters.length > 0 && voters.every((j) => counted.some((v) => v.judgeId === j.id && v.agree))) return "approved";
  return "open";
}

/** A correction as screens and sheets show it: who, which entry, the score before and after, and each criterion's points. */
export type CorrectionView = {
  id: string;
  status: CorrectionStatus;
  decidedBy: Correction["decidedBy"];
  judgeId: string;
  judgeName: string;
  entryId: string;
  entryName: string;
  entryNumber: number;
  /** The pageant sub-activity's full name, or null for events. */
  roundName: string | null;
  roundId: string | null;
  /** The score before and after, as the judge thinks of it ("72.5 / 100" with criteria). */
  from: string;
  to: string;
  /** The same as bare numbers, for showing large, and whether they're out of 100 (criteria). */
  fromNumber: string;
  toNumber: string;
  outOf100: boolean;
  criteria: { name: string; from: string; to: string; changed: boolean }[];
  reason: string;
  /** Votes so far against the number of judges who vote; 0 voters means the organizer decides. */
  agreed: number;
  voters: number;
  createdAt: string;
  decidedAt: string | null;
  /** The scores were left out (see withoutValues): the judges voting see only the reason. */
  valuesHidden?: boolean;
};

/**
 * A correction for the judges who vote on it, in an event without live scoring: who asks, for which entry and why, but
 * not the scores. The values are dropped on the server, so they never reach another judge's screen.
 */
export function withoutValues(view: CorrectionView): CorrectionView {
  return { ...view, from: "", to: "", fromNumber: "", toNumber: "", criteria: [], valuesHidden: true };
}

/** A score as the judge thinks of it: the score, or criteria points out of 100. */
export function correctionScoreText(value: number, rules: Pick<Activity, "scoringMode" | "decimals">): string {
  return rules.scoringMode === "criteria" ? `${formatScore(value, rules.decimals)} / 100` : formatScore(value, rules.decimals);
}

export function correctionView(board: Board, c: Correction): CorrectionView {
  const round = c.roundId ? board.rounds.find((r) => r.id === c.roundId) : undefined;
  const rules = round ? withRoundRules(board.activity, round) : board.activity;
  const ordered = [...board.entries].sort((a, b) => a.position - b.position);
  const index = ordered.findIndex((e) => e.id === c.entryId);
  const voters = correctionVoters(board, c);
  const points = (b: Record<string, number> | null, id: string) => (b && b[id] !== undefined ? formatScore(b[id], rules.decimals) : "—");
  return {
    id: c.id,
    status: c.status,
    decidedBy: c.decidedBy,
    judgeId: c.judgeId,
    judgeName: board.judges.find((j) => j.id === c.judgeId)?.name ?? "A judge",
    entryId: c.entryId,
    entryName: ordered[index]?.name ?? "An entry",
    entryNumber: index + 1,
    roundName: round ? roundLabel(board.rounds, round) : null,
    roundId: c.roundId,
    from: correctionScoreText(c.oldValue, rules),
    to: correctionScoreText(c.newValue, rules),
    fromNumber: formatScore(c.oldValue, rules.decimals),
    toNumber: formatScore(c.newValue, rules.decimals),
    outOf100: rules.scoringMode === "criteria",
    criteria:
      rules.scoringMode === "criteria"
        ? rules.criteria.map((cr) => ({
            name: `${cr.name} (${formatBound(cr.max)})`,
            from: points(c.oldBreakdown, cr.id),
            to: points(c.newBreakdown, cr.id),
            changed: c.oldBreakdown?.[cr.id] !== c.newBreakdown?.[cr.id],
          }))
        : [],
    reason: c.reason,
    agreed: c.votes.filter((v) => v.agree && voters.some((j) => j.id === v.judgeId)).length,
    voters: voters.length,
    createdAt: c.createdAt,
    decidedAt: c.decidedAt,
  };
}
