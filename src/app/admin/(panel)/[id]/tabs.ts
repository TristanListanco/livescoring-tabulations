import type { Activity } from "@/lib/types";
import { scoresGoOutLive } from "@/lib/lifecycle";

/**
 * In the order of an event day: what runs the show (the session desk, the judges and their devices, the LED wall),
 * then what's set up beforehand. The test site tools are in Settings.
 */
export type Tab = {
  id: "session" | "judges" | "led" | "entries" | "segments" | "settings";
  label: string;
  group: "show" | "setup";
};

const TABS: Tab[] = [
  { id: "session", label: "Session", group: "show" },
  { id: "judges", label: "Judges", group: "show" },
  { id: "led", label: "LED wall", group: "show" },
  { id: "entries", label: "Entries", group: "setup" },
  { id: "settings", label: "Settings", group: "setup" },
];

/**
 * Tabs that were merged into others, so old links still land somewhere sensible. The judges' notes download from the
 * session's results, beside the score sheets.
 */
const MOVED: Record<string, Tab["id"]> = { access: "judges", developer: "settings", notes: "session" };

/** A pageant's entries are its candidates, and its program (segments and sub-activities) has a tab of its own. */
const PAGEANT_TABS: Tab[] = TABS.flatMap((t): Tab[] =>
  t.id === "entries"
    ? [
        { ...t, label: "Candidates" },
        { id: "segments", label: "Segments", group: "setup" },
      ]
    : [t],
);

/** The tab a link asks for (`?tab=`), following tabs that were merged into others. */
export const askedTab = (requested: string | string[] | undefined) => (typeof requested === "string" ? (MOVED[requested] ?? requested) : undefined);

/**
 * An activity's tabs, and the one open: the one asked for if it has it, otherwise Judges before the session (the
 * organizer needs the judges' codes) and Session after. An event without live scoring has no LED wall: its scores stay
 * with the judges until they've signed. Archived: read-only, so only its results (on the Session tab, the judges' notes
 * too), with checking a CSV and deleting it under them.
 */
export function activityTabs(activity: Pick<Activity, "kind" | "archivedAt" | "sessionState" | "liveScoring">, asked: string | undefined) {
  // An LED wall only where scores go out live (see scoresGoOutLive in lifecycle.ts).
  const all = activity.kind === "pageant" ? PAGEANT_TABS : scoresGoOutLive(activity) ? TABS : TABS.filter((t) => t.id !== "led");
  const tabs =
    activity.archivedAt !== null
      ? all.filter((t) => t.id === "session").map((t) => ({ ...t, label: "Results" }))
      : all;
  const tab = tabs.find((t) => t.id === asked)?.id ?? (activity.sessionState === "draft" ? "judges" : "session");
  return { tabs, tab };
}
