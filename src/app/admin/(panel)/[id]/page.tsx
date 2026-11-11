import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { correctionView, withoutValues } from "@/lib/corrections";
import { activityChangedAt, getActivityAccessCodes, getActivityNotes, getActivitySignatories, getAdminBoard, getBoard, getCorrections, getEntryDetails, getSignatures, listActivityDevices, listAdmins, resultsReleased, withEntryDetails } from "@/lib/data";
import { deliberationResults } from "@/lib/deliberation";
import { chairMovesEntries, judgesLocked } from "@/lib/judging";
import { testToolsAllowed } from "@/lib/environment";
import { siteOrigin } from "@/lib/origin";
import { qrSvg } from "@/lib/qr";
import { expectedScores, programProgress } from "@/lib/pageant";
import { scoreProgress, withheldScores } from "@/lib/scoring";
import { canManageActivity, currentAdmin, requireAdmin, type AdminSession } from "@/lib/session";
import type { Board } from "@/lib/types";
import { LiveSince } from "@/lib/use-live-refresh";
import { BackLink } from "../back-link";

import { SessionStatus } from "../session-status";
import { JudgesTab } from "./access-tab";
import { CatchUp } from "./judge-devices";
import { EntriesTab } from "./entries-tab";
import { JudgesIn } from "./judges-in";
import { LedTab } from "./led-tab";
import { SessionTab } from "./session-tab";
import { SegmentsTab } from "./segments-tab";
import { SettingsTab } from "./settings-tab";
import { TabLink } from "./tab-link";
import { activityTabs, askedTab } from "./tabs";
import { PanelSkeleton } from "../skeletons";
import { archiveBlocked, scoresGoOutLive } from "@/lib/lifecycle";

/**
 * Organizers see only their own activities, and the super admin only those no organizer owns. Anything
 * else is "not found", not "forbidden", so it doesn't even confirm the activity exists.
 */
const dateFormat = new Intl.DateTimeFormat("en", { month: "short", day: "numeric", year: "numeric" });

/** A tab's width in the phones' grid of six columns: a row of three, two, or one. */
const COL_SPAN: Record<number, string> = { 1: "col-span-6", 2: "col-span-3", 3: "col-span-2" };

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
  // When the activity last changed, read before anything else on the page. The page's live checks compare with it, so
  // a page shown again from the browser's cache (staleTimes in next.config.ts) reloads only if something has changed.
  const since = await activityChangedAt(id);
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
  // Before the session starts, every judge on their screen with an approved device: ready to start.
  const allIn = activity.sessionState === "draft" && judges.length > 0 && judges.every((j) => devices.some((d) => d.judgeId === j.id && d.status === "approved"));
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

  // On phones, a row of tabs for running the show and one for setting it up (or one row, for an archived activity's two).
  const rows = tabs.length > 3 ? [tabs.filter((t) => t.group === "show"), tabs.filter((t) => t.group === "setup")] : [tabs];
  const span = new Map(rows.flatMap((row) => row.map((t) => [t.id, COL_SPAN[row.length] ?? "col-span-2"] as const)));

  return (
    <LiveSince changedAt={since}>
      {/* The name stays put as tabs change; only the tab below it arrives (see main > * in globals.css). */}
      <div className="activity-head">
        <BackLink href="/admin">Activities</BackLink>
        <h1 className="title mt-1">{activity.name}</h1>
        {/* Under the name: where the session stands (or when it was archived), devices waiting, and where it happens. */}
        <div className="mt-2.5 flex flex-wrap items-center gap-x-2 gap-y-2">
          {archived ? (
            // Just the date: it sits under Archived in the sidebar already. Screen readers hear what it's the date of.
            <p className="text-sm text-prussian/75">
              <span className="sr-only">Archived </span>
              <time dateTime={activity.archivedAt!}>{dateFormat.format(new Date(activity.archivedAt!))}</time>
            </p>
          ) : (
            <Link
              href={`/admin/${activity.id}?tab=session`}
              scroll={false}
              className="tap-target rounded-full border border-line bg-white px-3 py-1 text-sm font-semibold hover:border-field"
            >
              <SessionStatus state={activity.sessionState} onAir={scoresGoOutLive(activity)} pulse />
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
          {activity.location && (
            <p className="inline-flex min-w-0 items-center gap-1.5 px-1 text-sm text-prussian/75">
              <svg viewBox="0 0 16 16" className="size-4 shrink-0" aria-hidden>
                <path d="M8 14.5s4.5-4.2 4.5-7.7a4.5 4.5 0 00-9 0c0 3.5 4.5 7.7 4.5 7.7z" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
                <circle cx="8" cy="6.8" r="1.6" fill="none" stroke="currentColor" strokeWidth="1.5" />
              </svg>
              <span className="sr-only">Location: </span>
              <span className="truncate">{activity.location}</span>
            </p>
          )}
        </div>
      </div>

      {/*
        Without the sidebar's tree (phones and tablets, or the sidebar collapsed), the tabs sit under the name: on phones
        a grid, every tab in reach at once with nothing to scroll sideways; wider, one row of pills.
      */}
      {tabs.length > 1 && (
        <nav aria-label="Activity sections" className="activity-tabs page-tabs mt-6 lg:hidden">
          <ul className="grid grid-cols-6 gap-1 rounded-[1.375rem] bg-wash p-1 md:flex md:w-max md:max-w-full md:flex-wrap md:rounded-full">
            {tabs.map((t) => (
              <li key={t.id} className={span.get(t.id)}>
                <TabLink look="pill" href={`/admin/${activity.id}?tab=${t.id}`} tab={t.id} active={t.id === tab}>
                  {t.label}
                </TabLink>
              </li>
            ))}
          </ul>
        </nav>
      )}

      {allIn && tab !== "session" && <JudgesIn activityId={activity.id} count={judges.length} />}

      {/* While another tab opens, its skeleton covers this one (see .tab-skeleton in globals.css). */}
      <div className="relative">
        <div className="activity-panel pt-6 lg:pt-8">
          {tab === "judges" && (
            <JudgesTab
              activityId={activity.id}
              devices={devices}
              origin={origin}
              // With live scoring there's no chair (only the organizer moves between entries), even one set before.
              judges={chairMovesEntries(activity) ? judges : judges.map((j) => ({ ...j, isChair: false }))}
              chairs={chairMovesEntries(activity)}
              codes={codes}
              scoredBy={scoredBy}
              entryCount={entries.length}
              // A pageant judge scores each candidate once per sub-activity (or part) on their panel.
              expected={pageant ? Object.fromEntries(judges.map((j) => [j.id, expectedScores(board, j)])) : undefined}
              locked={judgesLocked(activity)}
              reset={!started && judgesLocked(activity)}
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
          {tab === "led" && <LedTab board={await withEntryDetails(deskBoard)} ledUrl={ledUrl} />}
          {tab === "settings" && !archived && (
            <SettingsTab
              activity={activity}
              developer={testToolsAllowed()}
              scoreCount={scores.length}
              archiveBlocked={archiveBlocked(activity, progress)}
              signatories={settingsSignatories ?? []}
              organizers={organizers?.map((a) => ({ id: a.id, name: a.name, email: a.email })) ?? null}
            />
          )}
        </div>
        <PanelSkeleton className="tab-skeleton absolute inset-x-0 top-0 min-h-full bg-mint pt-6 lg:pt-8" />
      </div>
      {/* The tabs that don't keep themselves live check once, as they open, that they're current. */}
      {(tab === "entries" || tab === "segments" || (tab === "settings" && !archived)) && <CatchUp activityId={activity.id} since={since} />}
    </LiveSince>
  );
}
