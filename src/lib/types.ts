export type Decimals = 0 | 1 | 2;
/** Decimal places shown for averages and criteria totals in results. */
export type ResultDecimals = 0 | 1 | 2 | 3 | 4;

export type SessionState = "draft" | "live" | "ended";
export type LedTransition = "fade" | "wipe";

/** simple: one score per judge between min and max. criteria: judges score each criterion; totals are out of 100. */
export type ScoringMode = "simple" | "criteria";
export type Criterion = { id: string; name: string; max: number };
/** How criteria totals (out of 100) are shown: as a percentage, or scaled to 10. */
export type CriteriaDisplay = "percent" | "ten";

/** A name and designation printed as a signature line on the results PDF. */
export type Signatory = { name: string; designation: string };

export type DeviceStatus = "pending" | "approved" | "revoked";
export type JudgeDevice = { id: string; judgeId: string; pairingCode: string; label: string; status: DeviceStatus; createdAt: string };

export type Activity = {
  id: string;
  name: string;
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
  /** How entries and scores appear on the LED wall: a fade, or a wipe from the left. */
  ledTransition: LedTransition;
  /** LED wall keeps judges anonymous: a "?" in place of each judge's name and photo. */
  ledAnonymous: boolean;
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
  createdAt: string;
};

/** An organizer account, as shown in the admin panel. Never includes the password hash. */
export type AdminAccount = {
  id: string;
  email: string;
  name: string;
  photoUrl: string | null;
};

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
};

export type Entry = {
  id: string;
  name: string;
  /** Optional photo, shown on the LED wall. */
  photoUrl: string | null;
  position: number;
};

export type Score = {
  entryId: string;
  judgeId: string;
  value: number;
};

/** Everything a scoreboard needs to render one activity. */
export type Board = {
  activity: Activity;
  judges: Judge[];
  entries: Entry[];
  scores: Score[];
};

export type ActionResult = { ok: true; message?: string } | { ok: false; error: string };
