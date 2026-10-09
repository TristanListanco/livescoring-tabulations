import type { Activity, Round } from "./types";

/** A complete activity for unit tests; override only what a test cares about. */
export function activityFixture(overrides: Partial<Activity> = {}): Activity {
  return {
    id: "a",
    name: "Finals",
    publicId: "p",
    min: 1,
    max: 10,
    decimals: 2,
    resultDecimals: 2,
    showRank: true,
    ledEntryId: null,
    ledFullscreen: false,
    ledHoldScores: false,
    ledTransition: "fade",
    ledAnonymous: false,
    ownerId: null,
    scoringMode: "simple",
    criteria: [],
    criteriaDisplay: "percent",
    sessionState: "draft",
    currentEntryId: null,
    kind: "event",
    preliminaryWeight: 0,
    currentRoundId: null,
    scoringClosesAt: null,
    createdAt: "",
    ...overrides,
  };
}

/** A pageant sub-activity scored 1 to 10 for unit tests. */
export function roundFixture(overrides: Partial<Round> & Pick<Round, "id" | "segment">): Round {
  return {
    name: overrides.id,
    position: 0,
    weight: 100,
    scoringMode: "simple",
    min: 1,
    max: 10,
    decimals: 2,
    criteria: [],
    criteriaDisplay: "percent",
    timerSeconds: null,
    cutSize: null,
    cutBasis: [],
    cutEntryIds: null,
    parentId: null,
    ...overrides,
  };
}
