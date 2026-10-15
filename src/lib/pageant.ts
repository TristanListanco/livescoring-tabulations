import { PRELIMINARY, type Activity, type Board, type Deduction, type Entry, type Judge, type Round, type Score } from "./types";

/**
 * Pageant mode. Candidates (the activity's entries) go through the preliminary segment's sub-activities, then
 * pageant proper's, where cuts narrow the field (Top 10, Top 5, Top 3). Each sub-activity is scored like an
 * activity of its own, so the judges' keypads, the LED wall and the live results reuse what events use: they're
 * handed a board narrowed to one sub-activity (see roundBoard).
 */

/**
 * Sub-activities in program order, the preliminary segment first, then pageant proper. Not their parts: segments,
 * shares, cuts and what a cut counts are all made of sub-activities.
 */
export function programOrder(rounds: Round[]): Round[] {
  const segment = (r: Round) => (r.segment === "preliminary" ? 0 : 1);
  return rounds.filter((r) => r.parentId === null).sort((a, b) => segment(a) - segment(b) || a.position - b.position);
}

/** A sub-activity's parts in order, or none when judges score the sub-activity itself. */
export function partsOf(rounds: Round[], roundId: string): Round[] {
  return rounds.filter((r) => r.parentId === roundId).sort((a, b) => a.position - b.position);
}

/** What judges score, in program order: each sub-activity, or its parts in its place. */
export function judgingOrder(rounds: Round[]): Round[] {
  return programOrder(rounds).flatMap((r) => {
    const parts = partsOf(rounds, r.id);
    return parts.length ? parts : [r];
  });
}

/** The sub-activity a part belongs to, or the sub-activity itself. */
export function unitOf(rounds: Round[], round: Round): Round {
  return (round.parentId && rounds.find((r) => r.id === round.parentId)) || round;
}

/** A part's name with its sub-activity's, as judges and screens see it: "Closed-door interview · Q&A". */
export function roundLabel(rounds: Round[], round: Round): string {
  const unit = unitOf(rounds, round);
  return unit === round ? round.name : `${unit.name} · ${round.name}`;
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
  // A part judges the same candidates as its sub-activity.
  const round = board.rounds.find((r) => r.id === roundId);
  const unitId = round ? unitOf(board.rounds, round).id : roundId;
  const index = order.findIndex((r) => r.id === unitId);
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

/** Whether a judge judges this sub-activity (or part): their panel is both segments, or its segment. */
export const onPanel = (judge: Pick<Judge, "panel">, round: Pick<Round, "segment">) => judge.panel === "all" || judge.panel === round.segment;

/**
 * The judges of a sub-activity (or part): every judge for an event, and for a pageant those on its segment's panel,
 * since the preliminary can have its own set of judges.
 */
export function judgesFor(board: Pick<Board, "activity" | "judges">, round: Pick<Round, "segment">): Judge[] {
  return board.activity.kind === "pageant" ? board.judges.filter((j) => onPanel(j, round)) : board.judges;
}

/** The judges of any of these sub-activities, in panel order: who signs a standings sheet that counts them. */
export function judgesForRounds(board: Pick<Board, "activity" | "judges">, rounds: Pick<Round, "segment">[]): Judge[] {
  return board.judges.filter((j) => rounds.some((r) => judgesFor(board, r).includes(j)));
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

/** One sub-activity as a board of its own: its rules, its judges, its candidates, and only the scores given in it. */
export function roundBoard(board: Board, round: Round): Board {
  return {
    ...board,
    activity: withRoundRules(board.activity, round),
    judges: judgesFor(board, round),
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
  // A part goes by its full name ("Closed-door interview · Q&A") wherever it's shown.
  if (round) return { board: roundBoard(board, round), round: { ...round, name: roundLabel(board.rounds, round) } };
  return { board: { ...board, activity: { ...board.activity, currentEntryId: null, ledEntryId: null }, entries: [], scores: [] }, round: null };
}

/**
 * How far a sub-activity's (or a part's) judging has got: scores in from every judge for every candidate in it.
 * A sub-activity with parts counts all of its parts.
 */
export function roundProgress(board: Board, round: Round): { submitted: number; possible: number; complete: boolean; blockedBy: Round | null } {
  const parts = partsOf(board.rounds, round.id);
  if (parts.length) {
    const each = parts.map((p) => roundProgress(board, p));
    const submitted = each.reduce((n, p) => n + p.submitted, 0);
    const possible = each.reduce((n, p) => n + p.possible, 0);
    return { submitted, possible, complete: each.every((p) => p.complete), blockedBy: each[0].blockedBy };
  }
  const { entries, blockedBy } = roundPool(board, round.id);
  const judgeIds = new Set(judgesFor(board, round).map((j) => j.id));
  const entryIds = new Set(entries.map((e) => e.id));
  const submitted = board.scores.filter((s) => s.roundId === round.id && judgeIds.has(s.judgeId) && entryIds.has(s.entryId)).length;
  const possible = judgeIds.size * entryIds.size;
  return { submitted, possible, complete: possible > 0 && submitted === possible, blockedBy };
}

/** A whole pageant's progress: every sub-activity's scores in, out of every judge scoring every candidate in it. */
export function programProgress(board: Board): { submitted: number; possible: number; complete: boolean } {
  let submitted = 0;
  let possible = 0;
  for (const round of judgingOrder(board.rounds)) {
    const p = roundProgress(board, round);
    submitted += p.submitted;
    // A sub-activity after an unconfirmed cut will judge at most the cut's size.
    const panel = judgesFor(board, round).length;
    possible += p.blockedBy ? Math.min(p.blockedBy.cutSize ?? 0, p.possible / Math.max(1, panel)) * panel : p.possible;
  }
  return { submitted, possible, complete: possible > 0 && submitted === possible };
}

/** Every preliminary sub-activity (and part) has all its scores in, so pageant proper can start. */
export function preliminaryComplete(board: Board): boolean {
  return judgingOrder(board.rounds)
    .filter((r) => r.segment === "preliminary")
    .every((r) => roundProgress(board, r).complete);
}

/** Pageant proper waits for the preliminary: none of its sub-activities can be judged until every preliminary score is in. */
export const waitsForPreliminary = (board: Board, round: Pick<Round, "segment">) => round.segment === "proper" && !preliminaryComplete(board);

/**
 * How many scores a judge gives in the whole pageant: one per candidate in each sub-activity (or part) on their panel.
 * A sub-activity after an unconfirmed cut counts the cut's size.
 */
export function expectedScores(board: Board, judge: Judge): number {
  return judgingOrder(board.rounds)
    .filter((r) => onPanel(judge, r))
    .reduce((n, r) => {
      const { entries, blockedBy } = roundPool(board, r.id);
      return n + (blockedBy ? Math.min(blockedBy.cutSize ?? 0, entries.length) : entries.length);
    }, 0);
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
  /**
   * Points taken off the total for the candidate's deductions: their points off the preliminary score, counting as
   * much as the preliminary does here (2 points, with the preliminary at 40%, take 0.8 off). 0 for none.
   */
  deducted: number;
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

/**
 * A candidate's average in a sub-activity as a percentage of its maximum (9.5 of 10 → 95), from the scores in so far.
 * A sub-activity with parts: its parts' percentages weighted by their shares, once each part has a score; `count` is
 * then the fewest judges who have scored any one part.
 */
function percentOf(round: Round, entryId: string, scores: Score[], judgeIds: Set<string>, rounds: Round[]): { percent: number | null; count: number } {
  const parts = partsOf(rounds, round.id);
  if (parts.length) {
    const each = parts.map((p) => ({ weight: p.weight, ...percentOf(p, entryId, scores, judgeIds, rounds) }));
    const total = each.reduce((n, p) => n + p.weight, 0);
    const count = Math.min(...each.map((p) => p.count));
    if (total <= 0 || each.some((p) => p.percent === null)) return { percent: null, count };
    return { percent: each.reduce((n, p) => n + (p.weight * p.percent!) / total, 0), count };
  }
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
  // Deductions come off the preliminary score, so they count for as much as the preliminary does here: all of it
  // on the preliminary's own standings, its share in a cut that counts it with pageant proper, nothing in one that doesn't.
  const prelimShare = weights.filter((w) => w.round.segment === "preliminary").reduce((n, w) => n + w.weight, 0);
  const deduct = new Map([...deductionTotals(board.deductions)].map(([id, points]) => [id, (points * prelimShare) / 100]));
  return standingsBy(board, entries, weights, deduct);
}

/** Each candidate's deductions added up, in points off their preliminary score. */
export function deductionTotals(deductions: Deduction[] | undefined): Map<string, number> {
  const totals = new Map<string, number>();
  for (const d of deductions ?? []) totals.set(d.entryId, Math.round(((totals.get(d.entryId) ?? 0) + d.points) * 100) / 100);
  return totals;
}

/**
 * Whether deductions can still be added or taken back: the pageant has them, the session isn't over, and pageant
 * proper hasn't started (no score in it yet), since its first cut can count the preliminary.
 */
export function deductionsOpen(board: Board): boolean {
  if (board.activity.violations === null || board.activity.sessionState === "ended") return false;
  const proper = new Set(board.rounds.filter((r) => unitOf(board.rounds, r).segment === "proper").map((r) => r.id));
  return !board.scores.some((s) => s.roundId && proper.has(s.roundId));
}

/** A sub-activity's parts as weights adding up to 100, for its own standings sheet. */
export function partWeights(rounds: Round[], round: Round): { round: Round; weight: number }[] {
  const parts = partsOf(rounds, round.id);
  const total = parts.reduce((n, p) => n + p.weight, 0);
  return parts.map((p) => ({ round: p, weight: total > 0 ? (100 * p.weight) / total : 0 }));
}

/**
 * Candidates ranked by sub-activities (or parts) with the given weights, in percent. See standings. `deduct`: points
 * to take off each candidate's total (by entry id); a total never goes below 0.
 */
export function standingsBy(
  board: Board,
  entries: Entry[],
  weights: { round: Round; weight: number }[],
  deduct: Map<string, number> = new Map(),
): { weights: { round: Round; weight: number }[]; rows: StandingRow[]; complete: boolean } {
  // Each sub-activity counts its own panel's judges: the preliminary can have its own set.
  const panels = new Map(weights.map(({ round }) => [round.id, new Set(judgesFor(board, round).map((j) => j.id))]));
  const places = board.activity.resultDecimals;

  const rows: StandingRow[] = entries.map((entry, i) => {
    const parts = new Map<string, number | null>();
    let sum = 0;
    let scored = true;
    let complete = true;
    for (const { round, weight } of weights) {
      const judgeIds = panels.get(round.id)!;
      const { percent, count } = percentOf(round, entry.id, board.scores, judgeIds, board.rounds);
      parts.set(round.id, percent);
      if (percent === null) scored = false;
      else sum += (weight * percent) / 100;
      if (judgeIds.size === 0 || count < judgeIds.size) complete = false;
    }
    const deducted = deduct.get(entry.id) ?? 0;
    const total = scored && weights.length ? roundTo(Math.max(0, sum - deducted), places) : null;
    return { entry, deducted, number: entry.number ?? i + 1, parts, total, rank: null, complete };
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

/** How long a judge can undo a score after submitting it, before it goes to the server (events and pageants alike). */
export const SCORE_UNDO_MS = 5_000;

/** A score submitted just as time ran out still counts, if it arrives within this margin: the undo window and two seconds for the network. */
export const SUBMIT_GRACE_MS = SCORE_UNDO_MS + 2_000;

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
