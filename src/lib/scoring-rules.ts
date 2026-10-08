import type { ScoreRules } from "./scoring";
import type { CriteriaDisplay, Criterion, Decimals, ScoringMode } from "./types";

/** How judges score, as typed into a form: an event's scoring, or one pageant sub-activity's. */
export type ScoringInput = {
  mode: ScoringMode;
  min: string;
  max: string;
  decimals: number;
  criteria: { id?: unknown; name?: unknown; max?: unknown }[];
  display: CriteriaDisplay | null;
};

export type Scoring = { mode: ScoringMode; rules: ScoreRules; criteria: Criterion[]; display: CriteriaDisplay | null };

export const MAX_CRITERIA = 20;

function checkRange(minText: string, maxText: string, decimals: Decimals): { rules: ScoreRules } | { error: string } {
  const number = /^\d{1,4}(\.\d{1,2})?$/;
  if (!number.test(minText.trim()) || !number.test(maxText.trim())) return { error: "Min and max must be numbers from 0 to 9999." };
  const places = (t: string) => t.trim().split(".")[1]?.length ?? 0;
  if (places(minText) > decimals || places(maxText) > decimals) {
    return {
      error:
        decimals === 0
          ? "Whole-number scoring needs a whole-number min and max."
          : `Min and max can have at most ${decimals} decimal place${decimals > 1 ? "s" : ""}.`,
    };
  }
  const min = Number(minText);
  const max = Number(maxText);
  if (max <= min) return { error: "Max score must be higher than min score." };
  return { rules: { min, max, decimals } };
}

/**
 * Simple scoring (min to max) or criteria (max points per criterion, adding up to 100; judges' totals are then out
 * of 100). Criteria keep their ids across edits so stored breakdowns still line up; new ones get `newId()`.
 * Shared by the server, which decides, and the create forms, which check before sending.
 */
export function checkScoring(input: ScoringInput, newId: () => string): { scoring: Scoring } | { error: string } {
  const decimals = input.decimals;
  if (decimals !== 0 && decimals !== 1 && decimals !== 2) return { error: "Choose how many decimal places judges can use." };
  if (input.mode !== "criteria") {
    const parsed = checkRange(input.min, input.max, decimals);
    return "error" in parsed ? parsed : { scoring: { mode: "simple", rules: parsed.rules, criteria: [], display: input.display } };
  }

  const raw = input.criteria;
  if (raw.length === 0) return { error: "Add at least one criterion." };
  if (raw.length > MAX_CRITERIA) return { error: `An activity can have up to ${MAX_CRITERIA} criteria.` };
  const criteria: Criterion[] = [];
  const names = new Set<string>();
  for (const item of raw) {
    const name = String(item?.name ?? "")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 60);
    const max = Number(item?.max);
    if (!name) return { error: "Every criterion needs a name." };
    if (names.has(name.toLowerCase())) return { error: `"${name}" is listed twice. Give each criterion its own name.` };
    if (!Number.isInteger(max) || max < 1 || max > 100) return { error: `Give ${name} a max of 1 to 100 points.` };
    names.add(name.toLowerCase());
    const id = typeof item?.id === "string" && /^[a-z0-9]{1,40}$/.test(item.id) ? item.id : newId();
    criteria.push({ id, name, max });
  }
  const total = criteria.reduce((sum, c) => sum + c.max, 0);
  if (total !== 100) return { error: `The criteria add up to ${total} points. They must add up to 100.` };
  return { scoring: { mode: "criteria", rules: { min: 0, max: 100, decimals }, criteria, display: input.display } };
}
