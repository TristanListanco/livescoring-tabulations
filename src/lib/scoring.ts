import type { Board, Decimals, Entry, Judge, Score } from "./types";

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
  /** Average in hundredths, rounded, so ties match what is displayed. */
  averageHundredths: number | null;
  rank: number | null;
};

export function formatAverage(hundredths: number | null): string {
  return hundredths === null ? "—" : (hundredths / 100).toFixed(2);
}

/**
 * Rank entries by the average of the scores submitted so far.
 * Ties share a rank (1, 1, 3). Unscored entries go last, unranked, in entry order.
 */
export function rankEntries(entries: Entry[], judges: Judge[], scores: Score[]): RankedRow[] {
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
      number: index + 1,
      scores: mine,
      count,
      averageHundredths: count ? Math.round(sum / count) : null,
      rank: null,
    };
  });

  rows.sort((a, b) => {
    if (a.averageHundredths === null || b.averageHundredths === null) {
      if (a.averageHundredths !== b.averageHundredths) return a.averageHundredths === null ? 1 : -1;
      return a.number - b.number;
    }
    return b.averageHundredths - a.averageHundredths || a.number - b.number;
  });

  rows.forEach((row, i) => {
    if (row.averageHundredths === null) return;
    const prev = rows[i - 1];
    row.rank = prev && prev.averageHundredths === row.averageHundredths ? prev.rank : i + 1;
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
