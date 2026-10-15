import { partsOf, programOrder } from "./pageant";
import { checkScoring, type Scoring } from "./scoring-rules";
import { PRELIMINARY, type CriteriaDisplay, type Decimals, type JudgePanel, type Round, type ScoringMode, type Segment, type Violation } from "./types";

/**
 * A pageant's program as the setup form holds it: the preliminary segment's share, and every sub-activity with its
 * scoring, timer and cut. Shared by the browser, which checks each step, and the server, which decides.
 */
/** min: the lowest score judges can give it, in points (e.g. 28 of 40, as a score sheet's "lowest possible score"); blank for none. */
/** guide: what judges should look for, as typed (see cleanGuide). */
export type CriterionDraft = { key: number; id: string; name: string; max: string; min: string; guide: string };
export type ScoringDraft = {
  mode: ScoringMode;
  min: string;
  max: string;
  decimals: Decimals;
  criteria: CriterionDraft[];
  display: CriteriaDisplay;
};
/** A part of a sub-activity (e.g. the Q&A of a closed-door interview): its own scoring, timer and share of the sub-activity. */
export type PartDraft = {
  key: string;
  name: string;
  /** Percent of the overall score, like the sub-activity's: the parts of a 20% interview add up to 20. */
  weight: string;
  scoring: ScoringDraft;
  timer: string;
};
export type RoundDraft = {
  /** A saved sub-activity's id, or a key the form made up for a new one. Cut bases refer to sub-activities by it. */
  key: string;
  segment: Segment;
  name: string;
  /**
   * Percent of the overall score, as score sheets write it: the preliminary's add up to the preliminary's share
   * (e.g. 40). A sub-activity in parts counts for its parts added up.
   */
  weight: string;
  scoring: ScoringDraft;
  /** Seconds to score each candidate; blank for no timer. */
  timer: string;
  /** Pageant proper only. The last pageant proper sub-activity always has the final cut. */
  cut: boolean;
  cutSize: string;
  /** What ranks the cut (PRELIMINARY and round keys); null until the organizer changes it, so it follows the default. */
  cutBasis: string[] | null;
  /** Its parts, each scored on its own, or null when judges score the sub-activity itself (with `scoring` and `timer`). */
  parts: PartDraft[] | null;
};
/** A violation the organizer can deduct points for, as typed: e.g. "Late for call time", "1". `id`: a saved one's, or "". */
export type ViolationDraft = { key: string; id: string; reason: string; points: string };
/** `violations`: the deductions for violations, or null (or missing) when the pageant has none. */
export type PageantDraft = { preliminaryWeight: string; rounds: RoundDraft[]; violations?: ViolationDraft[] | null };

export type CheckedRound = {
  key: string;
  segment: Segment;
  name: string;
  position: number;
  weight: number;
  scoring: Scoring;
  timerSeconds: number | null;
  cutSize: number | null;
  /** PRELIMINARY and round keys. */
  cutBasis: string[];
  /** Its parts, in order; empty when judges score the sub-activity itself. */
  parts: CheckedPart[];
};
export type CheckedPart = { key: string; name: string; position: number; weight: number; scoring: Scoring; timerSeconds: number | null };

export const MAX_ROUNDS = 20;
export const MAX_VIOLATIONS = 20;
export const MAX_REASON = 80;
/** The most a deduction (or a violation) can take off a preliminary score out of 100. */
export const MAX_DEDUCTION = 100;

/**
 * Points for a deduction, as typed: more than 0, up to MAX_DEDUCTION, with at most 2 decimal places. NaN otherwise.
 */
export function deductionPoints(text: string): number {
  const t = text.trim();
  if (!/^\d{1,3}(\.\d{1,2})?$/.test(t)) return NaN;
  const n = Number(t);
  return n > 0 && n <= MAX_DEDUCTION ? n : NaN;
}
export const MAX_PARTS = 10;
export const MAX_ROUND_NAME = 60;

export const blankScoring = (): ScoringDraft => ({ mode: "simple", min: "1", max: "10", decimals: 2, criteria: [], display: "percent" });

export const segmentLabel = (segment: Segment) => (segment === "preliminary" ? "Preliminary" : "Pageant proper");

/** Pageant proper is judged by at least this many judges; the preliminary by at least one. */
export const MIN_PROPER_JUDGES = 3;

/** Why a pageant's judges can't run it: no one judges the preliminary, or fewer than three judge pageant proper. */
export function panelGap(panels: JudgePanel[]): string | null {
  if (!panels.some((p) => p !== "proper")) return "The preliminary needs at least one judge. Set a judge to judge both segments or the preliminary.";
  if (panels.filter((p) => p !== "preliminary").length < MIN_PROPER_JUDGES) {
    return "Pageant proper needs at least three judges. Set judges to judge both segments or pageant proper, or add judges.";
  }
  return null;
}

/**
 * Why a pageant's chairs don't work: each segment needs exactly one chair among the judges who judge it. One
 * board has one chair for both; separate boards have one each.
 */
export function chairGap(judges: { panel: JudgePanel; isChair: boolean }[]): string | null {
  const separate = judges.some((j) => j.panel !== "all");
  for (const segment of ["preliminary", "proper"] as const) {
    const chairs = judges.filter((j) => j.isChair && (j.panel === "all" || j.panel === segment)).length;
    const board = separate ? `the ${segment === "preliminary" ? "preliminary" : "pageant proper"} board of judges` : "the board of judges";
    if (chairs === 0) return `Choose the chair of ${board}.`;
    if (chairs > 1) return `Choose one chair for ${board}.`;
  }
  return null;
}

/**
 * Criteria rows as the server checks them: blank rows dropped, and each criterion's lowest score in points (0 when
 * it's blank). A lowest score that isn't a number is sent as NaN, which the check refuses with the criterion's name.
 */
export function criteriaForCheck(criteria: CriterionDraft[]): { id: string; name: string; max: string; min: number; guide: string }[] {
  return criteria
    .filter((c) => c.name.trim() || c.max.trim())
    .map((c) => ({
      id: c.id,
      name: c.name,
      max: c.max,
      min: c.min.trim() === "" ? 0 : /^\d{1,3}(\.\d{1,2})?$/.test(c.min.trim()) ? Number(c.min) : NaN,
      guide: c.guide ?? "",
    }));
}

/** What a lowest-score field accepts as it's typed: digits and one decimal point, up to 2 decimal places. */
export function typedLowest(text: string): string {
  const [whole = "", ...rest] = text.replace(/[^0-9.]/g, "").split(".");
  return rest.length ? `${whole.slice(0, 3)}.${rest.join("").slice(0, 2)}` : whole.slice(0, 3);
}

/** A share as typed: a percentage of the overall score with up to two decimal places, or NaN. */
export function parseShare(text: string): number {
  return /^\d{1,3}(\.\d{1,2})?$/.test(text.trim()) ? Number(text) : NaN;
}

/** A share for a field: "20", "13.33". */
export const shareText = (n: number) => String(Math.round(n * 100) / 100);

/** What a share field accepts as it's typed: digits and one decimal point, up to two decimal places. */
export function typedShare(text: string): string {
  const [whole = "", ...rest] = text.replace(/[^0-9.]/g, "").split(".");
  return rest.length ? `${whole.slice(0, 3)}.${rest.join("").slice(0, 2)}` : whole.slice(0, 3);
}

/** A segment's percentage of the overall score (the preliminary's, or pageant proper's: the rest), or null while unset. */
export function segmentShare(draft: PageantDraft, segment: Segment): number | null {
  const prelim = whole(draft.preliminaryWeight);
  if (!(prelim >= 1 && prelim <= 99)) return null;
  return segment === "preliminary" ? prelim : 100 - prelim;
}

/** What a sub-activity counts for in the overall score: its share, or its parts' shares added up. */
export function roundShare(round: Pick<RoundDraft, "weight" | "parts">): number {
  return round.parts ? round.parts.reduce((n, p) => n + (parseShare(p.weight) || 0), 0) : parseShare(round.weight) || 0;
}

/** `total` split into `count` shares as evenly as they come: whole numbers when they can be (40 → 14, 13, 13), else hundredths. */
export function evenShares(total: number, count: number): string[] {
  if (count <= 0) return [];
  const unit = Number.isInteger(total) && total >= count ? 1 : 0.01;
  const units = Math.round(total / unit);
  const base = Math.floor(units / count);
  return Array.from({ length: count }, (_, i) => shareText((base + (i < units - base * count ? 1 : 0)) * unit));
}

/** Shares scaled from one total to another, keeping their proportions and adding up exactly: 10 and 20 of 30 → 13.33 and 26.67 of 40. */
export function rescaleShares(shares: string[], to: number): string[] {
  const from = shares.reduce((n, w) => n + (parseShare(w) || 0), 0);
  if (from <= 0) return shares;
  const scaled = shares.map((w) => Math.round(((parseShare(w) || 0) * to * 100) / from) / 100);
  // Whatever rounding loses goes to the largest share, so the total stays exact.
  const drift = Math.round((to - scaled.reduce((n, x) => n + x, 0)) * 100) / 100;
  const largest = scaled.indexOf(Math.max(...scaled));
  if (drift) scaled[largest] = Math.round((scaled[largest] + drift) * 100) / 100;
  return scaled.map(shareText);
}

/**
 * The share a new sub-activity (or part) starts with: what's left of `target` (its segment's percentage). When
 * nothing is left, `target` is split evenly instead, so adding one never leaves the total off. `shares` are the
 * current ones, in order; returns them updated, with the new one last.
 */
export function sharesWithOneMore(shares: string[], target: number): { shares: string[]; evened: boolean } {
  const used = shares.reduce((n, w) => n + (parseShare(w) || 0), 0);
  const left = Math.round((target - used) * 100) / 100;
  if (left > 0) return { shares: [...shares, shareText(left)], evened: false };
  return { shares: evenShares(target, shares.length + 1), evened: true };
}

/** Pageant proper sub-activities in order; the last one has the final cut. */
const properOf = (rounds: RoundDraft[]) => rounds.filter((r) => r.segment === "proper");

/** Whether this sub-activity ends with a cut: one the organizer added, or the final cut on the last pageant proper one. */
export function hasCut(rounds: RoundDraft[], round: RoundDraft): boolean {
  if (round.segment !== "proper") return false;
  const proper = properOf(rounds);
  return round.cut || proper[proper.length - 1]?.key === round.key;
}

/**
 * Pageant proper in stages: the sub-activities up to and including the first cut, then those after each cut up to
 * the next one. Scores start over after a cut: a later stage counts only its own sub-activities, whose shares add
 * up to 100%. (The last stage ends with the final cut.)
 */
export function properStages(rounds: RoundDraft[]): RoundDraft[][] {
  const stages: RoundDraft[][] = [];
  let stage: RoundDraft[] = [];
  for (const round of properOf(rounds)) {
    stage.push(round);
    if (hasCut(rounds, round)) {
      stages.push(stage);
      stage = [];
    }
  }
  if (stage.length) stages.push(stage);
  return stages;
}

/** Which stage of pageant proper a sub-activity is in, 0 until the first cut; null in the preliminary. */
export function stageOf(rounds: RoundDraft[], round: Pick<RoundDraft, "key" | "segment">): number | null {
  if (round.segment !== "proper") return null;
  const index = properStages(rounds).findIndex((stage) => stage.some((r) => r.key === round.key));
  return index < 0 ? null : index;
}

/**
 * A sub-activity alone between two cuts: scores start over after the first, so it counts for all of its stage, 100%.
 * The setup asks no share for it.
 */
export function aloneAfterCut(rounds: RoundDraft[], round: Pick<RoundDraft, "key" | "segment">): boolean {
  const stage = stageOf(rounds, round);
  return !!stage && properStages(rounds)[stage].length === 1;
}

/**
 * What a sub-activity's share is a share of, as the setup words it: "of the overall score" in the preliminary and
 * pageant proper's first stage, "of the score after the Top 5 cut" after one.
 */
export function shareScope(rounds: RoundDraft[], round: Pick<RoundDraft, "key" | "segment">): string {
  const stage = stageOf(rounds, round);
  return stage ? `of the score ${afterCut(properStages(rounds)[stage - 1].at(-1)!)}` : "of the overall score";
}

/** "after the Top 5 cut", or before the cut has a size, "after Swimsuit's cut". */
export function afterCut(cut: RoundDraft): string {
  return /^\d+$/.test(cut.cutSize.trim()) ? `after the Top ${Number(cut.cutSize)} cut` : `after ${cut.name.trim() || "the"}${cut.name.trim() ? "'s" : ""} cut`;
}

/**
 * What a group of shares adds up to: the preliminary's share of the overall score; pageant proper's for its first
 * stage; 100% for each stage after a cut, as scores start over there. Null while the preliminary's share is unset.
 */
export function stageTarget(draft: PageantDraft, segment: Segment, stage: number | null): number | null {
  if (segment === "proper" && stage) return 100;
  return segmentShare(draft, segment);
}

/** The groups whose shares add up to a target: the preliminary, then pageant proper's stages. */
export function shareGroups(draft: PageantDraft): { segment: Segment; stage: number | null; rounds: RoundDraft[]; target: number | null }[] {
  const preliminary = draft.rounds.filter((r) => r.segment === "preliminary");
  return [
    { segment: "preliminary" as const, stage: null, rounds: preliminary, target: segmentShare(draft, "preliminary") },
    ...properStages(draft.rounds).map((rounds, stage) => ({ segment: "proper" as const, stage, rounds, target: stageTarget(draft, "proper", stage) })),
  ];
}

/**
 * The program with every group's shares scaled to add up to its target, keeping their proportions, and each
 * sub-activity's parts to its share. Used when cuts come or go (so stages change) and for programs saved under
 * older rules. A group with a share still blank is left alone.
 */
export function fitShares(draft: PageantDraft): PageantDraft {
  const shares = new Map<string, string>();
  for (const group of shareGroups(draft)) {
    // Alone after a cut: always 100%, whatever was there.
    if (group.stage && group.rounds.length === 1 && !group.rounds[0].parts) {
      shares.set(group.rounds[0].key, "100");
      continue;
    }
    const own = group.rounds.map((r) => shareText(roundShare(r)));
    const total = group.rounds.reduce((n, r) => n + roundShare(r), 0);
    if (group.target === null || !group.rounds.every((r) => roundShare(r) > 0) || Math.round(total * 100) === group.target * 100) continue;
    rescaleShares(own, group.target).forEach((w, i) => shares.set(group.rounds[i].key, w));
  }
  const rounds = draft.rounds.map((r) => {
    const share = shares.get(r.key) ?? (r.parts ? shareText(roundShare(r)) : r.weight);
    if (!r.parts) return shares.has(r.key) ? { ...r, weight: share } : r;
    const parts = r.parts.every((p) => parseShare(p.weight) > 0) ? rescaleShares(r.parts.map((p) => p.weight), parseShare(share)) : r.parts.map((p) => p.weight);
    return { ...r, weight: share, parts: r.parts.map((p, i) => ({ ...p, weight: parts[i] })) };
  });
  return { ...draft, rounds };
}

/**
 * Sub-activities a cut can count: its own stage, since scores start over after a cut. The first cut can also count
 * the preliminary, which keeps its share of the overall score.
 */
export function basisChoices(rounds: RoundDraft[], round: RoundDraft): { key: string; label: string }[] {
  const stage = stageOf(rounds, round) ?? 0;
  const proper = properOf(rounds);
  const label = (r: RoundDraft) => r.name.trim() || `Sub-activity ${proper.indexOf(r) + 1}`;
  const own = (properStages(rounds)[stage] ?? []).map((r) => ({ key: r.key, label: label(r) }));
  return stage === 0 ? [{ key: PRELIMINARY, label: "Preliminary" }, ...own] : own;
}

/** What ranks a cut until the organizer changes it: everything it can count. */
export const defaultBasis = (rounds: RoundDraft[], round: RoundDraft): string[] => basisChoices(rounds, round).map((c) => c.key);

/** The cut's basis as it stands: the organizer's choice (within what it can count), or the default. */
export function basisOf(rounds: RoundDraft[], round: RoundDraft): string[] {
  if (!round.cutBasis) return defaultBasis(rounds, round);
  const allowed = new Set(basisChoices(rounds, round).map((c) => c.key));
  return round.cutBasis.filter((k) => allowed.has(k));
}

const whole = (text: string) => (/^\d{1,4}$/.test(text.trim()) ? Number(text) : NaN);

/** Scoring for a sub-activity that only holds parts: never used to score. */
const PLACEHOLDER_SCORING: Scoring = { mode: "simple", rules: { min: 0, max: 100, decimals: 0 }, criteria: [], display: "percent" };

/** A sub-activity's or part's scoring and timer, checked. `name` starts its error messages. */
function checkScored(
  name: string,
  s: ScoringDraft,
  timer: string,
  newId: () => string,
): { scoring: Scoring; timerSeconds: number | null } | { error: string; input: "scoring" | "timer" } {
  // Rows left completely blank are ignored, as on the event form.
  const criteria = criteriaForCheck(s.criteria);
  const parsed = checkScoring({ mode: s.mode, min: s.min, max: s.max, decimals: s.decimals, criteria, display: s.display }, newId);
  if ("error" in parsed) return { error: `${name}: ${parsed.error}`, input: "scoring" };
  let timerSeconds: number | null = null;
  if (timer.trim() !== "") {
    timerSeconds = whole(timer);
    if (!(timerSeconds >= 5 && timerSeconds <= 3600)) return { error: `${name}: set the timer from 5 to 3600 seconds, or turn it off.`, input: "timer" };
  }
  return { scoring: parsed.scoring, timerSeconds };
}

/**
 * The field a program problem is about, for the setup to point at: the preliminary's share, or one field of a
 * sub-activity (or of one of its parts). Keys are the draft's.
 */
export type ProgramTarget =
  | { input: "preliminary" }
  | { input: "name" | "share" | "parts" | "scoring" | "timer" | "cut"; round: string; part?: string }
  | { input: "violation"; key: string; field: "reason" | "points" };

/**
 * The violations, checked: each with a reason and its points, no reason twice. Rows left completely blank are
 * ignored. Null when deductions are off. `newId` names new ones.
 */
export function checkViolations(
  drafts: ViolationDraft[] | null | undefined,
  newId: () => string,
): { ok: true; violations: Violation[] | null } | { ok: false; error: string; target?: ProgramTarget } {
  if (!drafts) return { ok: true, violations: null };
  const rows = drafts.filter((v) => v.reason.trim() || v.points.trim());
  if (rows.length > MAX_VIOLATIONS) return { ok: false, error: `List up to ${MAX_VIOLATIONS} violations. You can type others at the desk.` };
  const seen = new Set<string>();
  const violations: Violation[] = [];
  for (const [i, v] of rows.entries()) {
    const reason = v.reason.replace(/\s+/g, " ").trim();
    const at = (field: "reason" | "points"): ProgramTarget => ({ input: "violation", key: v.key, field });
    if (!reason) return { ok: false, error: `Name violation ${i + 1}, or clear its points.`, target: at("reason") };
    if (reason.length > MAX_REASON) return { ok: false, error: `Keep "${reason.slice(0, 20)}…" to ${MAX_REASON} characters.`, target: at("reason") };
    if (seen.has(reason.toLowerCase())) return { ok: false, error: `"${reason}" is listed twice. List each violation once.`, target: at("reason") };
    seen.add(reason.toLowerCase());
    const points = deductionPoints(v.points);
    if (Number.isNaN(points)) return { ok: false, error: `Give "${reason}" its points off the preliminary score, from 0.01 to ${MAX_DEDUCTION}.`, target: at("points") };
    violations.push({ id: v.id || newId(), reason, points });
  }
  return { ok: true, violations };
}

/**
 * Check a pageant's program. `candidates`: how many there are now, so each cut leaves fewer than the one before.
 * `newId` names new criteria (the server's; the browser passes one that returns "").
 * On failure, `segment` says which step of the setup to fix, and `target` (when there is one) which field.
 */
export function checkPageant(
  draft: PageantDraft,
  candidates: number,
  newId: () => string,
):
  | { ok: true; preliminaryWeight: number; rounds: CheckedRound[]; violations: Violation[] | null }
  | { ok: false; error: string; segment: Segment | null; target?: ProgramTarget } {
  const fail = (error: string, segment: Segment | null = null, target?: ProgramTarget) => ({ ok: false as const, error, segment, ...(target ? { target } : {}) });

  const preliminaryWeight = whole(draft.preliminaryWeight);
  if (!(preliminaryWeight >= 1 && preliminaryWeight <= 99)) {
    return fail("Give the preliminary a share of 1 to 99 percent. Pageant proper gets the rest.", "preliminary", { input: "preliminary" });
  }
  // Deductions are set up with the preliminary, whose score they come off.
  const deductions = checkViolations(draft.violations, newId);
  if (!deductions.ok) return fail(deductions.error, "preliminary", deductions.target);
  if (draft.rounds.length > MAX_ROUNDS) return fail(`A pageant can have up to ${MAX_ROUNDS} sub-activities.`);

  const names = new Set<string>();
  const checked: CheckedRound[] = [];
  for (const segment of ["preliminary", "proper"] as const) {
    const list = draft.rounds.filter((r) => r.segment === segment);
    const label = segment === "preliminary" ? "the preliminary" : "pageant proper";
    if (list.length === 0) return fail(`Add at least one sub-activity to ${label}.`, segment);

    // Pageant proper adds up stage by stage: its share of the overall score up to the first cut, then 100% after each.
    const stages = segment === "proper" ? properStages(draft.rounds) : [list];
    const totals = stages.map(() => 0);
    for (const round of list) {
      const name = round.name.replace(/\s+/g, " ").trim().slice(0, MAX_ROUND_NAME);
      const at = (input: "name" | "share" | "parts" | "scoring" | "timer" | "cut", part?: string): ProgramTarget => ({ input, round: round.key, ...(part ? { part } : {}) });
      if (!name) return fail(`Give every sub-activity in ${label} a name.`, segment, at("name"));
      if (names.has(name.toLowerCase())) return fail(`"${name}" is listed twice. Give each sub-activity its own name.`, segment, at("name"));
      names.add(name.toLowerCase());

      // A sub-activity in parts counts for its parts' shares added up; one alone after a cut, for all of its stage.
      const ownShare = segment === "proper" && aloneAfterCut(draft.rounds, round) ? 100 : parseShare(round.weight);
      const scope = segment === "proper" ? shareScope(draft.rounds, round) : "of the overall score";
      if (!round.parts && !(ownShare > 0 && ownShare <= 100)) return fail(`Give ${name} its share ${scope}, e.g. 20.`, segment, at("share"));

      // Judges score the sub-activity itself, or each of its parts.
      const own = checkScored(name, round.scoring, round.timer, newId);
      if ("error" in own && !round.parts) return fail(own.error, segment, at(own.input));
      const parts: CheckedPart[] = [];
      let partTotal = 0;
      if (round.parts) {
        if (round.parts.length < 2) return fail(`${name}: add at least two parts, or score it as a whole.`, segment, at("parts"));
        if (round.parts.length > MAX_PARTS) return fail(`${name}: a sub-activity can have up to ${MAX_PARTS} parts.`, segment, at("parts"));
        const partNames = new Set<string>();
        // Each part's share is of the same score as the sub-activity's: the parts of a 20% interview add up to 20.
        for (const part of round.parts) {
          const partName = part.name.replace(/\s+/g, " ").trim().slice(0, MAX_ROUND_NAME);
          if (!partName) return fail(`Give every part of ${name} a name.`, segment, at("name", part.key));
          if (partNames.has(partName.toLowerCase())) return fail(`${name} has two parts called "${partName}". Give each its own name.`, segment, at("name", part.key));
          partNames.add(partName.toLowerCase());
          const partWeight = parseShare(part.weight);
          if (!(partWeight > 0 && partWeight <= 100)) return fail(`Give ${name} · ${partName} its share ${scope}, e.g. 10.`, segment, at("share", part.key));
          partTotal += partWeight;
          const scored = checkScored(`${name} · ${partName}`, part.scoring, part.timer, newId);
          if ("error" in scored) return fail(scored.error, segment, at(scored.input, part.key));
          parts.push({ key: part.key, name: partName, position: parts.length, weight: partWeight, ...scored });
        }
      }
      const weight = round.parts ? Math.round(partTotal * 100) / 100 : ownShare;
      totals[Math.max(0, stages.findIndex((stage) => stage.includes(round)))] += weight;
      // A sub-activity with parts keeps a placeholder scoring of its own: only its parts are scored.
      const self = "error" in own ? { scoring: PLACEHOLDER_SCORING, timerSeconds: null } : own;
      checked.push({ key: round.key, segment, name, position: checked.length, weight, ...self, cutSize: null, cutBasis: [], parts });
    }
    for (const [stage, rounds] of stages.entries()) {
      const target = segment === "preliminary" ? preliminaryWeight : stage === 0 ? 100 - preliminaryWeight : 100;
      if (Math.round(totals[stage] * 100) === target * 100) continue;
      const added = `add up to ${shareText(totals[stage])}%`;
      const parts = rounds.some((r) => r.parts) ? " and their parts" : "";
      // Pointed at the group's first share: the first sub-activity's, or its first part's.
      const first = rounds[0];
      const share: ProgramTarget | undefined = first && { input: "share", round: first.key, ...(first.parts?.[0] ? { part: first.parts[0].key } : {}) };
      if (stage > 0) {
        return fail(
          `The sub-activities ${afterCut(stages[stage - 1].at(-1)!)}${parts} ${added}. Scores start over after a cut, so they must add up to 100%.`,
          segment,
          share,
        );
      }
      const segmentName = segment === "preliminary" ? "preliminary" : "pageant proper";
      const which = stages.length > 1 ? " up to the first cut" : "";
      return fail(
        `The ${segmentName} sub-activities${parts}${which} ${added}. They must add up to ${target}%, the ${segmentName}'s share of the overall score.`,
        segment,
        share,
      );
    }
  }

  // Cuts: each leaves fewer candidates than the one before; the final one decides the placements.
  const proper = draft.rounds.filter((r) => r.segment === "proper");
  let left = candidates;
  for (const [i, round] of proper.entries()) {
    if (!hasCut(draft.rounds, round)) continue;
    const target = checked.find((c) => c.key === round.key)!;
    const final = i === proper.length - 1;
    const size = whole(round.cutSize);
    const cut: ProgramTarget = { input: "cut", round: round.key };
    if (!(size >= 1)) {
      return fail(
        final ? `${target.name}: enter how many candidates make the final cut, e.g. Top 3.` : `${target.name}: enter how many candidates go through the cut.`,
        "proper",
        cut,
      );
    }
    if (left >= 2 && (final ? size > left : size >= left)) {
      return fail(
        final
          ? `${target.name}: the final cut can't be more than the ${left} candidates left.`
          : `${target.name}: the cut has to leave fewer than the ${left} candidates before it.`,
        "proper",
        cut,
      );
    }
    // Only the cut's own stage: earlier scores don't carry over a cut.
    const basis = [...new Set(basisOf(draft.rounds, round))];
    if (basis.length === 0) return fail(`${target.name}: choose what ranks the cut.`, "proper", cut);
    target.cutSize = size;
    target.cutBasis = basis;
    left = size;
  }

  return { ok: true, preliminaryWeight, rounds: checked, violations: deductions.violations };
}

const text = (v: unknown) => (typeof v === "string" || typeof v === "number" ? String(v) : "");
const record = (v: unknown) => (typeof v === "object" && v !== null ? v : {}) as Record<string, unknown>;

/** A scoring from JSON (a saved draft, or the browser) in the form's shape. Decimals that aren't 0, 1 or 2 become -1, which checkScoring refuses. */
export function parseScoringDraft(value: unknown): ScoringDraft {
  const sc = record(value);
  const decimals = Number(sc.decimals);
  return {
    mode: sc.mode === "criteria" ? "criteria" : "simple",
    min: text(sc.min),
    max: text(sc.max),
    decimals: (decimals === 0 || decimals === 1 || decimals === 2 ? decimals : -1) as Decimals,
    criteria: (Array.isArray(sc.criteria) ? sc.criteria : []).slice(0, 40).map((c: unknown, k) => {
      const row = record(c);
      return { key: k, id: text(row.id), name: text(row.name), max: text(row.max), min: text(row.min), guide: text(row.guide) };
    }),
    display: sc.display === "ten" ? "ten" : "percent",
  };
}

/**
 * A program sent from the browser, as JSON, coerced into a PageantDraft. Anything malformed becomes null or an
 * empty value that checkPageant then refuses with a plain message.
 */
export function parsePageantDraft(json: string): PageantDraft | null {
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    return null;
  }
  if (typeof raw !== "object" || raw === null) return null;
  const obj = raw as Record<string, unknown>;
  if (!Array.isArray(obj.rounds) || obj.rounds.length > MAX_ROUNDS * 2) return null;
  const scoring = parseScoringDraft;
  const rounds = (obj.rounds as unknown[]).map((item, i): RoundDraft => {
    const r = record(item);
    return {
      key: text(r.key).slice(0, 64) || `round-${i}`,
      segment: r.segment === "proper" ? "proper" : "preliminary",
      name: text(r.name),
      weight: text(r.weight),
      scoring: scoring(r.scoring),
      timer: text(r.timer),
      cut: r.cut === true,
      cutSize: text(r.cutSize),
      cutBasis: Array.isArray(r.cutBasis) ? r.cutBasis.filter((k): k is string => typeof k === "string").slice(0, MAX_ROUNDS + 1) : null,
      parts: Array.isArray(r.parts)
        ? r.parts.slice(0, MAX_PARTS * 2).map((part: unknown, k): PartDraft => {
            const p = record(part);
            return { key: text(p.key).slice(0, 64) || `part-${i}-${k}`, name: text(p.name), weight: text(p.weight), scoring: scoring(p.scoring), timer: text(p.timer) };
          })
        : null,
    };
  });
  const violations = Array.isArray(obj.violations)
    ? obj.violations.slice(0, MAX_VIOLATIONS * 2).map((item: unknown, i): ViolationDraft => {
        const v = record(item);
        return { key: text(v.key).slice(0, 64) || `violation-${i}`, id: text(v.id).slice(0, 64), reason: text(v.reason), points: text(v.points) };
      })
    : null;
  return { preliminaryWeight: text(obj.preliminaryWeight), rounds, violations };
}

const scoringDraft = (r: Round): ScoringDraft => ({
  mode: r.scoringMode,
  min: String(r.min),
  max: String(r.max),
  decimals: r.decimals,
  criteria: r.criteria.map((c, k) => ({ key: k, id: c.id, name: c.name, max: String(c.max), min: c.min ? String(c.min) : "", guide: c.guide ?? "" })),
  display: r.criteriaDisplay,
});

/**
 * A saved program (every sub-activity and part) back in the form's shape, for editing it on the Segments tab.
 * Programs saved under older rules (shares adding up to 100 in each segment, or to pageant proper's share across
 * its cuts) come back with their shares fitted to today's, keeping their proportions: so every cut ranks the same.
 */
export function draftFromRounds(preliminaryWeight: number, rounds: Round[], violations: Violation[] | null = null): PageantDraft {
  const top = programOrder(rounds);
  const proper = top.filter((r) => r.segment === "proper");
  return fitShares({
    preliminaryWeight: String(preliminaryWeight),
    violations: violations && violations.map((v) => ({ key: v.id, id: v.id, reason: v.reason, points: String(v.points) })),
    rounds: top.map((r) => {
      const parts = partsOf(rounds, r.id);
      return {
        key: r.id,
        segment: r.segment,
        name: r.name,
        weight: shareText(r.weight),
        // A sub-activity with parts starts from a blank scoring of its own, should the parts be taken away.
        scoring: parts.length ? blankScoring() : scoringDraft(r),
        timer: r.timerSeconds === null ? "" : String(r.timerSeconds),
        cut: r.cutSize !== null && proper[proper.length - 1]?.id !== r.id,
        cutSize: r.cutSize === null ? "" : String(r.cutSize),
        cutBasis: r.cutSize === null ? null : r.cutBasis,
        parts: parts.length
          ? parts.map((p) => ({
              key: p.id,
              name: p.name,
              weight: shareText(p.weight),
              scoring: scoringDraft(p),
              timer: p.timerSeconds === null ? "" : String(p.timerSeconds),
            }))
          : null,
      };
    }),
  });
}
