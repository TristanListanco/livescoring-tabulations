import type { Metadata } from "next";
import Link from "next/link";
import { listActivities, listAttention, listDrafts, listOrganizerActivities, type ActivitySummary, type Attention } from "@/lib/data";
import { formatBound } from "@/lib/scoring";
import { requireAdmin } from "@/lib/session";
import type { Activity } from "@/lib/types";
import { ActivitiesRefresh } from "./activities-refresh";
import { ArchiveButton, DeleteArchivedButton } from "./archive-controls";
import { DraftsList } from "./drafts-list";
import { SessionStatus } from "./session-status";

export const metadata: Metadata = { title: "Activities" };

const dateFormat = new Intl.DateTimeFormat("en", { month: "short", day: "numeric", year: "numeric" });

/** How an activity is scored, for the list: a pageant, criteria, or a range. */
function scoringOf(a: Pick<Activity, "kind" | "scoringMode" | "criteria" | "min" | "max">): string {
  if (a.kind === "pageant") return "Pageant";
  if (a.scoringMode === "criteria") return `${a.criteria.length} criteria`;
  return `${formatBound(a.min)} to ${formatBound(a.max)}`;
}

/** An activity's setup in one line: how it's scored, its judges and its entries (or a pageant's candidates). */
function setupOf(a: ActivitySummary): string {
  const entries = a.kind === "pageant" ? (a.entryCount === 1 ? "candidate" : "candidates") : a.entryCount === 1 ? "entry" : "entries";
  return `${scoringOf(a)} · ${a.judgeCount} ${a.judgeCount === 1 ? "judge" : "judges"} · ${a.entryCount} ${entries}`;
}

/**
 * Scores in so far. An event expects every judge's score for every entry; a pageant's total depends on its
 * sub-activities and cuts, so the list just counts what's in.
 */
function scoresIn(a: { kind?: Activity["kind"]; scoreCount: number; judgeCount: number; entryCount: number }, unit = true): string {
  if (a.kind === "pageant") return `${a.scoreCount} ${a.scoreCount === 1 ? "score" : "scores"}`;
  return `${a.scoreCount} of ${a.judgeCount * a.entryCount}${unit ? " scores" : ""}`;
}

/** What a running activity is waiting on its organizer for, as the thing to do, and the tab where it's done. */
function attentionLink(a: ActivitySummary, item: Attention): { label: string; href: string } {
  const tab = (name: string) => `/admin/${a.id}?tab=${name}`;
  switch (item.kind) {
    case "devices":
      // Before the session, devices are approved on the Judges tab; once it's running, from the desk.
      return { label: `Approve ${item.count} judge ${item.count === 1 ? "device" : "devices"}`, href: tab(a.sessionState === "draft" ? "judges" : "session") };
    case "first":
      return { label: `Show the first ${a.kind === "pageant" ? "candidate" : "entry"}`, href: tab("session") };
    case "next":
      return { label: "Every judge has scored: show the next entry", href: tab("session") };
    case "end":
      return { label: "Every entry is scored: end the session", href: tab("session") };
    case "deliberate":
      return { label: "Every entry is scored: start the deliberation", href: tab("session") };
    case "signed":
      return { label: "Every judge has signed: end the session", href: tab("session") };
  }
}

const arrow = (
  <svg viewBox="0 0 16 16" className="ml-1.5 inline size-3.5 align-[-0.1em]" aria-hidden>
    <path d="M3 8h9.5M8.5 4l4 4-4 4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

/** The things an activity is waiting on, each a link to where it's done. Above the row's own link. */
function NeedsYou({ activity, items }: { activity: ActivitySummary; items: Attention[] }) {
  return (
    <ul className="space-y-1">
      {items.map((item) => {
        const { label, href } = attentionLink(activity, item);
        // Inline, so a label that wraps ends with its arrow, which stays with the last word.
        const lastWord = label.lastIndexOf(" ") + 1;
        return (
          <li key={item.kind}>
            <Link href={href} className="relative z-10 font-semibold text-regal hover:underline">
              {label.slice(0, lastWord)}
              <span className="whitespace-nowrap">
                {label.slice(lastWord)}
                {arrow}
              </span>
              <span className="sr-only"> in {activity.name}</span>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

export default async function ActivitiesPage({ searchParams }: PageProps<"/admin">) {
  const session = await requireAdmin();
  const isSuper = session.kind === "super";
  // A later page of organizers' activities: those created before this.
  const before = isSuper ? (await searchParams).before : undefined;
  const later = typeof before === "string";
  const [activities, organizers, drafts] = await Promise.all([
    listActivities(isSuper ? null : session.admin.id),
    isSuper ? listOrganizerActivities(later ? before : undefined) : { live: [], activities: [], older: null },
    listDrafts(isSuper ? null : session.admin.id),
  ]);
  // Live shows first, then the newest (or the next page of older ones).
  const organizerActivities = [...organizers.live, ...organizers.activities];
  const nothingAnywhere = activities.length === 0 && organizerActivities.length === 0 && drafts.length === 0 && !later;
  // Archived activities leave the list for their own, below.
  const archived = activities.filter((a) => a.archivedAt).sort((a, b) => (b.archivedAt ?? "").localeCompare(a.archivedAt ?? ""));
  const current = activities.filter((a) => !a.archivedAt);
  // With many rooms running at once, the ones waiting on the organizer go to the top, then the rest of the running
  // shows; otherwise newest first, as the queries return them.
  const attention = await listAttention(current);
  const running = (state: string) => state === "live" || state === "deliberation";
  const urgency = (a: ActivitySummary) => (attention.has(a.id) ? 2 : running(a.sessionState) ? 1 : 0);
  const sorted = [...current].sort((a, b) => urgency(b) - urgency(a));
  // The list keeps itself current while anything could still change: a device asking to judge, a score coming in.
  const changing = current.some((a) => a.sessionState !== "ended");

  return (
    <>
      <ActivitiesRefresh active={changing} />
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h1 className="text-3xl font-bold tracking-tight">Activities</h1>
        <Link href="/admin/new" className="btn btn-primary">
          New activity
        </Link>
      </div>

      {nothingAnywhere && (
        <div className="mt-10 rounded-2xl border border-dashed border-powder px-6 py-14 text-center">
          <p className="text-lg font-semibold">No activities yet</p>
          <p className="hint mx-auto mt-1 max-w-md">
            Create one to set the scoring range, add judges and entries, and get judge codes and a live results link.
          </p>
          <Link href="/admin/new" className="btn btn-primary mt-6">
            Create an activity
          </Link>
        </div>
      )}

      {/* Everything's archived: the list is empty, and the archived ones are below. */}
      {current.length === 0 && archived.length > 0 && drafts.length === 0 && organizerActivities.length === 0 && (
        <p className="hint mt-8">
          No current activities.{" "}
          <Link href="/admin/new" className="text-action">
            Create one
          </Link>
          , or open an archived one below.
        </p>
      )}

      {drafts.length > 0 && (
        <DraftsList drafts={drafts.map((d) => ({ id: d.id, kind: d.kind, name: d.name, saved: dateFormat.format(new Date(d.updatedAt)) }))} />
      )}

      {/* The super admin watches organizers' shows: whether judging has started and how far it has got. */}
      {(organizerActivities.length > 0 || later) && (
        <section aria-labelledby="organizer-activities" className="mt-8">
          <h2 id="organizer-activities" className="scroll-mt-6 text-xl font-bold">
            Organizers&apos; activities
          </h2>
          <p className="hint mt-1">
            {later && organizerActivities.length === 0 ? "No older activities." : "Only the organizer who runs an activity can open it."}
          </p>

          {/* Phones: one stacked row per activity, so nothing scrolls sideways. */}
          <ul className={`mt-4 divide-y divide-line border-y border-line md:hidden ${organizerActivities.length === 0 ? "hidden" : ""}`}>
            {organizerActivities.map((a) => (
              <li key={a.id} className="py-3">
                <div className="flex items-start justify-between gap-3">
                  <p className="min-w-0 font-medium wrap-anywhere">{a.name}</p>
                  <SessionStatus state={a.sessionState} pulse className="shrink-0 text-sm" />
                </div>
                <p className="hint tabular mt-0.5">
                  {a.organizer} · {scoresIn(a)} · {dateFormat.format(new Date(a.createdAt))}
                </p>
              </li>
            ))}
          </ul>

          {/* Wider screens: a table. If large text makes it overflow, the scroll area can be reached by keyboard. */}
          <div
            tabIndex={0}
            role="region"
            aria-label="Organizers' activities table"
            className={`mt-4 hidden overflow-x-auto ${organizerActivities.length === 0 ? "" : "md:block"}`}
          >
            <table className="w-full min-w-[40rem] text-left">
              <thead className="border-b border-line text-sm text-prussian/70">
                <tr>
                  <th className="py-3 pr-4 font-semibold">Activity</th>
                  <th className="px-4 py-3 font-semibold">Organizer</th>
                  <th className="px-4 py-3 font-semibold whitespace-nowrap">Session</th>
                  <th className="px-4 py-3 text-right font-semibold whitespace-nowrap">Scores in</th>
                  <th className="py-3 pl-4 text-right font-semibold whitespace-nowrap">Created</th>
                </tr>
              </thead>
              <tbody className="tabular">
                {organizerActivities.map((a) => (
                  <tr key={a.id} className="border-b border-line">
                    {/* Not a link, so not styled like one: only the organizer can open it. */}
                    <td className="py-3.5 pr-4 font-medium">{a.name}</td>
                    <td className="px-4 py-3.5">{a.organizer}</td>
                    <td className="px-4 py-3.5 whitespace-nowrap">
                      <SessionStatus state={a.sessionState} pulse />
                    </td>
                    <td className="px-4 py-3.5 text-right whitespace-nowrap">{scoresIn(a, false)}</td>
                    <td className="py-3.5 pl-4 text-right whitespace-nowrap text-prussian/70">{dateFormat.format(new Date(a.createdAt))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {(organizers.older || later) && (
            <nav aria-label="Pages of organizers' activities" className="mt-4 flex flex-wrap gap-3">
              {later && (
                <Link href="/admin#organizer-activities" className="btn btn-quiet btn-sm">
                  Newest activities
                </Link>
              )}
              {organizers.older && (
                <Link href={{ pathname: "/admin", query: { before: organizers.older }, hash: "organizer-activities" }} className="btn btn-quiet btn-sm">
                  Older activities
                </Link>
              )}
            </nav>
          )}
        </section>
      )}

      {current.length > 0 && (
        <section aria-labelledby={isSuper ? "own-activities" : undefined} className={isSuper && organizerActivities.length > 0 ? "mt-12" : "mt-8"}>
          {isSuper && (
            <>
              <h2 id="own-activities" className="text-xl font-bold">
                Your activities
              </h2>
              <p className="hint mt-1">Activities you run yourself. Hand one to an organizer from its Settings tab.</p>
            </>
          )}

          {/* Phones and tablets: each activity is one tappable row, what it needs first under its name. */}
          <ul className={`divide-y divide-line border-y border-line lg:hidden ${isSuper ? "mt-4" : ""}`}>
            {sorted.map((a) => (
              <li key={a.id} className="group relative py-3">
                <div className="flex items-start justify-between gap-3">
                  <Link href={`/admin/${a.id}`} className="min-w-0 font-semibold text-regal wrap-anywhere after:absolute after:inset-0 group-hover:underline">
                    {a.name}
                  </Link>
                  <SessionStatus state={a.sessionState} pulse className="shrink-0 text-sm" />
                </div>
                {attention.has(a.id) && (
                  <div className="mt-1.5">
                    <NeedsYou activity={a} items={attention.get(a.id)!} />
                  </div>
                )}
                <p className="hint tabular mt-1">
                  {setupOf(a)} · {scoresIn(a)} in
                </p>
                {a.sessionState === "ended" && (
                  <div className="mt-2">
                    <ArchiveButton activityId={a.id} name={a.name} />
                  </div>
                )}
              </li>
            ))}
          </ul>

          <div
            tabIndex={0}
            role="region"
            aria-label={isSuper ? "Your activities table" : "Activities table"}
            className={`hidden overflow-x-auto lg:block ${isSuper ? "mt-4" : ""}`}
          >
            {/* What each room needs sits beside its name, so a desk running many rooms reads down one column. */}
            <table className="w-full min-w-[48rem] text-left">
              <thead className="border-b border-line text-sm text-prussian/70">
                <tr>
                  <th className="py-3 pr-3 font-semibold">Activity</th>
                  <th className="px-3 py-3 font-semibold">Session</th>
                  <th className="px-3 py-3 font-semibold">Needs you</th>
                  <th className="px-3 py-3 text-right font-semibold whitespace-nowrap">Scores in</th>
                  <th className="py-3 pl-3 text-right font-semibold">Created</th>
                  <th className="py-3 pl-3">
                    <span className="sr-only">Archive</span>
                  </th>
                </tr>
              </thead>
              <tbody className="tabular">
                {sorted.map((a) => (
                  <tr key={a.id} className="group relative border-b border-line align-top hover:bg-white/70">
                    <td className="py-4 pr-3">
                      <Link href={`/admin/${a.id}`} className="font-semibold text-regal after:absolute after:inset-0 group-hover:underline">
                        {a.name}
                      </Link>
                      <p className="hint mt-0.5">{setupOf(a)}</p>
                    </td>
                    <td className="px-3 py-4 whitespace-nowrap">
                      <SessionStatus state={a.sessionState} pulse />
                    </td>
                    <td className="px-3 py-4">
                      {attention.has(a.id) ? (
                        <NeedsYou activity={a} items={attention.get(a.id)!} />
                      ) : (
                        <span className="text-prussian/50">
                          <span aria-hidden>—</span>
                          <span className="sr-only">Nothing</span>
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-4 text-right whitespace-nowrap">{scoresIn(a, false)}</td>
                    <td className="py-4 pl-3 text-right whitespace-nowrap text-prussian/70">{dateFormat.format(new Date(a.createdAt))}</td>
                    <td className="py-3 pl-3 text-right">{a.sessionState === "ended" && <ArchiveButton activityId={a.id} name={a.name} />}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {archived.length > 0 && (
        <details className="group mt-12">
          <summary className="tap-target flex cursor-pointer list-none items-center gap-2 text-xl font-bold [&::-webkit-details-marker]:hidden">
            <svg viewBox="0 0 16 16" className="size-4 shrink-0 transition-transform group-open:rotate-90" aria-hidden>
              <path d="M6 3.5l4.5 4.5L6 12.5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            Archived activities
            <span className="text-base font-semibold text-prussian/60">{archived.length}</span>
          </summary>
          <p className="hint mt-1">Their sessions have ended for good: they can&apos;t be reopened or changed. Open one to download its results, or delete it.</p>
          <ul className="mt-4 divide-y divide-line border-y border-line">
            {archived.map((a) => (
              <li key={a.id} className="group/row relative flex flex-wrap items-center gap-x-4 gap-y-2 py-3">
                <div className="min-w-0 flex-1">
                  <Link href={`/admin/${a.id}`} className="font-semibold text-regal wrap-anywhere after:absolute after:inset-0 group-hover/row:underline">
                    {a.name}
                  </Link>
                  <p className="hint tabular mt-0.5">
                    {scoringOf(a)} · {scoresIn(a)} in · Archived {dateFormat.format(new Date(a.archivedAt!))}
                  </p>
                </div>
                <DeleteArchivedButton activityId={a.id} name={a.name} className="btn btn-sm btn-danger-quiet relative z-10" />
              </li>
            ))}
          </ul>
        </details>
      )}
    </>
  );
}
