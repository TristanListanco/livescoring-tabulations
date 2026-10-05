import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getAccessCodes, getBoard, getSignatories, listAdmins, listDevices } from "@/lib/data";
import { isProductionSite } from "@/lib/environment";
import { siteOrigin } from "@/lib/origin";
import { qrSvg } from "@/lib/qr";
import { reportId } from "@/lib/report";
import { scoreProgress } from "@/lib/scoring";
import { canManageActivity, currentAdmin, requireAdmin, type AdminSession } from "@/lib/session";
import type { Board } from "@/lib/types";
import { SessionStatus } from "../session-status";
import { AccessTab } from "./access-tab";
import { DeveloperTab } from "./developer-tab";
import { EntriesTab } from "./entries-tab";
import { JudgesTab } from "./judges-tab";
import { LedTab } from "./led-tab";
import { SessionTab } from "./session-tab";
import { SettingsTab } from "./settings-tab";

/**
 * In the order of an event day: what runs the show (the session desk, judges' devices, the LED wall), then
 * what's set up beforehand, then the rehearsal tools off to the side.
 */
const TABS = [
  { id: "session", label: "Session", group: "show" },
  { id: "access", label: "Judge devices", group: "show" },
  { id: "led", label: "LED wall", group: "show" },
  { id: "judges", label: "Judges", group: "setup" },
  { id: "entries", label: "Entries", group: "setup" },
  { id: "settings", label: "Settings", group: "setup" },
  { id: "developer", label: "Developer", group: "tools" },
] as const;

/**
 * Organizers see only their own activities, and the super admin only those no organizer owns. Anything
 * else is "not found", not "forbidden", so it doesn't even confirm the activity exists.
 */
function canSee(session: AdminSession | null, board: Board | null): board is Board {
  return !!board && canManageActivity(session, board.activity.ownerId);
}

export async function generateMetadata({ params }: PageProps<"/admin/[id]">): Promise<Metadata> {
  const [session, board] = await Promise.all([currentAdmin(), getBoard((await params).id)]);
  return { title: canSee(session, board) ? board.activity.name : "Activity not found" };
}

export default async function ActivityPage({ params, searchParams }: PageProps<"/admin/[id]">) {
  const session = await requireAdmin();
  const board = await getBoard((await params).id);
  if (!canSee(session, board)) notFound();

  const requested = (await searchParams).tab;
  const { activity, judges, entries, scores } = board;
  // Before judging starts the organizer needs the codes; once it's live, the session controls.
  // Developer tools are for rehearsals; the live site only offers deleting the activity, from Settings.
  const tabs = isProductionSite() ? TABS.filter((t) => t.id !== "developer") : TABS;
  const tab = tabs.find((t) => t.id === requested)?.id ?? (activity.sessionState === "draft" ? "access" : "session");
  const started = activity.sessionState !== "draft";
  const devices = await listDevices(judges.map((j) => j.id));
  const waitingDevices = devices.filter((d) => d.status === "pending").length;
  const progress = scoreProgress(board);
  // When this board was read, so the session desk can say how fresh it is if realtime drops. A Server Component
  // renders once per request, so the clock here is simply the request time.
  // eslint-disable-next-line react-hooks/purity
  const renderedAt = Date.now();
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
      <Link href="/admin" className="text-action">
        Activities
      </Link>
      <div className="mt-1 flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <h1 className="text-3xl font-bold tracking-tight text-balance wrap-anywhere">{activity.name}</h1>
            <Link
              href={`/admin/${activity.id}?tab=session`}
              scroll={false}
              className="tap-target rounded-full border border-line bg-white px-3 py-1 text-sm font-semibold hover:border-field"
            >
              <SessionStatus state={activity.sessionState} pulse />
            </Link>
            {waitingDevices > 0 && (
              <Link
                href={`/admin/${activity.id}?tab=access`}
                scroll={false}
                className="rounded-full bg-prussian px-3 py-1 text-sm font-semibold text-mint"
              >
                {waitingDevices} {waitingDevices === 1 ? "device" : "devices"} waiting for approval
              </Link>
            )}
          </div>
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
        </div>
      </div>

      <nav
        aria-label="Activity sections"
        className="mt-6 -mr-4 overflow-x-auto border-b border-line [mask-image:linear-gradient(to_right,black_85%,transparent)] sm:mr-0 sm:[mask-image:none]"
      >
        <ul className="flex min-w-max gap-1">
          {tabs.map((t, i) => {
            const active = t.id === tab;
            const startsGroup = i > 0 && tabs[i - 1].group !== t.group && t.group === "setup";
            return (
              <li
                key={t.id}
                className={
                  t.group === "tools"
                    ? "pr-8 sm:ml-auto sm:pr-0 sm:pl-6"
                    : startsGroup
                      ? "relative ml-2 pl-2 before:absolute before:top-1/2 before:left-0 before:h-5 before:w-px before:-translate-y-1/2 before:bg-line"
                      : undefined
                }
              >
                <Link
                  href={`/admin/${activity.id}?tab=${t.id}`}
                  scroll={false}
                  aria-current={active ? "page" : undefined}
                  className={`-mb-px block border-b-2 px-2.5 py-3 transition-colors sm:px-3 ${
                    t.group === "tools" ? "text-sm font-semibold" : "text-[15px] font-semibold"
                  } ${active ? "border-regal text-regal" : "border-transparent text-prussian/70 hover:text-prussian"}`}
                >
                  {t.label}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>

      <div className="pt-6">
        {tab === "access" && (
          <AccessTab
            activityId={activity.id}
            devices={devices}
            origin={origin}
            judges={judges}
            codes={await getAccessCodes(judges.map((j) => j.id))}
            scoredBy={scoredBy}
            entryCount={entries.length}
          />
        )}
        {tab === "session" && (
          <SessionTab
            board={board}
            renderedAt={renderedAt}
            devices={devices}
            progress={progress}
            reportId={reportId(board)}
            signatories={activity.ownerId ? await getSignatories(activity.ownerId) : null}
            liveUrl={liveUrl}
            liveQr={await qrSvg(liveUrl)}
            ledUrl={ledUrl}
          />
        )}
        {tab === "judges" && <JudgesTab activityId={activity.id} judges={judges} scoredBy={Object.fromEntries(scoredBy)} locked={started} />}
        {tab === "entries" && (
          <EntriesTab
            activityId={activity.id}
            entries={entries}
            scoredFor={Object.fromEntries(scoredFor)}
            started={started}
            ended={activity.sessionState === "ended"}
          />
        )}
        {tab === "led" && <LedTab board={board} ledUrl={ledUrl} />}
        {tab === "settings" && (
          <SettingsTab
            activity={activity}
            organizers={session.kind === "super" ? (await listAdmins()).map((a) => ({ id: a.id, name: a.name, email: a.email })) : null}
          />
        )}
        {tab === "developer" && <DeveloperTab activity={activity} scoreCount={scores.length} />}
      </div>
    </>
  );
}
