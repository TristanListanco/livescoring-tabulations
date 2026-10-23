import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { correctionView, withoutValues } from "@/lib/corrections";
import { getActivityAccessCodes, getActivityNotes, getActivitySignatories, getActivitySignoff, getAdminBoard, getBoard, getCorrections, getSignatures, listActivityDevices, listAdmins, resultsReleased } from "@/lib/data";
import { deliberationResults } from "@/lib/deliberation";
import { testToolsAllowed } from "@/lib/environment";
import { siteOrigin } from "@/lib/origin";
import { qrSvg } from "@/lib/qr";
import { reportId } from "@/lib/report";
import { expectedScores, programProgress } from "@/lib/pageant";
import { scoreProgress, withheldScores } from "@/lib/scoring";
import { canManageActivity, currentAdmin, requireAdmin, type AdminSession } from "@/lib/session";
import type { Board } from "@/lib/types";
import { DeleteArchivedButton } from "../archive-controls";
import { SessionStatus } from "../session-status";
import { JudgesTab } from "./access-tab";
import { EntriesTab } from "./entries-tab";
import { LedTab } from "./led-tab";
import { SessionTab } from "./session-tab";
import { SegmentsTab } from "./segments-tab";
import { SettingsTab } from "./settings-tab";
import { TabLink } from "./tab-link";

/**
 * In the order of an event day: what runs the show (the session desk, the judges and their devices, the LED wall),
 * then what's set up beforehand. The test site tools are in Settings.
 */
type Tab = {
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
  const asked = typeof requested === "string" ? (MOVED[requested] ?? requested) : undefined;
  // What the tab reads starts with the board rather than after it: each is a trip to the database, and the desk reloads
  // all of this after every score. Which tab opens can depend on the board (with none asked for, Judges before the
  // session and Session after), so both of those start then; one is left unused. Nothing is shown until the session
  // has been checked below.
  const early = {
    codes: asked === undefined || asked === "judges" ? getActivityAccessCodes(id) : null,
    desk:
      asked === undefined || asked === "session"
        ? Promise.all([getCorrections(id), getActivityNotes(id), getActivitySignatories(id), getSignatures(id), getActivitySignoff(id)])
        : null,
  };
  // The session, the board (with a pageant's deductions, for the desk) and the judges' devices, at once.
  const [session, board, devices, origin] = await Promise.all([requireAdmin(), getAdminBoard(id), listActivityDevices(id), siteOrigin()]);
  if (!canSee(session, board)) notFound();

  const { activity, judges, entries, scores } = board;
  // Before judging starts the organizer needs the judges' codes; once it's live, the session controls.
  const pageant = activity.kind === "pageant";
  const allTabs = pageant ? PAGEANT_TABS : TABS;
  // Archived: read-only, so only its results, on the Session tab (the judges' notes download there too).
  const archived = activity.archivedAt !== null;
  const tabs = archived ? allTabs.filter((t) => t.id === "session").map((t) => ({ ...t, label: "Results" })) : allTabs;
  const tab = tabs.find((t) => t.id === asked)?.id ?? (activity.sessionState === "draft" ? "judges" : "session");
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
  const [codes, desk, liveQr, organizers, settingsSignatories] = await Promise.all([
    tab === "judges" ? (early.codes ?? getActivityAccessCodes(id)) : new Map<string, string>(),
    tab === "session"
      ? (early.desk ?? Promise.all([getCorrections(id), getActivityNotes(id), getActivitySignatories(id), getSignatures(id), getActivitySignoff(id)]))
      : null,
    tab === "session" ? qrSvg(liveUrl) : "",
    tab === "settings" && session.kind === "super" ? listAdmins() : null,
    tab === "settings" ? getActivitySignatories(id) : null,
  ]);
  const [corrections, notes, signatories, signatures, signoff] = desk ?? [null, null, null, null, null];
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
      <Link href="/admin" className="text-action">
        Activities
      </Link>
      <div className="mt-1 flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <h1 className="text-3xl font-bold tracking-tight text-balance wrap-anywhere">{activity.name}</h1>
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

      {archived && (
        <div role="note" className="note mt-5 flex flex-wrap items-center justify-between gap-x-6 gap-y-3">
          <p className="max-w-2xl">
            Archived {dateFormat.format(new Date(activity.archivedAt!))}. It can&apos;t be reopened or changed. Its results and score sheets still download
            below.
          </p>
          <DeleteArchivedButton activityId={activity.id} name={activity.name} className="btn btn-sm btn-danger-quiet" />
        </div>
      )}

      <nav
        aria-label="Activity sections"
        className="activity-tabs mt-6 -mr-4 overflow-x-auto border-b border-line [mask-image:linear-gradient(to_right,black_85%,transparent)] sm:mr-0 sm:[mask-image:none]"
      >
        <ul className="flex min-w-max gap-1">
          {tabs.map((t, i) => {
            const active = t.id === tab;
            const startsGroup = i > 0 && tabs[i - 1].group !== t.group && t.group === "setup";
            return (
              <li
                key={t.id}
                className={
                  startsGroup
                    ? "relative ml-2 pl-2 before:absolute before:top-1/2 before:left-0 before:h-5 before:w-px before:-translate-y-1/2 before:bg-line"
                    : undefined
                }
              >
                <TabLink href={`/admin/${activity.id}?tab=${t.id}`} active={active}>
                  {t.label}
                </TabLink>
              </li>
            );
          })}
        </ul>
      </nav>

      <div className="activity-panel pt-6">
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
            signatories={signatories}
            liveUrl={liveUrl}
            liveQr={liveQr}
            corrections={corrections?.map((c) => (held ? withoutValues(correctionView(board, c)) : correctionView(board, c))) ?? []}
            deliberation={activity.sessionState === "deliberation" ? deliberationResults(board, signatures) : undefined}
            archived={archived}
            hasNotes={(notes?.length ?? 0) > 0}
            signatures={signatures}
            signoff={signoff}
          />
        )}
        {tab === "entries" && (
          <EntriesTab
            activityId={activity.id}
            entries={entries}
            scoredFor={Object.fromEntries(scoredFor)}
            started={started}
            ended={activity.sessionState === "ended"}
            pageant={pageant}
          />
        )}
        {tab === "segments" && pageant && <SegmentsTab board={board} />}
        {tab === "led" && <LedTab board={deskBoard} ledUrl={ledUrl} />}
        {tab === "settings" && (
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
