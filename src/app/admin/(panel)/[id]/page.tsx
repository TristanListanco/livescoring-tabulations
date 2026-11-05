import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { correctionView, withoutValues } from "@/lib/corrections";
import { getActivityAccessCodes, getActivityNotes, getActivitySignatories, getAdminBoard, getBoard, getCorrections, getEntryDetails, getSignatures, listActivityDevices, listAdmins, resultsReleased } from "@/lib/data";
import { deliberationResults } from "@/lib/deliberation";
import { testToolsAllowed } from "@/lib/environment";
import { siteOrigin } from "@/lib/origin";
import { qrSvg } from "@/lib/qr";
import { reportId } from "@/lib/report";
import { expectedScores, programProgress } from "@/lib/pageant";
import { scoreProgress, withheldScores } from "@/lib/scoring";
import { canManageActivity, currentAdmin, requireAdmin, type AdminSession } from "@/lib/session";
import type { Board } from "@/lib/types";

import { SessionStatus } from "../session-status";
import { JudgesTab } from "./access-tab";
import { EntriesTab } from "./entries-tab";
import { LedTab } from "./led-tab";
import { SessionTab } from "./session-tab";
import { SegmentsTab } from "./segments-tab";
import { ArchivedSettings, SettingsTab } from "./settings-tab";
import { TabLink } from "./tab-link";
import { activityTabs, askedTab } from "./tabs";

/**
 * Organizers see only their own activities, and the super admin only those no organizer owns. Anything
 * else is "not found", not "forbidden", so it doesn't even confirm the activity exists.
 */
const dateFormat = new Intl.DateTimeFormat("en", { month: "short", day: "numeric", year: "numeric" });

function canSee(session: AdminSession | null, board: Board | null): board is Board {
  return !!board && canManageActivity(session, board.activity.ownerId);
}

export async function generateMetadata({ params }: PageProps<"/admin/[id]">): Promise<Metadata> {
  const [session, board] = await Promise.all([currentAdmin(), getBoard((await params).id)]);
  return { title: canSee(session, board) ? board.activity.name : "Activity not found" };
}

export default async function ActivityPage({ params, searchParams }: PageProps<"/admin/[id]">) {
  const id = (await params).id;
  const requested = (await searchParams).tab;
  const asked = askedTab(requested);
  // What the tab reads starts with the board rather than after it: each is a trip to the database, and the desk reloads
  // all of this after every score. Which tab opens can depend on the board (with none asked for, Judges before the
  // session and Session after), so both of those start then; one is left unused. Nothing is shown until the session
  // has been checked below.
  const early = {
    codes: asked === undefined || asked === "judges" ? getActivityAccessCodes(id) : null,
    desk:
      asked === undefined || asked === "session"
        ? Promise.all([getCorrections(id), getActivityNotes(id), getSignatures(id)])
        : null,
  };
  // The session, the board (with a pageant's deductions, for the desk) and the judges' devices, at once.
  const [session, board, devices, origin] = await Promise.all([requireAdmin(), getAdminBoard(id), listActivityDevices(id), siteOrigin()]);
  if (!canSee(session, board)) notFound();

  const { activity, judges, entries, scores } = board;
  // Before judging starts the organizer needs the judges' codes; once it's live, the session controls.
  const pageant = activity.kind === "pageant";
  const archived = activity.archivedAt !== null;
  const { tabs, tab } = activityTabs(activity, asked);
  const started = activity.sessionState !== "draft";
  const waitingDevices = devices.filter((d) => d.status === "pending").length;
  // A pageant's progress counts every sub-activity: each judge scoring each candidate still in it.
  const progress = pageant ? programProgress(board) : scoreProgress(board);
  // When this board was read, so the session desk can say how fresh it is if realtime drops. A Server Component
  // renders once per request, so the clock here is simply the request time.
  // eslint-disable-next-line react-hooks/purity
  const renderedAt = Date.now();
  const liveUrl = `${origin}/live/${activity.publicId}`;
  const ledUrl = `${origin}/led/${activity.publicId}`;
  // What the open tab needs: mostly started above, with the board.
  const [codes, desk, liveQr, organizers, settingsSignatories, entryDetails] = await Promise.all([
    tab === "judges" ? (early.codes ?? getActivityAccessCodes(id)) : new Map<string, string>(),
    tab === "session"
      ? (early.desk ?? Promise.all([getCorrections(id), getActivityNotes(id), getSignatures(id)]))
      : null,
    tab === "session" ? qrSvg(liveUrl) : "",
    tab === "settings" && session.kind === "super" ? listAdmins() : null,
    tab === "settings" ? getActivitySignatories(id) : null,
    // An event's entry details: the organizer's alone, so read only for this tab.
    tab === "entries" && activity.kind === "event" ? getEntryDetails(id) : null,
  ]);
  const [corrections, notes, signatures] = desk ?? [null, null, null];
  // An event without live scoring keeps its scores from every screen until the judges have deliberated and the
  // organizer has signed, the desk included: the private tally, behind the organizer's password, is the one place they
  // show. The desk gets which judge has scored which entry, corrections without the scores, and what the deliberation
  // needs (its ties, then the signed results) worked out here.
  const held = !resultsReleased(activity);
  const deskBoard = held ? withheldScores(board) : board;

  const scoredBy = new Map<string, number>();
  const scoredFor = new Map<string, number>();
  for (const s of scores) {
    scoredBy.set(s.judgeId, (scoredBy.get(s.judgeId) ?? 0) + 1);
    scoredFor.set(s.entryId, (scoredFor.get(s.entryId) ?? 0) + 1);
  }

  return (
    <>
      <Link href="/admin" className="text-action lg:hidden">
        Activities
      </Link>
      <div className="mt-1 flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <h1 className="title">{activity.name}</h1>
            {archived ? (
              <span className="inline-flex items-center gap-2 rounded-full bg-wash px-3 py-1 text-sm font-semibold">
                <svg viewBox="0 0 16 16" className="size-4" aria-hidden>
                  <path d="M2.5 3.5h11v3h-11zM3.5 6.5v6h9v-6M6.5 9h3" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" />
                </svg>
                Archived
              </span>
            ) : (
              <Link
                href={`/admin/${activity.id}?tab=session`}
                scroll={false}
                className="tap-target rounded-full border border-line bg-white px-3 py-1 text-sm font-semibold hover:border-field"
              >
                <SessionStatus state={activity.sessionState} pulse />
              </Link>
            )}
            {!archived && waitingDevices > 0 && (
              <Link
                href={`/admin/${activity.id}?tab=judges`}
                scroll={false}
                className="rounded-full bg-prussian px-3 py-1 text-sm font-semibold text-mint"
              >
                {waitingDevices} {waitingDevices === 1 ? "device" : "devices"} waiting for approval
              </Link>
            )}
          </div>
        </div>
      </div>

      {archived && <p className="mt-3 text-sm text-prussian/70">Archived {dateFormat.format(new Date(activity.archivedAt!))}. Read-only.</p>}

      {/* Without the sidebar (phones and tablets), the tabs are a row of pills under the name. */}
      <nav aria-label="Activity sections" className="activity-tabs -mx-4 mt-6 overflow-x-auto px-4 sm:mx-0 sm:px-0 lg:hidden">
        <ul className="flex w-max gap-1 rounded-full bg-wash p-1">
          {tabs.map((t) => (
            <li key={t.id}>
              <TabLink look="pill" href={`/admin/${activity.id}?tab=${t.id}`} active={t.id === tab}>
                {t.label}
              </TabLink>
            </li>
          ))}
        </ul>
      </nav>

      <div className="activity-panel pt-6 lg:pt-8">
        {tab === "judges" && (
          <JudgesTab
            activityId={activity.id}
            devices={devices}
            origin={origin}
            judges={judges}
            codes={codes}
            scoredBy={scoredBy}
            entryCount={entries.length}
            // A pageant judge scores each candidate once per sub-activity (or part) on their panel.
            expected={pageant ? Object.fromEntries(judges.map((j) => [j.id, expectedScores(board, j)])) : undefined}
            locked={started}
            ended={activity.sessionState === "ended"}
            pageant={pageant}
          />
        )}
        {tab === "session" && (
          <SessionTab
            board={deskBoard}
            renderedAt={renderedAt}
            devices={devices}
            progress={progress}
            reportId={reportId(board)}
            liveUrl={liveUrl}
            liveQr={liveQr}
            corrections={corrections?.map((c) => (held ? withoutValues(correctionView(board, c)) : correctionView(board, c))) ?? []}
            deliberation={activity.sessionState === "deliberation" ? deliberationResults(board, signatures) : undefined}
            archived={archived}
            hasNotes={(notes?.length ?? 0) > 0}
            signatures={signatures}
          />
        )}
        {tab === "entries" && (
          <EntriesTab
            activityId={activity.id}
            entries={entries}
            scoredFor={Object.fromEntries(scoredFor)}
            started={started}
            ended={activity.sessionState === "ended"}
            deliberating={activity.sessionState === "deliberation"}
            pageant={pageant}
            details={entryDetails}
          />
        )}
        {tab === "segments" && pageant && <SegmentsTab board={board} />}
        {tab === "led" && <LedTab board={deskBoard} ledUrl={ledUrl} />}
        {tab === "settings" && archived && <ArchivedSettings activityId={activity.id} name={activity.name} />}
        {tab === "settings" && !archived && (
          <SettingsTab
            activity={activity}
            developer={testToolsAllowed()}
            scoreCount={scores.length}
            signatories={settingsSignatories ?? []}
            organizers={organizers?.map((a) => ({ id: a.id, name: a.name, email: a.email })) ?? null}
          />
        )}
      </div>
    </>
  );
}
