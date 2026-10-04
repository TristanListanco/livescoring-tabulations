import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { LiveBoard } from "@/components/live-board";
import { getAccessCodes, getBoard } from "@/lib/data";
import { siteOrigin } from "@/lib/origin";
import { rangeLabel, scoreProgress } from "@/lib/scoring";
import { requireAdmin } from "@/lib/session";
import { AccessTab } from "./access-tab";
import { DeveloperTab } from "./developer-tab";
import { EntriesTab } from "./entries-tab";
import { JudgesTab } from "./judges-tab";
import { LedTab } from "./led-tab";
import { SettingsTab } from "./settings-tab";

const TABS = [
  { id: "access", label: "Access" },
  { id: "judges", label: "Judges" },
  { id: "entries", label: "Entries" },
  { id: "results", label: "Results" },
  { id: "led", label: "LED wall" },
  { id: "settings", label: "Settings" },
  { id: "developer", label: "Developer" },
] as const;

export async function generateMetadata({ params }: PageProps<"/admin/[id]">): Promise<Metadata> {
  const board = await getBoard((await params).id);
  return { title: board?.activity.name ?? "Activity not found" };
}

export default async function ActivityPage({ params, searchParams }: PageProps<"/admin/[id]">) {
  await requireAdmin();
  const board = await getBoard((await params).id);
  if (!board) notFound();

  const requested = (await searchParams).tab;
  const tab = TABS.find((t) => t.id === requested)?.id ?? "access";
  const { activity, judges, entries, scores } = board;
  const progress = scoreProgress(board);
  const origin = await siteOrigin();
  const liveUrl = `${origin}/live/${activity.publicId}`;
  const ledUrl = `${origin}/led/${activity.publicId}`;

  const scoredBy = new Map<string, number>();
  const scoredFor = new Map<string, number>();
  for (const s of scores) {
    scoredBy.set(s.judgeId, (scoredBy.get(s.judgeId) ?? 0) + 1);
    scoredFor.set(s.entryId, (scoredFor.get(s.entryId) ?? 0) + 1);
  }

  return (
    <>
      <Link href="/admin" className="text-sm font-semibold text-regal hover:underline">
        Activities
      </Link>
      <div className="mt-1 flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-3xl font-bold tracking-tight text-balance">{activity.name}</h1>
          <p className="hint mt-1">
            Scores {rangeLabel(activity)}, {activity.decimals === 0 ? "whole numbers" : `${activity.decimals} decimal place${activity.decimals > 1 ? "s" : ""}`}.{" "}
            {judges.length} {judges.length === 1 ? "judge" : "judges"}, {entries.length} {entries.length === 1 ? "entry" : "entries"}.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-5">
          <div className="w-44">
            <p className="tabular text-sm">
              <span className="font-bold">{progress.submitted}</span> of {progress.possible} scores in
            </p>
            <div
              className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-wash"
              role="progressbar"
              aria-label="Scores in"
              aria-valuemin={0}
              aria-valuemax={progress.possible}
              aria-valuenow={progress.submitted}
            >
              <div
                className="h-full rounded-full bg-regal"
                style={{ width: `${progress.possible ? (progress.submitted / progress.possible) * 100 : 0}%` }}
              />
            </div>
          </div>
          <a href={liveUrl} target="_blank" rel="noreferrer" className="btn btn-quiet">
            Open live results
          </a>
        </div>
      </div>

      <nav
        aria-label="Activity sections"
        className="mt-6 -mr-4 overflow-x-auto border-b border-line [mask-image:linear-gradient(to_right,black_85%,transparent)] sm:mr-0 sm:[mask-image:none]"
      >
        <ul className="flex min-w-max gap-1">
          {TABS.map((t) => {
            const active = t.id === tab;
            return (
              <li key={t.id} className={t.id === "developer" ? "pr-8 sm:ml-auto sm:pr-0 sm:pl-6" : undefined}>
                <Link
                  href={`/admin/${activity.id}?tab=${t.id}`}
                  scroll={false}
                  aria-current={active ? "page" : undefined}
                  className={`-mb-px block border-b-2 px-2.5 py-3 text-[15px] font-semibold transition-colors sm:px-3 ${
                    active ? "border-regal text-regal" : "border-transparent text-prussian/70 hover:text-prussian"
                  }`}
                >
                  {t.label}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>

      <div className="pt-8">
        {tab === "access" && (
          <AccessTab
            origin={origin}
            liveUrl={liveUrl}
            ledUrl={ledUrl}
            judges={judges}
            codes={await getAccessCodes(judges.map((j) => j.id))}
            scoredBy={scoredBy}
            entryCount={entries.length}
          />
        )}
        {tab === "judges" && <JudgesTab activityId={activity.id} judges={judges} scoredBy={Object.fromEntries(scoredBy)} />}
        {tab === "entries" && <EntriesTab activityId={activity.id} entries={entries} scoredFor={Object.fromEntries(scoredFor)} />}
        {tab === "results" && <LiveBoard board={board} embedded />}
        {tab === "led" && <LedTab board={board} ledUrl={ledUrl} />}
        {tab === "settings" && <SettingsTab activity={activity} hasScores={scores.length > 0} progress={progress} />}
        {tab === "developer" && <DeveloperTab activity={activity} scoreCount={scores.length} />}
      </div>
    </>
  );
}
