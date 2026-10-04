import type { Activity } from "./types";

/** A complete activity for unit tests; override only what a test cares about. */
export function activityFixture(overrides: Partial<Activity> = {}): Activity {
  return {
    id: "a",
    name: "Finals",
    publicId: "p",
    min: 1,
    max: 10,
    decimals: 2,
    showRank: true,
    ledEntryId: null,
    ledFullscreen: false,
    ledHoldScores: false,
    ownerId: null,
    scoringMode: "simple",
    criteria: [],
    criteriaDisplay: "percent",
    sessionState: "draft",
    currentEntryId: null,
    createdAt: "",
    ...overrides,
  };
}
