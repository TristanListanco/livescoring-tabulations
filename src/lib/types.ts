import type { LedFont, LedShape, LedTheme } from "./led-style";

export type Decimals = 0 | 1 | 2;
/** Decimal places shown for averages and criteria totals in results. */
export type ResultDecimals = 0 | 1 | 2 | 3 | 4;

export type SessionState = "draft" | "live" | "ended";

/** simple: one score per judge between min and max. criteria: judges score each criterion; totals are out of 100. */
export type ScoringMode = "simple" | "criteria";
/**
 * min: the lowest score a judge can give, in points (a score sheet's "lowest possible score", e.g. 28 of 40); none when
 * missing or 0. guide: what judges should look for, such as guide questions, shown on their screen while they score it.
 */
export type Criterion = { id: string; name: string; max: number; min?: number; guide?: string };
/** How criteria totals (out of 100) are shown: as a percentage, or scaled to 10. */
export type CriteriaDisplay = "percent" | "ten";

/** event: one scoring for every entry. pageant: candidates go through preliminary and pageant proper sub-activities, with cuts. */
export type ActivityKind = "event" | "pageant";
/** A pageant's two segments. Each carries a share of the overall score. */
export type Segment = "preliminary" | "proper";
/** In a cut's basis: the whole preliminary segment. Pageant proper sub-activities are listed by their ids. */
export const PRELIMINARY = "preliminary";

/**
 * A pageant sub-activity (e.g. Closed-door interview, Swimsuit, Q&A). Each has its own scoring, like a small
 * activity: the same judges score the candidates still in the running.
 */
export type Round = {
  id: string;
  segment: Segment;
  name: string;
  /** Order through the whole pageant: preliminary sub-activities first. */
  position: number;
  /**
   * Share in percent, as score sheets write it: of the overall score in the preliminary (adding up to its share) and in
   * pageant proper up to the first cut (adding up to the rest). Scores start over after a cut, so the sub-activities
   * after one add up to 100. A sub-activity's parts add up to its own share. (The math only uses shares relative to
   * the others a cut counts, so programs saved under older rules rank the same.)
   */
  weight: number;
  scoringMode: ScoringMode;
  min: number;
  max: number;
  decimals: Decimals;
  criteria: Criterion[];
  criteriaDisplay: CriteriaDisplay;
  /** Seconds judges get to score each candidate once they're shown, or null for no time limit. */
  timerSeconds: number | null;
  /** Pageant proper only: after this sub-activity, the top N candidates go through. Null for no cut. */
  cutSize: number | null;
  /** What ranks the cut: PRELIMINARY for the whole preliminary segment, and pageant proper sub-activity ids. */
  cutBasis: string[];
  /** Who went through, best first, once the organizer confirmed the cut; null until then. */
  cutEntryIds: string[] | null;
  /**
   * A part of a sub-activity (e.g. the Q&A of a closed-door interview), or null for a sub-activity. A sub-activity
   * with parts is only their container: judges score each part, and its weight is shared among them by theirs.
   */
  parentId: string | null;
};

/** A name and designation printed as a signature line on the results PDF. */
export type Signatory = { name: string; designation: string };

export type DeviceStatus = "pending" | "approved" | "revoked";
export type JudgeDevice = { id: string; judgeId: string; pairingCode: string; label: string; status: DeviceStatus; createdAt: string };

export type Activity = {
  id: string;
  name: string;
  kind: ActivityKind;
  publicId: string;
  min: number;
  max: number;
  /** Decimal places judges enter scores with. */
  decimals: Decimals;
  /** Decimal places for averages and criteria totals on the live results, LED wall and PDF. Ranks tie on what is shown. */
  resultDecimals: ResultDecimals;
  /** Whether the public live results page shows ranks and sorts by placement. */
  showRank: boolean;
  /** The entry on the LED wall output, or null for an empty screen. */
  ledEntryId: string | null;
  /** LED wall shows the full-screen scoresheet instead of the green screen overlay. */
  ledFullscreen: boolean;
  /** LED wall hides scores until every judge has scored the entry on air. */
  ledHoldScores: boolean;
  /** LED wall keeps judges anonymous: a "?" in place of each judge's name and photo. */
  ledAnonymous: boolean;
  /** The LED wall's look: its font, colour theme and how rounded its panels are (see led-style.ts). */
  ledFont: LedFont;
  ledTheme: LedTheme;
  ledShape: LedShape;
  /** The organizer who owns the activity; null when only the super admin manages it. */
  ownerId: string | null;
  scoringMode: ScoringMode;
  /** Criteria mode only; their max points add up to 100. */
  criteria: Criterion[];
  criteriaDisplay: CriteriaDisplay;
  /** draft: not started, judges wait. live: judging is open. ended: judging is closed. */
  sessionState: SessionState;
  /** The entry every judge is scoring right now, chosen by the organizer. */
  currentEntryId: string | null;
  /** Pageant: the preliminary segment's share of the overall score, in percent. Pageant proper gets the rest. */
  preliminaryWeight: number;
  /** Pageant: the sub-activity being judged now. */
  currentRoundId: string | null;
  /** Pageant: when scoring closes for the candidate on screen, while a sub-activity's timer runs (ISO time). */
  scoringClosesAt: string | null;
  /**
   * Pageant: the violations the organizer can deduct points for during the preliminary, listed at setup, or null
   * when the pageant has no deductions. An empty list still allows deductions with a reason typed at the desk.
   */
  violations: Violation[] | null;
  createdAt: string;
};

/** An organizer account, as shown in the admin panel. Never includes the password hash. */
export type AdminAccount = {
  id: string;
  email: string;
  name: string;
  photoUrl: string | null;
};

/** Pageants: which segments a judge judges. all: both; or only the preliminary, or only pageant proper. */
export type JudgePanel = "all" | "preliminary" | "proper";

export type Judge = {
  id: string;
  /** Full name, e.g. "Maria Santos": on the results PDF and in the admin panel. */
  name: string;
  /** First and last name. Null for judges added before names were split; the full name stands in. */
  firstName: string | null;
  lastName: string | null;
  photoUrl: string | null;
  position: number;
  /** Chair of the board of judges: can move to the previous or next entry from their own screen. One per activity. */
  isChair: boolean;
  /** Pageants: which segments they judge. Always "all" for events. */
  panel: JudgePanel;
};

export type Entry = {
  id: string;
  name: string;
  /** Optional photo, shown on the LED wall. */
  photoUrl: string | null;
  position: number;
  /**
   * Its number in the full running order, when a pageant's sub-activity judges only some of the candidates:
   * candidates keep their number through every cut. Otherwise the number is the place in the list shown.
   */
  number?: number;
};

/** A pageant violation set up in advance, e.g. "Late for call time", 1 point. */
export type Violation = { id: string; reason: string; points: number };

/**
 * Points taken off a candidate's preliminary score for a violation, with its reason. Only the organizer sees them
 * listed (on the desk and the results PDFs); everyone else sees totals.
 */
export type Deduction = { id: string; entryId: string; points: number; reason: string; createdAt: string };

export type Score = {
  entryId: string;
  judgeId: string;
  value: number;
  /** The pageant sub-activity it was given in; null (or missing) for events. */
  roundId?: string | null;
  /**
   * Criteria scoring: the points given for each criterion, by criterion id. Loaded only for the judges' score sheets
   * (withBreakdowns); missing everywhere else.
   */
  breakdown?: Record<string, number> | null;
};

/** Everything a scoreboard needs to render one activity. */
export type Board = {
  activity: Activity;
  judges: Judge[];
  entries: Entry[];
  scores: Score[];
  /** A pageant's sub-activities in order; empty for events. */
  rounds: Round[];
  /**
   * A pageant's deductions, on boards loaded for the organizer (getAdminBoard). Missing elsewhere, such as the
   * judges' screens and the public results, which never list them.
   */
  deductions?: Deduction[];
};

export type ActionResult = { ok: true; message?: string } | { ok: false; error: string };
