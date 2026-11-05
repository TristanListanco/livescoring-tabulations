import type { Activity } from "@/lib/types";

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
 * organizer needs the judges' codes) and Session after. Archived: read-only, so its results (on the Session tab, the
 * judges' notes too) and Settings, to check a CSV or delete it.
 */
export function activityTabs(activity: Pick<Activity, "kind" | "archivedAt" | "sessionState">, asked: string | undefined) {
  const all = activity.kind === "pageant" ? PAGEANT_TABS : TABS;
  const tabs =
    activity.archivedAt !== null
      ? all.filter((t) => t.id === "session" || t.id === "settings").map((t) => (t.id === "session" ? { ...t, label: "Results" } : t))
      : all;
  const tab = tabs.find((t) => t.id === asked)?.id ?? (activity.sessionState === "draft" ? "judges" : "session");
  return { tabs, tab };
}
