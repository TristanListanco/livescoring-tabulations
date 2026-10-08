import { PRELIMINARY, type Activity, type Board, type Entry, type Round, type Score } from "./types";

/**
 * Pageant mode. Candidates (the activity's entries) go through the preliminary segment's sub-activities, then
 * pageant proper's, where cuts narrow the field (Top 10, Top 5, Top 3). Each sub-activity is scored like an
 * activity of its own, so the judges' keypads, the LED wall and the live results reuse what events use: they're
 * handed a board narrowed to one sub-activity (see roundBoard).
 */

/** Sub-activities in program order: the preliminary segment first, then pageant proper. */
export function programOrder(rounds: Round[]): Round[] {
  const segment = (r: Round) => (r.segment === "preliminary" ? 0 : 1);
  return [...rounds].sort((a, b) => segment(a) - segment(b) || a.position - b.position);
}

/** Every candidate with their number in the full running order, which they keep through every cut. */
function numbered(entries: Entry[]): Entry[] {
  return [...entries].sort((a, b) => a.position - b.position).map((e, i) => ({ ...e, number: i + 1 }));
}

/**
 * The candidates a sub-activity judges: everyone, or those who went through the last cut before it.
 * blockedBy: an earlier cut the organizer hasn't confirmed yet, so this sub-activity can't start.
 */
export function roundPool(board: Pick<Board, "entries" | "rounds">, roundId: string): { entries: Entry[]; blockedBy: Round | null } {
  const order = programOrder(board.rounds);
  const index = order.findIndex((r) => r.id === roundId);
  const all = numbered(board.entries);
  for (let i = index - 1; i >= 0; i--) {
    const earlier = order[i];
    if (earlier.cutSize === null) continue;
    if (earlier.cutEntryIds === null) return { entries: roundPool(board, earlier.id).entries, blockedBy: earlier };
    const through = new Set(earlier.cutEntryIds);
    return { entries: all.filter((e) => through.has(e.id)), blockedBy: null };
  }
  return { entries: all, blockedBy: null };
}

/** A sub-activity's scoring in the shape of an activity, so keypads, scoreboards and the LED wall use it unchanged. */
export function withRoundRules(activity: Activity, round: Round): Activity {
  return {
    ...activity,
    scoringMode: round.scoringMode,
    criteria: round.criteria,
    criteriaDisplay: round.criteriaDisplay,
    min: round.min,
    max: round.max,
    decimals: round.decimals,
  };
}

/** One sub-activity as a board of its own: its rules, its candidates, and only the scores given in it. */
export function roundBoard(board: Board, round: Round): Board {
  return {
    ...board,
    activity: withRoundRules(board.activity, round),
    entries: roundPool(board, round.id).entries,
    scores: board.scores.filter((s) => s.roundId === round.id),
  };
}

/**
 * What the judges, the LED wall and the live results follow. An event as it is; a pageant, the sub-activity
 * being judged, or no candidates at all between sub-activities.
 */
export function showingBoard(board: Board): { board: Board; round: Round | null } {
  if (board.activity.kind !== "pageant") return { board, round: null };
  const round = board.rounds.find((r) => r.id === board.activity.currentRoundId) ?? null;
  if (round) return { board: roundBoard(board, round), round };
  return { board: { ...board, activity: { ...board.activity, currentEntryId: null, ledEntryId: null }, entries: [], scores: [] }, round: null };
}

/** How far a sub-activity's judging has got: scores in from every judge for every candidate in it. */
export function roundProgress(board: Board, round: Round): { submitted: number; possible: number; complete: boolean; blockedBy: Round | null } {
  const { entries, blockedBy } = roundPool(board, round.id);
  const judgeIds = new Set(board.judges.map((j) => j.id));
  const entryIds = new Set(entries.map((e) => e.id));
  const submitted = board.scores.filter((s) => s.roundId === round.id && judgeIds.has(s.judgeId) && entryIds.has(s.entryId)).length;
  const possible = judgeIds.size * entryIds.size;
  return { submitted, possible, complete: possible > 0 && submitted === possible, blockedBy };
}

/** A whole pageant's progress: every sub-activity's scores in, out of every judge scoring every candidate in it. */
export function programProgress(board: Board): { submitted: number; possible: number; complete: boolean } {
  let submitted = 0;
  let possible = 0;
  for (const round of board.rounds) {
    const p = roundProgress(board, round);
    submitted += p.submitted;
    // A sub-activity after an unconfirmed cut will judge at most the cut's size.
    possible += p.blockedBy ? Math.min(p.blockedBy.cutSize ?? 0, p.possible / Math.max(1, board.judges.length)) * board.judges.length : p.possible;
  }
  return { submitted, possible, complete: possible > 0 && submitted === possible };
}

// Cuts and standings ---------------------------------------------------------------------

/**
 * What each sub-activity in a cut's basis counts for, in percent, adding up to 100. When the preliminary segment
 * is counted with pageant proper sub-activities, it keeps its share of the overall score and the pageant proper
 * ones share the rest in proportion to their weights. Counted alone, either side makes up the whole 100.
 */
export function basisWeights(rounds: Round[], preliminaryWeight: number, basis: string[]): { round: Round; weight: number }[] {
  const prelim = basis.includes(PRELIMINARY) ? programOrder(rounds).filter((r) => r.segment === "preliminary") : [];
  const proper = programOrder(rounds).filter((r) => r.segment === "proper" && basis.includes(r.id));
  const prelimShare = prelim.length === 0 ? 0 : proper.length === 0 ? 100 : preliminaryWeight;
  const properShare = proper.length === 0 ? 0 : 100 - prelimShare;
  const share = (list: Round[], total: number) => {
    const sum = list.reduce((s, r) => s + r.weight, 0);
    return list.map((round) => ({ round, weight: sum > 0 ? (total * round.weight) / sum : 0 }));
  };
  return [...share(prelim, prelimShare), ...share(proper, properShare)];
}

export type StandingRow = {
  entry: Entry;
  /** The candidate's number in the full running order. */
  number: number;
  /** Per sub-activity in the basis: the candidate's average as a percentage of its maximum, or null before any score. */
  parts: Map<string, number | null>;
  /** The weighted total out of 100, rounded to the results' decimal places, once every part has a score. */
  total: number | null;
  rank: number | null;
  /** Every judge has scored this candidate in every sub-activity of the basis. */
  complete: boolean;
};

const roundTo = (value: number, places: number) => Math.round((value + Number.EPSILON) * 10 ** places) / 10 ** places;

/** A candidate's average in a sub-activity as a percentage of its maximum (9.5 of 10 → 95), from the scores in so far. */
function percentOf(round: Round, entryId: string, scores: Score[], judgeIds: Set<string>): { percent: number | null; count: number } {
  let hundredths = 0;
  let count = 0;
  for (const s of scores) {
    if (s.roundId !== round.id || s.entryId !== entryId || !judgeIds.has(s.judgeId)) continue;
    hundredths += Math.round(s.value * 100);
    count++;
  }
  return { percent: count ? (hundredths / 100 / count / round.max) * 100 : null, count };
}

/**
 * Candidates ranked by a basis of sub-activities, best first. Each candidate's total is the weighted sum of their
 * averages as percentages, rounded to the results' decimal places; equal totals share a rank. Candidates without a
 * score in every part go last, unranked, in running order.
 */
export function standings(board: Board, entries: Entry[], basis: string[]): { weights: { round: Round; weight: number }[]; rows: StandingRow[]; complete: boolean } {
  const weights = basisWeights(board.rounds, board.activity.preliminaryWeight, basis);
  const judgeIds = new Set(board.judges.map((j) => j.id));
  const places = board.activity.resultDecimals;

  const rows: StandingRow[] = entries.map((entry, i) => {
    const parts = new Map<string, number | null>();
    let sum = 0;
    let scored = true;
    let complete = judgeIds.size > 0;
    for (const { round, weight } of weights) {
      const { percent, count } = percentOf(round, entry.id, board.scores, judgeIds);
      parts.set(round.id, percent);
      if (percent === null) scored = false;
      else sum += (weight * percent) / 100;
      if (count < judgeIds.size) complete = false;
    }
    return { entry, number: entry.number ?? i + 1, parts, total: scored && weights.length ? roundTo(sum, places) : null, rank: null, complete };
  });

  rows.sort((a, b) => {
    if (a.total === null || b.total === null) return a.total === b.total ? a.number - b.number : a.total === null ? 1 : -1;
    return b.total - a.total || a.number - b.number;
  });
  rows.forEach((row, i) => {
    if (row.total === null) return;
    const prev = rows[i - 1];
    row.rank = prev && prev.total === row.total ? prev.rank : i + 1;
  });
  return { weights, rows, complete: rows.length > 0 && rows.every((r) => r.complete) };
}

/** The last cut of the pageant: its order is the final placement (winner first). */
export function finalCutRound(rounds: Round[]): Round | null {
  return programOrder(rounds)
    .reverse()
    .find((r) => r.cutSize !== null) ?? null;
}

/**
 * Tied candidates the organizer has to order before a cut can be confirmed. `places`: how many of them the
 * organizer picks, in order. On the cut line only `places` of the group go through; in the final cut a tie
 * inside the top places decides who places higher, so the organizer orders all of it.
 */
export type TieGroup = { rows: StandingRow[]; places: number; onTheLine: boolean };

export type CutPlan = {
  round: Round;
  /** How many go through: the cut's size, or everyone when fewer are left. */
  size: number;
  final: boolean;
  weights: { round: Round; weight: number }[];
  rows: StandingRow[];
  /** Every score in the basis is in for every candidate in the cut. */
  ready: boolean;
  ties: TieGroup[];
};

/** A cut, ranked from the candidates judged in its sub-activity, with the ties the organizer has to break. */
export function cutPlan(board: Board, round: Round): CutPlan {
  const pool = roundPool(board, round.id).entries;
  const { weights, rows, complete } = standings(board, pool, round.cutBasis);
  const size = Math.min(round.cutSize ?? 0, pool.length);
  const final = finalCutRound(board.rounds)?.id === round.id;

  const ties: TieGroup[] = [];
  for (let i = 0; i < rows.length; ) {
    const rank = rows[i].rank;
    let j = i + 1;
    while (j < rows.length && rank !== null && rows[j].rank === rank) j++;
    const group = rows.slice(i, j);
    const first = i + 1;
    const last = j;
    if (group.length > 1 && rank !== null && first <= size) {
      if (last > size) ties.push({ rows: group, places: size - i, onTheLine: true });
      else if (final) ties.push({ rows: group, places: group.length, onTheLine: false });
    }
    i = j;
  }
  return { round, size, final, weights, rows, ready: complete, ties };
}

/**
 * Who goes through a cut, best first, with the organizer's picks for each tie: one list per tie group, in the
 * group's order, naming exactly `places` of its candidates. An error when the picks don't fit the plan.
 */
export function cutResult(plan: CutPlan, picks: string[][]): { ok: true; entryIds: string[] } | { ok: false; error: string } {
  if (!plan.ready) return { ok: false, error: "Every judge has to score every candidate in this cut first." };
  if (picks.length !== plan.ties.length) return { ok: false, error: "Break the ties first." };
  const order: string[] = [];
  for (let i = 0; i < plan.rows.length && order.length < plan.size; ) {
    const groupIndex = plan.ties.findIndex((t) => t.rows[0].entry.id === plan.rows[i].entry.id);
    if (groupIndex < 0) {
      order.push(plan.rows[i].entry.id);
      i++;
      continue;
    }
    const group = plan.ties[groupIndex];
    const chosen = picks[groupIndex];
    const ids = new Set(group.rows.map((r) => r.entry.id));
    if (chosen.length !== group.places || new Set(chosen).size !== chosen.length || chosen.some((id) => !ids.has(id))) {
      return {
        ok: false,
        error: group.onTheLine
          ? `Choose ${group.places} of the ${group.rows.length} tied candidates to go through.`
          : `Put the ${group.rows.length} tied candidates in order.`,
      };
    }
    order.push(...chosen);
    i += group.rows.length;
  }
  return { ok: true, entryIds: order.slice(0, plan.size) };
}

// Scoring timer -------------------------------------------------------------------------

/** A score that left the judge's screen just as time ran out still counts, if it arrives within this margin. */
export const SUBMIT_GRACE_MS = 2_000;

/** The warning (yellow) starts this many seconds before scoring closes: the last 10, or the last third of a short timer. */
export function warningSeconds(timerSeconds: number): number {
  return Math.max(3, Math.min(10, Math.ceil(timerSeconds / 3)));
}

/**
 * The timer's state at `now`. open (green): judges can score. closing (yellow): they can still score, but time is
 * nearly up. closed (red): no more scores until the organizer reopens it.
 */
export function timerPhase(closesAt: string, now: number, timerSeconds: number): { phase: "open" | "closing" | "closed"; secondsLeft: number } {
  const msLeft = new Date(closesAt).getTime() - now;
  const secondsLeft = Math.max(0, Math.ceil(msLeft / 1000));
  if (msLeft <= 0) return { phase: "closed", secondsLeft: 0 };
  return { phase: secondsLeft <= warningSeconds(timerSeconds) ? "closing" : "open", secondsLeft };
}

/** "1:05", "0:09". */
export function clock(seconds: number): string {
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}
