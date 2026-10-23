import { rankEntries, scoreProgress, type RankedRow } from "./scoring";
import { applyTieBreaks, tiesIn, unbrokenTies, type Tie } from "./ties";
import type { Board, Judge, JudgeSignature } from "./types";

/**
 * Deliberation, for an event without live scoring: once every judge has scored every entry, the organizer (or the
 * chair) opens it. Each judge reviews their own scores and notes, asks the others to correct any that are wrong, then
 * signs: drawn on a touchscreen, or "(Sgd.)" ticked where there's no touch. The session ends once every judge has
 * signed, and only then does the audience see the results. A score corrected after a judge signed voids every
 * signature (the database does it), so the judges sign what the results say.
 */

/** Why the deliberation can't start yet, or null when it can. */
export function deliberationGap(board: Board): string | null {
  const { activity } = board;
  if (activity.kind !== "event" || activity.liveScoring) return "Only an event without live scoring has a deliberation.";
  if (activity.sessionState !== "live") return "The session isn't running.";
  if (!scoreProgress(board).complete) return "Every judge scores every entry before the deliberation.";
  return null;
}

/** The judges who haven't signed yet, in board order. */
export function unsignedJudges(judges: Judge[], signatures: JudgeSignature[]): Judge[] {
  const signed = new Set(signatures.map((s) => s.judgeId));
  return judges.filter((j) => !signed.has(j.id));
}

/** A drawn signature is SVG path data in a box this size: its strokes, as moves and lines between whole-number points. */
export const SIGNATURE_BOX = { width: 600, height: 200 } as const;
export const MAX_SIGNATURE_LENGTH = 20_000;
/** Fewer points than this is a tap or a dot, not a signature. */
const MIN_SIGNATURE_POINTS = 8;

/**
 * A drawn signature as sent from a judge's screen, checked: "M12 40L13 41…" with every point inside the box. Null
 * when it isn't one (malformed, outside the box, too long, or too little drawn).
 */
export function cleanSignature(value: unknown): string | null {
  const path = String(value ?? "").trim();
  if (!path || path.length > MAX_SIGNATURE_LENGTH || !/^(?:[ML]\d{1,3} \d{1,3})+$/.test(path)) return null;
  const points = [...path.matchAll(/[ML](\d{1,3}) (\d{1,3})/g)];
  if (!path.startsWith("M") || points.length < MIN_SIGNATURE_POINTS) return null;
  const inside = points.every((p) => Number(p[1]) <= SIGNATURE_BOX.width && Number(p[2]) <= SIGNATURE_BOX.height);
  return inside ? path : null;
}

/**
 * What the organizer's desk is sent of a deliberation, worked out on the server from the scores it never sends: the
 * ties in the ranking (which entries are level, not their scores), and, once every judge has signed and every tie is
 * broken, the results they signed, for the organizer to sign in turn (each entry's average, not each judge's score).
 */
export type DeliberationResults = { ties: Tie[]; ranking: RankedRow[] | null };

export function deliberationResults(board: Board, signatures: JudgeSignature[] | null): DeliberationResults {
  const breaks = board.tieBreaks ?? [];
  const ranking = rankEntries(board.entries, board.judges, board.scores, board.activity);
  const signed = signatures !== null && unsignedJudges(board.judges, signatures).length === 0;
  const settled = unbrokenTies(ranking, breaks).length === 0;
  return {
    ties: tiesIn(ranking),
    ranking: signed && settled ? applyTieBreaks(ranking, breaks).map((row) => ({ ...row, scores: new Map<string, number>() })) : null,
  };
}
