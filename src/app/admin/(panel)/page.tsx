import type { Metadata } from "next";
import Link from "next/link";
import { listActivities, listOrganizerActivities } from "@/lib/data";
import { formatBound } from "@/lib/scoring";
import { requireAdmin } from "@/lib/session";
import { SessionStatus } from "./session-status";

export const metadata: Metadata = { title: "Activities" };

const dateFormat = new Intl.DateTimeFormat("en", { month: "short", day: "numeric", year: "numeric" });

export default async function ActivitiesPage() {
  const session = await requireAdmin();
  const isSuper = session.kind === "super";
  const [activities, organizerActivities] = await Promise.all([
    listActivities(isSuper ? null : session.admin.id),
    isSuper ? listOrganizerActivities() : Promise.resolve([]),
  ]);
  const nothingAnywhere = activities.length === 0 && organizerActivities.length === 0;
  // A show that's live right now goes to the top; otherwise newest first, as the queries return them.
  const liveFirst = <T extends { sessionState: string }>(list: T[]) => [...list].sort((a, b) => Number(b.sessionState === "live") - Number(a.sessionState === "live"));

  return (
    <>
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

      {/* The super admin watches organizers' shows: whether judging has started and how far it has got. */}
      {organizerActivities.length > 0 && (
        <section aria-labelledby="organizer-activities" className="mt-8">
          <h2 id="organizer-activities" className="text-xl font-bold">
            Organizers&apos; activities
          </h2>
          <p className="hint mt-1">Only the organizer who runs an activity can open it.</p>

          {/* Phones: one stacked row per activity, so nothing scrolls sideways. */}
          <ul className="mt-4 divide-y divide-line border-y border-line md:hidden">
            {liveFirst(organizerActivities).map((a) => (
              <li key={a.id} className="py-3">
                <div className="flex items-start justify-between gap-3">
                  <p className="min-w-0 font-medium wrap-anywhere">{a.name}</p>
                  <SessionStatus state={a.sessionState} pulse className="shrink-0 text-sm" />
                </div>
                <p className="hint tabular mt-0.5">
                  {a.organizer} · {a.scoreCount} of {a.judgeCount * a.entryCount} scores · {dateFormat.format(new Date(a.createdAt))}
                </p>
              </li>
            ))}
          </ul>

          {/* Wider screens: a table. If large text makes it overflow, the scroll area can be reached by keyboard. */}
          <div tabIndex={0} role="region" aria-label="Organizers' activities table" className="mt-4 hidden overflow-x-auto md:block">
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
                {liveFirst(organizerActivities).map((a) => (
                  <tr key={a.id} className="border-b border-line">
                    {/* Not a link, so not styled like one: only the organizer can open it. */}
                    <td className="py-3.5 pr-4 font-medium">{a.name}</td>
                    <td className="px-4 py-3.5">{a.organizer}</td>
                    <td className="px-4 py-3.5 whitespace-nowrap">
                      <SessionStatus state={a.sessionState} pulse />
                    </td>
                    <td className="px-4 py-3.5 text-right whitespace-nowrap">
                      {a.scoreCount} of {a.judgeCount * a.entryCount}
                    </td>
                    <td className="py-3.5 pl-4 text-right whitespace-nowrap text-prussian/70">{dateFormat.format(new Date(a.createdAt))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {activities.length > 0 && (
        <section aria-labelledby={isSuper ? "own-activities" : undefined} className={isSuper && organizerActivities.length > 0 ? "mt-12" : "mt-8"}>
          {isSuper && (
            <>
              <h2 id="own-activities" className="text-xl font-bold">
                Your activities
              </h2>
              <p className="hint mt-1">Activities you run yourself. Hand one to an organizer from its Settings tab.</p>
            </>
          )}

          {/* Phones and tablets: each activity is one tappable row (seven columns don't fit until lg). */}
          <ul className={`divide-y divide-line border-y border-line lg:hidden ${isSuper ? "mt-4" : ""}`}>
            {liveFirst(activities).map((a) => (
              <li key={a.id} className="group relative py-3">
                <div className="flex items-start justify-between gap-3">
                  <Link href={`/admin/${a.id}`} className="min-w-0 font-semibold text-regal wrap-anywhere after:absolute after:inset-0 group-hover:underline">
                    {a.name}
                  </Link>
                  <SessionStatus state={a.sessionState} pulse className="shrink-0 text-sm" />
                </div>
                <p className="hint tabular mt-0.5">
                  {a.scoringMode === "criteria" ? `${a.criteria.length} criteria` : `${formatBound(a.min)} to ${formatBound(a.max)}`} · {a.judgeCount}{" "}
                  {a.judgeCount === 1 ? "judge" : "judges"} · {a.entryCount} {a.entryCount === 1 ? "entry" : "entries"}
                </p>
                <p className="hint tabular">
                  {a.scoreCount} of {a.judgeCount * a.entryCount} scores in · {dateFormat.format(new Date(a.createdAt))}
                </p>
              </li>
            ))}
          </ul>

          <div
            tabIndex={0}
            role="region"
            aria-label={isSuper ? "Your activities table" : "Activities table"}
            className={`hidden overflow-x-auto lg:block ${isSuper ? "mt-4" : ""}`}
          >
            <table className="w-full min-w-[44rem] text-left">
              <thead className="border-b border-line text-sm text-prussian/70">
                <tr>
                  <th className="py-3 pr-3 font-semibold">Activity</th>
                  <th className="px-3 py-3 font-semibold">Session</th>
                  <th className="px-3 py-3 font-semibold">Scoring</th>
                  <th className="px-3 py-3 text-right font-semibold">Judges</th>
                  <th className="px-3 py-3 text-right font-semibold">Entries</th>
                  <th className="px-3 py-3 text-right font-semibold">Scores in</th>
                  <th className="py-3 pl-3 text-right font-semibold">Created</th>
                </tr>
              </thead>
              <tbody className="tabular">
                {liveFirst(activities).map((a) => (
                  <tr key={a.id} className="group relative border-b border-line hover:bg-white/70">
                    <td className="py-4 pr-3">
                      <Link href={`/admin/${a.id}`} className="font-semibold text-regal after:absolute after:inset-0 group-hover:underline">
                        {a.name}
                      </Link>
                    </td>
                    <td className="px-3 py-4">
                      <SessionStatus state={a.sessionState} pulse />
                    </td>
                    <td className="px-3 py-4">
                      {a.scoringMode === "criteria" ? `${a.criteria.length} criteria, 100 points` : `${formatBound(a.min)} to ${formatBound(a.max)}`}
                    </td>
                    <td className="px-3 py-4 text-right">{a.judgeCount}</td>
                    <td className="px-3 py-4 text-right">{a.entryCount}</td>
                    <td className="px-3 py-4 text-right">
                      {a.scoreCount} of {a.judgeCount * a.entryCount}
                    </td>
                    <td className="py-4 pl-3 text-right text-prussian/70">{dateFormat.format(new Date(a.createdAt))}</td>
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
