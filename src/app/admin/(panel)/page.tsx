import type { Metadata } from "next";
import Link from "next/link";
import { listActivities, listOrganizerActivityNames } from "@/lib/data";
import { formatBound } from "@/lib/scoring";
import { requireAdmin } from "@/lib/session";

export const metadata: Metadata = { title: "Activities" };

const dateFormat = new Intl.DateTimeFormat("en", { month: "short", day: "numeric", year: "numeric" });

export default async function ActivitiesPage() {
  const session = await requireAdmin();
  const isSuper = session.kind === "super";
  const [activities, organizerActivities] = await Promise.all([
    listActivities(isSuper ? null : session.admin.id),
    isSuper ? listOrganizerActivityNames() : Promise.resolve([]),
  ]);

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h1 className="text-3xl font-bold tracking-tight">Activities</h1>
        <Link href="/admin/new" className="btn btn-primary">
          New activity
        </Link>
      </div>

      {activities.length === 0 ? (
        <div className="mt-10 rounded-2xl border border-dashed border-powder px-6 py-14 text-center">
          <p className="text-lg font-semibold">No activities yet</p>
          <p className="hint mx-auto mt-1 max-w-md">
            Create one to set the scoring range, add judges and entries, and get judge codes and a live results link.
          </p>
          <Link href="/admin/new" className="btn btn-primary mt-6">
            Create an activity
          </Link>
        </div>
      ) : (
        <div className="mt-8 overflow-x-auto">
          <table className="w-full min-w-[44rem] text-left">
            <thead className="border-b border-line text-sm text-prussian/70">
              <tr>
                <th className="py-3 pr-4 font-semibold">Activity</th>
                <th className="px-4 py-3 font-semibold">Scoring</th>
                <th className="px-4 py-3 text-right font-semibold">Judges</th>
                <th className="px-4 py-3 text-right font-semibold">Entries</th>
                <th className="px-4 py-3 text-right font-semibold">Scores in</th>
                <th className="py-3 pl-4 text-right font-semibold">Created</th>
              </tr>
            </thead>
            <tbody className="tabular">
              {activities.map((a) => {
                const possible = a.judgeCount * a.entryCount;
                return (
                  <tr key={a.id} className="group relative border-b border-line hover:bg-white/70">
                    <td className="py-4 pr-4">
                      <Link href={`/admin/${a.id}`} className="font-semibold text-regal after:absolute after:inset-0 group-hover:underline">
                        {a.name}
                      </Link>
                    </td>
                    <td className="px-4 py-4">
                      {a.scoringMode === "criteria" ? `${a.criteria.length} criteria, 100 points` : `${formatBound(a.min)} to ${formatBound(a.max)}`}
                    </td>
                    <td className="px-4 py-4 text-right">{a.judgeCount}</td>
                    <td className="px-4 py-4 text-right">{a.entryCount}</td>
                    <td className="px-4 py-4 text-right">
                      {a.scoreCount} of {possible}
                    </td>
                    <td className="py-4 pl-4 text-right text-prussian/70">{dateFormat.format(new Date(a.createdAt))}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {isSuper && organizerActivities.length > 0 && (
        <section aria-labelledby="organizer-activities" className="mt-12">
          <h2 id="organizer-activities" className="text-xl font-bold">
            Organizers&apos; activities
          </h2>
          <p className="hint mt-1 max-w-2xl">Each organizer&apos;s activities are private to them. You see the name and who runs it, nothing else.</p>
          <table className="mt-4 w-full max-w-3xl text-left">
            <thead className="border-b border-line text-sm text-prussian/70">
              <tr>
                <th className="py-3 pr-4 font-semibold">Activity</th>
                <th className="py-3 pl-4 font-semibold">Organizer</th>
              </tr>
            </thead>
            <tbody>
              {organizerActivities.map((a) => (
                <tr key={a.id} className="border-b border-line">
                  <td className="py-3.5 pr-4 font-semibold">{a.name}</td>
                  <td className="py-3.5 pl-4 text-prussian/70">{a.organizer}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
    </>
  );
}
