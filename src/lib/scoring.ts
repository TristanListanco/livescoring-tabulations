import type { Activity, Board, Criterion, Decimals, Entry, Judge, Score } from "./types";

/** What changes how results are shown: the scoring mode, how criteria totals are shown, and decimal places. */
export type DisplayRules = Pick<Activity, "scoringMode" | "criteriaDisplay" | "decimals" | "resultDecimals">;

export type ScoreRules = { min: number; max: number; decimals: Decimals };

export type Key = "0" | "1" | "2" | "3" | "4" | "5" | "6" | "7" | "8" | "9" | "." | "back" | "clear";

export function formatScore(value: number, decimals: number): string {
  return value.toFixed(decimals);
}

/** Show a range bound without trailing zeros, e.g. 1 or 9.5. */
export function formatBound(value: number): string {
  return String(Number(value.toFixed(2)));
}

function integerDigits(max: number): number {
  return String(Math.trunc(max)).length;
}

/** Apply one keypad press to the typed score. Keys that would make an impossible number are ignored. */
export function applyKey(buffer: string, key: Key, rules: ScoreRules): string {
  if (key === "clear") return "";
  if (key === "back") return buffer.slice(0, -1);

  if (key === ".") {
    if (rules.decimals === 0 || buffer.includes(".")) return buffer;
    return buffer === "" ? "0." : `${buffer}.`;
  }

  const [int, frac] = buffer.split(".");
  if (frac !== undefined) {
    return frac.length >= rules.decimals ? buffer : buffer + key;
  }
  const next = int === "0" ? key : int + key;
  return next.length > integerDigits(rules.max) ? buffer : next;
}

export type ParsedScore = { ok: true; value: number } | { ok: false; error: string };

/**
 * Whether a typed score is already above the max. More digits can only make it bigger, so judges are told
 * straight away instead of when they try to submit.
 */
export function overMax(input: string, rules: Pick<ScoreRules, "max">): boolean {
  const text = input.trim();
  return /^\d+(\.\d*)?$/.test(text) && Math.round(Number(text) * 100) > Math.round(rules.max * 100);
}

export function overMaxMessage(input: string, rules: Pick<ScoreRules, "max">): string {
  return `${input} is above the maximum of ${formatBound(rules.max)}.`;
}

export function rangeLabel(rules: ScoreRules): string {
  return `${formatBound(rules.min)} to ${formatBound(rules.max)}`;
}

/** Validate a typed score against the activity's range and decimal places. */
export function parseScore(input: string, rules: ScoreRules): ParsedScore {
  const text = input.trim();
  if (text === "" || text === ".") return { ok: false, error: "Enter a score first." };
  if (!/^\d+(\.\d*)?$/.test(text)) return { ok: false, error: "Scores can only contain digits and one decimal point." };

  const frac = text.split(".")[1] ?? "";
  if (frac.length > rules.decimals) {
    return {
      ok: false,
      error: rules.decimals === 0 ? "Use a whole number." : `Use at most ${rules.decimals} decimal place${rules.decimals > 1 ? "s" : ""}.`,
    };
  }

  const hundredths = Math.round(Number(text) * 100);
  if (hundredths < Math.round(rules.min * 100) || hundredths > Math.round(rules.max * 100)) {
    return { ok: false, error: `Enter a score from ${rangeLabel(rules)}.` };
  }
  return { ok: true, value: hundredths / 100 };
}

export type RankedRow = {
  entry: Entry;
  number: number;
  scores: Map<string, number>;
  count: number;
  /**
   * The average as the audience sees it: rounded to the results' decimal places, and for criteria shown
   * scaled to 10, already divided by 10. Ranks compare this, so ties match what is displayed.
   */
  average: number | null;
  rank: number | null;
};

/** Criteria totals shown "scaled to 10" are the total out of 100 divided by 10. */
function shownDivisor(rules: DisplayRules): number {
  return rules.scoringMode === "criteria" && rules.criteriaDisplay === "ten" ? 10 : 1;
}

/**
 * numerator ÷ denominator rounded half up to `places` decimals. Called with whole numbers (sums of scores in
 * hundredths), so a value exactly halfway between two results always rounds up, whatever the float error.
 */
function roundShown(numerator: number, denominator: number, places: number): number {
  return Math.round((numerator * 10 ** places) / denominator) / 10 ** places;
}

/**
 * Rank entries by the average of the scores submitted so far.
 * Ties share a rank (1, 1, 3). Unscored entries go last, unranked, in entry order.
 */
export function rankEntries(entries: Entry[], judges: Judge[], scores: Score[], rules: DisplayRules): RankedRow[] {
  const divisor = shownDivisor(rules);
  const judgeIds = new Set(judges.map((j) => j.id));
  const ordered = [...entries].sort((a, b) => a.position - b.position);

  const rows: RankedRow[] = ordered.map((entry, index) => {
    const mine = new Map<string, number>();
    let sum = 0;
    for (const s of scores) {
      if (s.entryId !== entry.id || !judgeIds.has(s.judgeId)) continue;
      mine.set(s.judgeId, s.value);
      sum += Math.round(s.value * 100);
    }
    const count = mine.size;
    return {
      entry,
      number: entry.number ?? index + 1,
      scores: mine,
      count,
      average: count ? roundShown(sum, 100 * count * divisor, rules.resultDecimals) : null,
      rank: null,
    };
  });

  rows.sort((a, b) => {
    if (a.average === null || b.average === null) {
      if (a.average !== b.average) return a.average === null ? 1 : -1;
      return a.number - b.number;
    }
    return b.average - a.average || a.number - b.number;
  });

  rows.forEach((row, i) => {
    if (row.average === null) return;
    const prev = rows[i - 1];
    row.rank = prev && prev.average === row.average ? prev.rank : i + 1;
  });
  return rows;
}

/** How many of the expected scores (every judge × every entry) are in. */
export function scoreProgress(board: Board): { submitted: number; possible: number; complete: boolean } {
  const judgeIds = new Set(board.judges.map((j) => j.id));
  const entryIds = new Set(board.entries.map((e) => e.id));
  const submitted = board.scores.filter((s) => judgeIds.has(s.judgeId) && entryIds.has(s.entryId)).length;
  const possible = judgeIds.size * entryIds.size;
  return { submitted, possible, complete: possible > 0 && submitted === possible };
}

// Display -------------------------------------------------------------------------------

const percentSign = (rules: DisplayRules) => (rules.scoringMode === "criteria" && rules.criteriaDisplay !== "ten" ? "%" : "");

/**
 * One judge's score as the audience sees it. Simple mode: the score exactly as the judge entered it.
 * Criteria mode: the total out of 100 with the results' decimal places, as a percentage ("87.50%") or
 * scaled to 10 ("8.75").
 */
export function scoreText(value: number, rules: DisplayRules): string {
  if (rules.scoringMode !== "criteria") return formatScore(value, rules.decimals);
  const shown = roundShown(Math.round(value * 100), 100 * shownDivisor(rules), rules.resultDecimals);
  return `${shown.toFixed(rules.resultDecimals)}${percentSign(rules)}`;
}

/** An average from rankEntries as the audience sees it. */
export function averageText(average: number | null, rules: DisplayRules): string {
  return average === null ? "—" : `${average.toFixed(rules.resultDecimals)}${percentSign(rules)}`;
}

/** One line describing how the activity is scored, for headers and the PDF. */
export function rulesSummary(activity: Pick<Activity, "scoringMode" | "criteria" | "criteriaDisplay" | "min" | "max" | "decimals">): string {
  if (activity.scoringMode !== "criteria") {
    const places = activity.decimals === 0 ? "whole numbers" : `${activity.decimals} decimal place${activity.decimals > 1 ? "s" : ""}`;
    return `Scores from ${rangeLabel(activity)}, ${places}.`;
  }
  const list = activity.criteria.map((c) => `${c.name} ${formatBound(c.max)}`).join(", ");
  const shown = activity.criteriaDisplay === "ten" ? "scaled to 10" : "as a percentage";
  return `Criteria: ${list}. Totals out of 100, shown ${shown}.`;
}

/** Criteria mode: points per criterion → total, or an error. Each value is checked against its criterion's max. */
export function parseBreakdown(
  typed: Record<string, string>,
  criteria: Criterion[],
  decimals: Decimals,
): { ok: true; total: number; breakdown: Record<string, number> } | { ok: false; error: string } {
  const breakdown: Record<string, number> = {};
  let hundredths = 0;
  for (const c of criteria) {
    const parsed = parseScore(typed[c.id] ?? "", { min: 0, max: c.max, decimals });
    if (!parsed.ok) return { ok: false, error: `${c.name}: ${parsed.error}` };
    breakdown[c.id] = parsed.value;
    hundredths += Math.round(parsed.value * 100);
  }
  return { ok: true, total: hundredths / 100, breakdown };
}
