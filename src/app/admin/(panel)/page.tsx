import type { Metadata } from "next";
import Link from "next/link";
import { TallyGate } from "@/components/brand";
import { listActivities, listArchivedActivities, listAttention, listDrafts, listOrganizerActivities, type ActivitySummary, type Attention } from "@/lib/data";
import { formatBound } from "@/lib/scoring";
import { requireAdmin } from "@/lib/session";
import type { Activity } from "@/lib/types";
import { ActivitiesRefresh } from "./activities-refresh";
import { DraftsList } from "./drafts-list";
import { segmentStatus, SessionStatus } from "./session-status";
import { scoresGoOutLive } from "@/lib/lifecycle";

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

/**
 * The list with nothing in it: Tabulous's tally gate drawn large, a stroke at a time with the slash that counts the
 * fifth last, over the page's title type, and the way to start.
 */
function Empty({ title, action }: { title: string; action: string }) {
  return (
    <section aria-labelledby="empty-title" className="card mt-10 flex flex-col items-center px-6 py-16 text-center sm:py-24">
      <TallyGate className="size-28 sm:size-36" strokes="text-powder" slash="text-regal" />
      <h2 id="empty-title" className="title mt-8">
        {title}
      </h2>
      <Link href="/admin/new" className="btn btn-primary mt-8">
        {action}
      </Link>
    </section>
  );
}

export default async function ActivitiesPage({ searchParams }: PageProps<"/admin">) {
  const session = await requireAdmin();
  const isSuper = session.kind === "super";
  // A later page of organizers' activities: those created before this.
  const before = isSuper ? (await searchParams).before : undefined;
  const later = typeof before === "string";
  const [current, organizers, drafts] = await Promise.all([
    listActivities(isSuper ? null : session.admin.id),
    isSuper ? listOrganizerActivities(later ? before : undefined) : { live: [], activities: [], older: null },
    listDrafts(isSuper ? null : session.admin.id),
  ]);
  // Live shows first, then the newest (or the next page of older ones).
  const organizerActivities = [...organizers.live, ...organizers.activities];
  // Archived activities are the sidebar's, not this list's: only with nothing else here does it matter if there are any.
  const empty = current.length === 0 && organizerActivities.length === 0 && drafts.length === 0 && !later;
  const allArchived = empty && (await listArchivedActivities(isSuper ? null : session.admin.id)).length > 0;
  // With many rooms running at once, the ones waiting on the organizer go to the top, then the rest of the running
  // shows; otherwise newest first, as the queries return them.
  const attention = await listAttention(current);
  const running = (state: string) => state === "live" || state === "deliberation";
  const urgency = (a: ActivitySummary) => (attention.has(a.id) ? 2 : running(a.sessionState) ? 1 : 0);
  const sorted = [...current].sort((a, b) => urgency(b) - urgency(a));
  // The list keeps itself current while anything could still change: a device asking to judge, a score coming in.
  const changing = current.filter((a) => a.sessionState !== "ended").map((a) => a.id);
  // A Server Component renders once per request, so the clock here is the request time.
  // eslint-disable-next-line react-hooks/purity
  const renderedAt = Date.now();

  return (
    <>
      <ActivitiesRefresh watch={changing} renderedAt={renderedAt} />
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h1 className="title">Activities</h1>
        {/* An empty list offers it under its title instead (see Empty). */}
        {!empty && (
          <Link href="/admin/new" className="btn btn-primary">
            New activity
          </Link>
        )}
      </div>


      {/* Nothing yet, or everything archived (the archived ones are in the sidebar). */}
      {empty && <Empty title={allArchived ? "No current activities" : "No activities yet"} action={allArchived ? "New activity" : "Create an activity"} />}

      {drafts.length > 0 && (
        <DraftsList drafts={drafts.map((d) => ({ id: d.id, kind: d.kind, name: d.name, saved: dateFormat.format(new Date(d.updatedAt)) }))} />
      )}

      {/* The super admin watches organizers' shows: whether judging has started and how far it has got. */}
      {(organizerActivities.length > 0 || later) && (
        <section aria-labelledby="organizer-activities" className="mt-10">
          <h2 id="organizer-activities" className="title-sm scroll-mt-6">
            Organizers&apos; activities
          </h2>
          {later && organizerActivities.length === 0 && <p className="hint mt-1">No older activities.</p>}

          {/* Phones: one stacked row per activity, so nothing scrolls sideways. */}
          <ul className={`card stagger mt-4 divide-y divide-line md:hidden ${organizerActivities.length === 0 ? "hidden" : ""}`}>
            {organizerActivities.map((a) => (
              <li key={a.id} className="px-5 py-3.5">
                <div className="flex items-start justify-between gap-3">
                  <p className="min-w-0 font-medium wrap-anywhere">{a.name}</p>
                  <SessionStatus state={a.sessionState} onAir={scoresGoOutLive(a)} segment={segmentStatus(a)} pulse className="shrink-0 text-sm" />
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
            className={`card mt-4 hidden overflow-x-auto ${organizerActivities.length === 0 ? "" : "md:block"}`}
          >
            <table className="table min-w-[40rem]">
              <thead>
                <tr>
                  <th>Activity</th>
                  <th>Organizer</th>
                  <th>Session</th>
                  <th className="text-right">Scores in</th>
                  <th className="text-right">Created</th>
                </tr>
              </thead>
              <tbody className="stagger tabular">
                {organizerActivities.map((a) => (
                  <tr key={a.id}>
                    {/* Not a link, so not styled like one: only the organizer can open it. */}
                    <td className="font-medium">{a.name}</td>
                    <td>{a.organizer}</td>
                    <td className="whitespace-nowrap">
                      <SessionStatus state={a.sessionState} onAir={scoresGoOutLive(a)} segment={segmentStatus(a)} pulse />
                    </td>
                    <td className="text-right whitespace-nowrap">{scoresIn(a, false)}</td>
                    <td className="text-right whitespace-nowrap text-prussian/70">{dateFormat.format(new Date(a.createdAt))}</td>
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
        <section aria-labelledby={isSuper ? "own-activities" : undefined} className="mt-10">
          {isSuper && (
            <>
              <h2 id="own-activities" className="title-sm">
                Your activities
              </h2>
            </>
          )}

          {/* Phones and tablets: each activity is one tappable row, what it needs first under its name. */}
          <ul className={`card stagger divide-y divide-line xl:hidden ${isSuper ? "mt-4" : ""}`}>
            {sorted.map((a) => (
              <li key={a.id} className="group relative px-5 py-3.5">
                <div className="flex items-start justify-between gap-3">
                  <Link href={`/admin/${a.id}`} className="min-w-0 font-semibold text-regal wrap-anywhere after:absolute after:inset-0 group-hover:underline">
                    {a.name}
                  </Link>
                  <SessionStatus state={a.sessionState} onAir={scoresGoOutLive(a)} segment={segmentStatus(a)} pulse className="shrink-0 text-sm" />
                </div>
                {attention.has(a.id) && (
                  <div className="mt-1.5">
                    <NeedsYou activity={a} items={attention.get(a.id)!} />
                  </div>
                )}
                <p className="hint tabular mt-1">
                  {a.location && `${a.location} · `}
                  {setupOf(a)} · {scoresIn(a)} in
                </p>
              </li>
            ))}
          </ul>

          <div
            tabIndex={0}
            role="region"
            aria-label={isSuper ? "Your activities table" : "Activities table"}
            className={`card hidden overflow-x-auto xl:block ${isSuper ? "mt-4" : ""}`}
          >
            {/* What each room needs sits beside its name, so a desk running many rooms reads down one column. */}
            <table className="table min-w-[48rem]">
              <thead>
                <tr>
                  <th>Activity</th>
                  <th>Session</th>
                  <th>Needs you</th>
                  <th className="text-right">Scores in</th>
                  <th className="text-right">Created</th>
                </tr>
              </thead>
              <tbody className="stagger tabular">
                {sorted.map((a) => (
                  <tr key={a.id} className="group relative align-top hover:bg-mint/60">
                    <td className="py-4">
                      <Link href={`/admin/${a.id}`} className="font-semibold text-regal after:absolute after:inset-0 group-hover:underline">
                        {a.name}
                      </Link>
                      <p className="hint mt-0.5">
                        {/* Where it happens, so breakout rooms tell apart at a glance. */}
                        {a.location && `${a.location} · `}
                        {setupOf(a)}
                      </p>
                    </td>
                    <td className="py-4 whitespace-nowrap">
                      <SessionStatus state={a.sessionState} onAir={scoresGoOutLive(a)} segment={segmentStatus(a)} pulse />
                    </td>
                    <td className="py-4">
                      {attention.has(a.id) ? (
                        <NeedsYou activity={a} items={attention.get(a.id)!} />
                      ) : (
                        <span className="text-prussian/50">
                          <span aria-hidden>—</span>
                          <span className="sr-only">Nothing</span>
                        </span>
                      )}
                    </td>
                    <td className="py-4 text-right whitespace-nowrap">{scoresIn(a, false)}</td>
                    <td className="py-4 text-right whitespace-nowrap text-prussian/70">{dateFormat.format(new Date(a.createdAt))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

    </>
  );
}
