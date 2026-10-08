import { checkScoring, type Scoring } from "./scoring-rules";
import { PRELIMINARY, type CriteriaDisplay, type Decimals, type Round, type ScoringMode, type Segment } from "./types";

/**
 * A pageant's program as the setup form holds it: the preliminary segment's share, and every sub-activity with its
 * scoring, timer and cut. Shared by the browser, which checks each step, and the server, which decides.
 */
export type CriterionDraft = { key: number; id: string; name: string; max: string };
export type ScoringDraft = { mode: ScoringMode; min: string; max: string; decimals: Decimals; criteria: CriterionDraft[]; display: CriteriaDisplay };
export type RoundDraft = {
  /** A saved sub-activity's id, or a key the form made up for a new one. Cut bases refer to sub-activities by it. */
  key: string;
  segment: Segment;
  name: string;
  /** Percent of its segment. */
  weight: string;
  scoring: ScoringDraft;
  /** Seconds to score each candidate; blank for no timer. */
  timer: string;
  /** Pageant proper only. The last pageant proper sub-activity always has the final cut. */
  cut: boolean;
  cutSize: string;
  /** What ranks the cut (PRELIMINARY and round keys); null until the organizer changes it, so it follows the default. */
  cutBasis: string[] | null;
};
export type PageantDraft = { preliminaryWeight: string; rounds: RoundDraft[] };

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
};

export const MAX_ROUNDS = 20;
export const MAX_ROUND_NAME = 60;

export const blankScoring = (): ScoringDraft => ({ mode: "simple", min: "1", max: "10", decimals: 2, criteria: [], display: "percent" });

export const segmentLabel = (segment: Segment) => (segment === "preliminary" ? "Preliminary" : "Pageant proper");

/** Pageant proper sub-activities in order; the last one has the final cut. */
const properOf = (rounds: RoundDraft[]) => rounds.filter((r) => r.segment === "proper");

/** Whether this sub-activity ends with a cut: one the organizer added, or the final cut on the last pageant proper one. */
export function hasCut(rounds: RoundDraft[], round: RoundDraft): boolean {
  if (round.segment !== "proper") return false;
  const proper = properOf(rounds);
  return round.cut || proper[proper.length - 1]?.key === round.key;
}

/**
 * What ranks a cut until the organizer changes it. The first cut counts everything so far: the preliminary segment
 * and every pageant proper sub-activity up to the cut. Later cuts count the sub-activities since the cut before.
 */
export function defaultBasis(rounds: RoundDraft[], round: RoundDraft): string[] {
  const proper = properOf(rounds);
  const index = proper.findIndex((r) => r.key === round.key);
  let start = 0;
  for (let i = index - 1; i >= 0; i--) {
    if (hasCut(rounds, proper[i])) {
      start = i + 1;
      break;
    }
  }
  const since = proper.slice(start, index + 1).map((r) => r.key);
  return start === 0 ? [PRELIMINARY, ...since] : since;
}

/** The cut's basis as it stands: the organizer's choice, or the default. */
export const basisOf = (rounds: RoundDraft[], round: RoundDraft): string[] => round.cutBasis ?? defaultBasis(rounds, round);

/** Sub-activities the cut can count: the preliminary segment and pageant proper ones up to and including the cut. */
export function basisChoices(rounds: RoundDraft[], round: RoundDraft): { key: string; label: string }[] {
  const proper = properOf(rounds);
  const index = proper.findIndex((r) => r.key === round.key);
  return [
    { key: PRELIMINARY, label: "Preliminary" },
    ...proper.slice(0, index + 1).map((r, i) => ({ key: r.key, label: r.name.trim() || `Sub-activity ${i + 1}` })),
  ];
}

const whole = (text: string) => (/^\d{1,4}$/.test(text.trim()) ? Number(text) : NaN);

/**
 * Check a pageant's program. `candidates`: how many there are now, so each cut leaves fewer than the one before.
 * `newId` names new criteria (the server's; the browser passes one that returns "").
 * On failure, `segment` says which step of the setup to fix.
 */
export function checkPageant(
  draft: PageantDraft,
  candidates: number,
  newId: () => string,
): { ok: true; preliminaryWeight: number; rounds: CheckedRound[] } | { ok: false; error: string; segment: Segment | null } {
  const fail = (error: string, segment: Segment | null = null) => ({ ok: false as const, error, segment });

  const preliminaryWeight = whole(draft.preliminaryWeight);
  if (!(preliminaryWeight >= 1 && preliminaryWeight <= 99)) {
    return fail("Give the preliminary a share of 1 to 99 percent. Pageant proper gets the rest.", "preliminary");
  }
  if (draft.rounds.length > MAX_ROUNDS) return fail(`A pageant can have up to ${MAX_ROUNDS} sub-activities.`);

  const names = new Set<string>();
  const checked: CheckedRound[] = [];
  for (const segment of ["preliminary", "proper"] as const) {
    const list = draft.rounds.filter((r) => r.segment === segment);
    const label = segment === "preliminary" ? "the preliminary" : "pageant proper";
    if (list.length === 0) return fail(`Add at least one sub-activity to ${label}.`, segment);

    let total = 0;
    for (const round of list) {
      const name = round.name.replace(/\s+/g, " ").trim().slice(0, MAX_ROUND_NAME);
      if (!name) return fail(`Give every sub-activity in ${label} a name.`, segment);
      if (names.has(name.toLowerCase())) return fail(`"${name}" is listed twice. Give each sub-activity its own name.`, segment);
      names.add(name.toLowerCase());

      const weight = whole(round.weight);
      if (!(weight >= 1 && weight <= 100)) return fail(`Give ${name} a share of 1 to 100 percent.`, segment);
      total += weight;

      const s = round.scoring;
      // Rows left completely blank are ignored, as on the event form.
      const criteria = s.criteria.filter((c) => c.name.trim() || c.max.trim());
      const parsed = checkScoring({ mode: s.mode, min: s.min, max: s.max, decimals: s.decimals, criteria, display: s.display }, newId);
      if ("error" in parsed) return fail(`${name}: ${parsed.error}`, segment);

      let timerSeconds: number | null = null;
      if (round.timer.trim() !== "") {
        timerSeconds = whole(round.timer);
        if (!(timerSeconds >= 5 && timerSeconds <= 3600)) return fail(`${name}: set the timer from 5 to 3600 seconds, or turn it off.`, segment);
      }

      checked.push({ key: round.key, segment, name, position: checked.length, weight, scoring: parsed.scoring, timerSeconds, cutSize: null, cutBasis: [] });
    }
    if (total !== 100) {
      const segmentName = segment === "preliminary" ? "preliminary" : "pageant proper";
      return fail(`The ${segmentName} sub-activities add up to ${total}%. They must add up to 100%.`, segment);
    }
  }

  // Cuts: each leaves fewer candidates than the one before; the final one decides the placements.
  const proper = draft.rounds.filter((r) => r.segment === "proper");
  let left = candidates;
  let seen: string[] = [];
  for (const [i, round] of proper.entries()) {
    seen = [...seen, round.key];
    if (!hasCut(draft.rounds, round)) continue;
    const target = checked.find((c) => c.key === round.key)!;
    const final = i === proper.length - 1;
    const size = whole(round.cutSize);
    if (!(size >= 1)) {
      return fail(final ? `${target.name}: enter how many candidates make the final cut, e.g. Top 3.` : `${target.name}: enter how many candidates go through the cut.`, "proper");
    }
    if (left >= 2 && (final ? size > left : size >= left)) {
      return fail(
        final
          ? `${target.name}: the final cut can't be more than the ${left} candidates left.`
          : `${target.name}: the cut has to leave fewer than the ${left} candidates before it.`,
        "proper",
      );
    }
    const allowed = new Set([PRELIMINARY, ...seen]);
    const basis = [...new Set(basisOf(draft.rounds, round))].filter((k) => allowed.has(k));
    if (basis.length === 0) return fail(`${target.name}: choose what ranks the cut.`, "proper");
    target.cutSize = size;
    target.cutBasis = basis;
    left = size;
  }

  return { ok: true, preliminaryWeight, rounds: checked };
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
  const text = (v: unknown) => (typeof v === "string" || typeof v === "number" ? String(v) : "");
  const rounds = (obj.rounds as unknown[]).map((item, i): RoundDraft => {
    const r = (typeof item === "object" && item !== null ? item : {}) as Record<string, unknown>;
    const sc = (typeof r.scoring === "object" && r.scoring !== null ? r.scoring : {}) as Record<string, unknown>;
    const decimals = Number(sc.decimals);
    return {
      key: text(r.key).slice(0, 64) || `round-${i}`,
      segment: r.segment === "proper" ? "proper" : "preliminary",
      name: text(r.name),
      weight: text(r.weight),
      scoring: {
        mode: sc.mode === "criteria" ? "criteria" : "simple",
        min: text(sc.min),
        max: text(sc.max),
        decimals: (decimals === 0 || decimals === 1 || decimals === 2 ? decimals : -1) as Decimals,
        criteria: (Array.isArray(sc.criteria) ? sc.criteria : []).slice(0, 40).map((c: unknown, k) => {
          const row = (typeof c === "object" && c !== null ? c : {}) as Record<string, unknown>;
          return { key: k, id: text(row.id), name: text(row.name), max: text(row.max) };
        }),
        display: sc.display === "ten" ? "ten" : "percent",
      },
      timer: text(r.timer),
      cut: r.cut === true,
      cutSize: text(r.cutSize),
      cutBasis: Array.isArray(r.cutBasis) ? r.cutBasis.filter((k): k is string => typeof k === "string").slice(0, MAX_ROUNDS + 1) : null,
    };
  });
  return { preliminaryWeight: text(obj.preliminaryWeight), rounds };
}

/** A saved program back in the form's shape, for editing it on the Segments tab. */
export function draftFromRounds(preliminaryWeight: number, rounds: Round[]): PageantDraft {
  const proper = rounds.filter((r) => r.segment === "proper");
  return {
    preliminaryWeight: String(preliminaryWeight),
    rounds: rounds.map((r) => ({
      key: r.id,
      segment: r.segment,
      name: r.name,
      weight: String(r.weight),
      scoring: {
        mode: r.scoringMode,
        min: String(r.min),
        max: String(r.max),
        decimals: r.decimals,
        criteria: r.criteria.map((c, k) => ({ key: k, id: c.id, name: c.name, max: String(c.max) })),
        display: r.criteriaDisplay,
      },
      timer: r.timerSeconds === null ? "" : String(r.timerSeconds),
      cut: r.cutSize !== null && proper[proper.length - 1]?.id !== r.id,
      cutSize: r.cutSize === null ? "" : String(r.cutSize),
      cutBasis: r.cutSize === null ? null : r.cutBasis,
    })),
  };
}
