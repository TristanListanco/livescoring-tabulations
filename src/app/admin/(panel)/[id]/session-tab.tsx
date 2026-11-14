"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useContext, useEffect, useId, useOptimistic, useRef, useState, useTransition } from "react";
import { Avatar } from "@/components/avatar";
import { CopyButton } from "@/components/copy-button";
import { LiveStatusBadge } from "@/components/live-status";
import { QrDialog } from "@/components/qr-dialog";
import { ConfirmDialog } from "@/components/confirm-dialog";
import type { CorrectionView } from "@/lib/corrections";
import { atOwnPace, entryNeighbors, eventTimer } from "@/lib/judging";
import { listNames } from "@/lib/names";
import { finalCutRound, judgesFor, placeTitle, preliminaryEndGap, roundDeliberating, roundLabel, roundProgress, showingBoard, unitOf } from "@/lib/pageant";
import { reach } from "@/lib/reach";
import { averageText, liveStandings, rankEntries } from "@/lib/scoring";
import { unsignedJudges, type DeliberationResults } from "@/lib/deliberation";
import { breakFor, ordinal } from "@/lib/ties";
import type { ActionResult, Board, Entry, Judge, JudgeDevice, JudgeSignature } from "@/lib/types";
import { JUDGING_OVER, useLiveRefresh, type LiveStatus } from "@/lib/use-live-refresh";
import { moveSegment, setCurrentEntry, setSessionState } from "../../actions";
import { ArchiveButton, DeleteArchivedButton } from "../archive-controls";
import { archiveBlocked, runningSegment, type SegmentMove } from "@/lib/lifecycle";
import { FormMessage } from "../form-message";
import { toast } from "../toaster";
import { CorrectionsPanel } from "./corrections-panel";
import { FinalSignOff } from "./final-signoff";
import { ApproveDeviceButton } from "./judge-devices";
import { ExportMenu, HeldLink, PdfHold, sheetOptions } from "./export-menu";
import { PageantScoring } from "./pageant-scoring";
import { CutDialog, DeductionsButton, DeskTimer, FinalPlacements, JudgeRoundButton, nextUp, PdfLink, ProgramPanel, RoundDeliberationDesk, StartRoundDeliberation } from "./pageant-desk";

type Progress = { submitted: number; possible: number; complete: boolean };

/**
 * The clock, ticking only while something on screen needs it (the "updated N seconds ago" line). Null until
 * the first tick, so the server render and the first client render agree.
 */
function useNow(active: boolean, everyMs = 5000): number | null {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    if (!active) return;
    const tick = () => setNow(Date.now());
    const first = setTimeout(tick, 0);
    const timer = setInterval(tick, everyMs);
    return () => {
      clearTimeout(first);
      clearInterval(timer);
    };
  }, [active, everyMs]);
  return active ? now : null;
}

// On the desk the session itself is "Live", so the connection says whether this screen is keeping up. These names
// are announced when the connection changes; the freshness only shows, so it isn't re-read every tick.
/**
 * Whether this desk keeps itself current: it's about the desk's own connection, not the judges' (the desk lists who's
 * paired), so it says what the desk does rather than "Connected", which read as the judges being in.
 */
const CONNECTION_LABELS = { polling: "Updating every 15 seconds" };

/**
 * The desk's connection badge. It owns the "updated N seconds ago" clock, so each tick re-renders just this badge
 * rather than the whole desk, its judge tiles and the running order.
 */
function DeskConnection({ status, renderedAt, className }: { status: LiveStatus; renderedAt: number; className: string }) {
  const now = useNow(status === "polling");
  const secondsOld = now === null ? null : Math.max(0, Math.round((now - renderedAt) / 1000));
  const freshness = status === "polling" && secondsOld !== null ? (secondsOld < 5 ? "Updated just now" : `Updated ${secondsOld} seconds ago`) : undefined;
  return <LiveStatusBadge status={status} labels={CONNECTION_LABELS} detail={freshness} compact className={className} />;
}

/**
 * The results PDF link, or (`sheets`) the judges' score sheets that go with it: one page per judge, with their
 * scores (and each criterion's points) and their sign-off. The time zone goes along so the sheet's printed time
 * matches the venue's clock.
 */
export function DownloadResults({
  activityId,
  sheets = false,
  notes = false,
  className,
}: {
  activityId: string;
  /** The judges' score sheets rather than the results. */
  sheets?: boolean;
  /** The judges' notes, a PDF of their own. They aren't results, so an open correction doesn't hold them. */
  notes?: boolean;
  className: string;
}) {
  const hold = useContext(PdfHold);
  const held = notes ? null : hold;
  const sheet = notes ? "notes" : sheets ? "judges" : null;
  const href = `/admin/${activityId}/export${sheet ? `?sheet=${sheet}` : ""}`;
  const label = notes ? "Download judges' notes" : sheets ? "Download judges' score sheets" : "Download results PDF";
  if (held) {
    return (
      <HeldLink reason={held} className={className}>
        {label}
      </HeldLink>
    );
  }
  return (
    <a
      href={href}
      onClick={(e) => {
        e.currentTarget.href = `${href}${sheet ? "&" : "?"}tz=${encodeURIComponent(Intl.DateTimeFormat().resolvedOptions().timeZone)}`;
        toast(label.replace(/^Download/, "Downloading"));
      }}
      className={className}
      download
    >
      {label}
    </a>
  );
}

const check = (
  <svg viewBox="0 0 16 16" className="size-4 shrink-0" aria-hidden>
    <path d="M3 8.5l3 3 7-7" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

/**
 * One judge on the desk. While an entry is up, the judges still scoring stand out and the ones who are done
 * step back, because the operator's question is "who are we waiting on?". A judge without a working device
 * says so, with the approval right there when their device is asking for it. So does a judge whose approved device
 * is being replaced (a phone that died mid-show): the new one asks under their state.
 */
function JudgeTile({
  judge,
  devices,
  scored,
  stacked = false,
}: {
  judge: Judge;
  devices: JudgeDevice[];
  scored: boolean | null;
  /** Name over state, for the live desk's narrow four-across tiles. */
  stacked?: boolean;
}) {
  const approved = devices.some((d) => d.status === "approved");
  const requests = devices.filter((d) => d.status === "pending");
  const waiting = scored === false && approved;

  let state: React.ReactNode;
  if (scored) {
    state = (
      <span className="flex items-center gap-1.5 text-sm font-semibold text-powder">
        {check}
        Scored
      </span>
    );
  } else if (approved) {
    state =
      scored === null ? (
        <span className="flex items-center gap-1.5 text-sm font-semibold text-mint">
          {check}
          Device approved
        </span>
      ) : (
        <span className="text-sm font-bold text-mint">Still scoring</span>
      );
  } else if (requests.length > 0) {
    state = null;
  } else {
    state = <span className="text-sm font-semibold text-danger-soft">No device</span>;
  }
  // Devices asking for approval: the judge's first, or a replacement for the approved one.
  const asking = requests.length > 0 && (
    <span className={`flex flex-wrap items-center gap-1.5 ${stacked ? "" : "justify-end"}`}>
      {approved && <span className="text-xs font-semibold text-mint">New device</span>}
      {requests.map((d) => (
        <ApproveDeviceButton key={d.id} judge={judge} device={d} className="btn btn-sm bg-mint text-prussian hover:bg-white" />
      ))}
    </span>
  );

  const tone = scored ? "bg-oxford/45 text-mint/75" : waiting ? "bg-oxford ring-1 ring-powder/50" : "bg-oxford";

  if (stacked) {
    return (
      <li
        className={`flex items-center gap-2.5 rounded-xl px-3 py-1.5 leading-5 ${tone} ${requests.length > 0 ? "@2xl:col-span-2" : ""}`}
        title={judge.name}
      >
        <Avatar name={judge.name} src={judge.photoUrl} size={32} />
        <div className="min-w-0 flex-1">
          <p className="flex min-w-0 items-baseline gap-1.5">
            <span className="truncate font-semibold">{judge.name}</span>
            {judge.isChair && <span className="shrink-0 text-xs font-semibold text-powder">Chair</span>}
          </p>
          {state && <div className="mt-0.5">{state}</div>}
          {asking && <div className="mt-1">{asking}</div>}
        </div>
      </li>
    );
  }

  return (
    <li className={`flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl px-3 py-2.5 ${tone}`}>
      <Avatar name={judge.name} src={judge.photoUrl} size={36} />
      <span className="min-w-0 flex-1 truncate font-semibold">{judge.name}</span>
      {judge.isChair && <span className="text-xs font-semibold text-powder">Chair</span>}
      {state}
      {asking}
    </li>
  );
}

/** One step of the break between a pageant's segments: numbered, because they're done in this order; ticked once done. */
function BreakStep({ n, title, status, done = false, children }: { n: number; title: string; status?: string; done?: boolean; children: React.ReactNode }) {
  const id = useId();
  return (
    <li aria-labelledby={id}>
      <div className="flex items-center gap-3">
        <span
          aria-hidden
          className={`tabular flex size-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold ${done ? "bg-mint text-prussian" : "border border-powder/60 text-powder"}`}
        >
          {done ? check : n}
        </span>
        <h3 id={id} className="font-semibold">
          {title}
          {done && <span className="sr-only">, done</span>}
        </h3>
        {status && <span className="tabular text-sm text-powder">{status}</span>}
      </div>
      <div className="mt-1 pl-9">{children}</div>
    </li>
  );
}

export function SessionTab({
  board,
  renderedAt,
  devices,
  progress,
  liveUrl,
  liveQr,
  corrections,
  archived = false,
  hasNotes = false,
  signatures = null,
  deliberation,
  roundSignatures = null,
}: {
  /** A pageant sub-activity being deliberated: its judges' signatures so far (null before migration 040). */
  roundSignatures?: JudgeSignature[] | null;
  /** Without score values while they're withheld (see withheldScores): then `scored` says who has scored what. */
  board: Board;
  /** When the server read this board, so a desk running on fallback updates can say how fresh it is. */
  renderedAt: number;
  devices: JudgeDevice[];
  progress: Progress;
  liveUrl: string;
  liveQr: string;
  /** Score corrections, oldest first (empty before migration 019). */
  corrections: CorrectionView[];
  /** Archived: its results to read and download, nothing to change (no reopening, no ranks switch). */
  archived?: boolean;
  /** The judges wrote notes: they download as a PDF of their own beside the results. */
  hasNotes?: boolean;
  /** The judges' signatures, during and after a deliberation (null before migration 021). */
  signatures?: JudgeSignature[] | null;
  /** During a deliberation: its ties and, once every judge has signed, the results, worked out on the server. */
  deliberation?: DeliberationResults;
}) {
  const pageant = board.activity.kind === "pageant";
  const connection = useLiveRefresh(board.activity.id, board.activity.sessionState === "ended" ? { ...JUDGING_OVER, enabled: !archived } : {});
  // A correction being voted on may still change a score: the results PDFs wait for it.
  const held = corrections.some((c) => c.status === "open") ? "Waits until the score correction is settled" : null;
  // A pageant's desk runs the sub-activity being judged: its candidates and its scores. Between sub-activities it
  // lists every candidate, and the program says what to judge next.
  const { board: shown, round } = showingBoard(board);
  const between = pageant && !round;
  // A pageant sub-activity (or part) whose judges are deliberating it: the desk shows who has signed, then its sign-off.
  const underReview = round && roundDeliberating(round) ? round : null;
  const { activity, judges, entries, scores } = between ? { ...board, scores: [] } : shown;
  const noun = pageant ? "candidate" : "entry";
  const [cutOpen, setCutOpen] = useState<string | null>(null);
  const cutDialog = pageant && <CutDialog key={cutOpen ?? "none"} board={board} roundId={cutOpen} onClose={() => setCutOpen(null)} />;
  const [current, setCurrent] = useOptimistic(activity.currentEntryId);
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<ActionResult | null>(null);
  const [moveError, setMoveError] = useState<string | null>(null);
  // Sent here by "All judges are in" (see JudgesIn) to start: Start session (a pageant's preliminary), or pageant proper
  // in the break, asks at once, and the address forgets it.
  const asked = useSearchParams().get("start");
  const askedToStart = asked === "1";
  const askedToStartProper = asked === "proper";
  useEffect(() => {
    if (asked) window.history.replaceState(null, "", `${window.location.pathname}?tab=session`);
  }, [asked]);
  const textAction =
    "inline-flex h-7 items-center rounded px-1.5 text-sm font-semibold text-regal hover:bg-wash pointer-coarse:h-11 pointer-coarse:min-w-11 pointer-coarse:justify-center pointer-coarse:px-2.5";

  /** The live results' QR code, in a dialog: for the audience to scan from a screen, or to open them on a phone. */
  const liveQrDialog = (className: string) => (
    <QrDialog
      triggerClassName={className}
      trigger={
        <>
          QR code<span className="sr-only"> for live results</span>
        </>
      }
      title="Live results"
      svg={liveQr}
      label="QR code for the live results page"
    >
      Scan it to follow the live results on a phone.
    </QrDialog>
  );

  /**
   * The audience's screen mid-show, one compact card beside the live desk: the live results (copy, open, QR code).
   * Whether they rank is in Settings, and the LED wall's link is on its own tab. `extra`: what follows them (the
   * results downloads). Before and after the show it's liveResultsCard, under the desk.
   */
  const screens = (extra?: React.ReactNode) => (
    // Folded, as Scoring is: mid-show it's wanted now and then, and the running order needs the room.
    <details className="card shrink-0 px-5 py-3 text-sm" open={!!extra || undefined}>
      <summary className="flex cursor-pointer items-center gap-2 font-semibold pointer-coarse:min-h-11">
        Live results{(pageant || !activity.liveScoring) && " and private tally"}
      </summary>
      <div className="mt-3 space-y-2 border-t border-line pt-3">
        {/* Each row says what it is, and each button what it does; screen readers also hear which screen it's for. */}
        <div className="flex flex-wrap items-center gap-x-1">
          <span className="min-w-0 flex-1 truncate font-semibold">Live results</span>
          <CopyButton value={liveUrl} label="Copy link" ariaLabel="Copy link to live results" className={textAction} />
          <a href={liveUrl} target="_blank" rel="noreferrer" aria-label="Open live results" className={textAction}>
            Open
          </a>
          {liveQrDialog(`${textAction} gap-1.5`)}
        </div>
        {/* The scores so far, for this admin only: to tabulate by hand if judging fails. Not a link to share. A pageant's
            too: its standings, and any sub-activity holding its scores back, are the organizer's alone. */}
        {(pageant || !activity.liveScoring) && (
          <div className="flex flex-wrap items-center gap-x-1 border-t border-line pt-2">
            <span className="min-w-0 flex-1 font-semibold">Private tally</span>
            <a href={`/admin/${activity.id}/tally`} target="_blank" rel="noreferrer" aria-label="Open the private tally" className={textAction}>
              Open
            </a>
          </div>
        )}
        {/* The judges' notes, for the organizer's reference while the show runs; once it ends they download with the results. */}
        {hasNotes && (
          <div className="pt-1">
            <DownloadResults activityId={activity.id} notes className={`${textAction} -ml-1.5`} />
          </div>
        )}
        {extra}
      </div>
    </details>
  );

  /*
   * The live results, under the desk whenever it isn't running the show (before it, while the judges deliberate, and
   * once judging has ended, until the activity is archived): what the audience sees there now, then the address with
   * Copy, Open and the QR code as one group (whether it ranks is in Settings). Mid-show it's the compact card beside
   * the desk (screens).
   */
  const segment =
    "inline-flex h-10 items-center justify-center gap-1.5 px-4 text-sm font-semibold text-regal transition-colors hover:bg-wash max-sm:flex-1 pointer-coarse:h-11";
  const liveResultsCard = (now: string | null) => (
    <section aria-labelledby="live-results" className="card overflow-hidden">
      <div className="p-5 sm:px-6">
        <div className="flex items-start gap-3.5">
          {/* A screen with a rising bar: the page the audience follows. */}
          <span aria-hidden className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-regal text-mint">
            <svg viewBox="0 0 20 20" className="size-5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
              <rect x="2.5" y="3.5" width="15" height="10.5" rx="2" />
              <path d="M7 17h6M6.5 11V9M10 11V6.5M13.5 11V8" />
            </svg>
          </span>
          <div className="min-w-0">
            <h2 id="live-results" className="title-sm">
              Live results
            </h2>
            {now && <p className="mt-0.5 text-[15px] text-prussian/75">{now}</p>}
          </div>
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <code className="tabular min-w-0 flex-1 basis-full truncate rounded-full border border-line bg-wash/50 px-4 py-2 text-[15px] sm:basis-0">
            {liveUrl.replace(/^https?:\/\//, "")}
          </code>
          <div className="flex divide-x divide-line overflow-hidden rounded-full border border-line bg-white max-sm:w-full">
            <CopyButton value={liveUrl} label="Copy link" ariaLabel="Copy link to live results" className={segment} />
            <a href={liveUrl} target="_blank" rel="noreferrer" aria-label="Open live results" className={segment}>
              Open
              <svg viewBox="0 0 16 16" className="size-3.5" aria-hidden>
                <path d="M6 3.5h6.5V10M12.5 3.5L4 12" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </a>
            {liveQrDialog(segment)}
          </div>
        </div>
      </div>
      {/* Whether the page ranks is set in Settings. Under the address, what's for the organizer alone, while it's on. */}
      <div className="space-y-3 border-t border-line px-5 py-4 empty:hidden sm:px-6">
        {/* The scores so far, for this admin only: to tabulate by hand if judging fails. Not a link to share. */}
        {state !== "ended" && (pageant || !activity.liveScoring) && (
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <span className="font-medium">Private tally</span>
            <span className="hint text-sm">Every score so far, for you alone</span>
            <a href={`/admin/${activity.id}/tally`} target="_blank" rel="noreferrer" aria-label="Open the private tally" className={`${textAction} ml-auto`}>
              Open
            </a>
          </div>
        )}
        {/* The judges' notes, until the show ends; then they download with the results. */}
        {state !== "ended" && hasNotes && <DownloadResults activityId={activity.id} notes className={`${textAction} -ml-1.5`} />}
      </div>
    </section>
  );

  // Moving between entries and changing the session go through reach(): a request lost on venue Wi-Fi
  // comes back as a message beside the button instead of taking the desk down.
  const move = async (entryId: string | null): Promise<ActionResult> => {
    setCurrent(entryId);
    const r = await reach(() => setCurrentEntry(activity.id, entryId));
    setMoveError(r.ok ? null : r.error);
    // "Show the first entry when you're ready" and the like are stale once an entry is up.
    if (r.ok) setResult(null);
    return r;
  };
  const show = (entryId: string | null) => startTransition(async () => void (await move(entryId)));
  const changeState = async (state: "live" | "deliberation" | "ended", password?: string, signature?: string | null) => {
    const r = await reach(() => setSessionState(activity.id, state, password, signature));
    // A wrong password shows in the dialog, which stays open.
    if (r.ok || state !== "ended") setResult(r);
    return r;
  };
  // A pageant's segment being judged: the preliminary, then pageant proper; null between the two (and when not live).
  const judging = pageant ? runningSegment(board.activity) : null;
  const changeSegment = async (move: SegmentMove, password?: string) => {
    const r = await reach(() => moveSegment(activity.id, move, password));
    if (r.ok || move !== "endPreliminary") setResult(r);
    return r;
  };

  const offline = connection === "offline" && (
    <p role="alert" className="flex items-start gap-2.5 bg-danger-soft px-6 py-3 text-sm font-semibold text-prussian">
      <svg viewBox="0 0 20 20" className="mt-px size-4 shrink-0" aria-hidden>
        <path
          d="M2.5 7.5a11 11 0 0115 0M5 10.5a7.5 7.5 0 0110 0M7.6 13.4a3.6 3.6 0 014.8 0M10 16.5h.01M3 3l14 14"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
        />
      </svg>
      This screen is offline. What you see may be out of date, and nothing you do here reaches the judges or the LED wall until it reconnects.
    </p>
  );

  const { index, entry, previous, next } = entryNeighbors(entries, current);
  // Who has scored what, from the scores, or while they're withheld from which judge has scored which entry.
  const marks: { entryId: string; judgeId: string }[] = between ? [] : (shown.scored ?? scores);
  const scoredBy = new Set(marks.filter((s) => s.entryId === entry?.id).map((s) => s.judgeId));
  const stillScoring = judges.filter((j) => !scoredBy.has(j.id));
  const allIn = entry !== null && judges.length > 0 && stillScoring.length === 0;
  const state = activity.sessionState;
  const live = state === "live";
  const scoreCount = (entryId: string) => marks.filter((s) => s.entryId === entryId).length;
  const devicesOf = (judgeId: string) => devices.filter((d) => d.judgeId === judgeId);
  const unpaired = judges.filter((j) => !devicesOf(j.id).some((d) => d.status === "approved"));
  // Who the start opens screens for: a pageant's preliminary judges, or everyone.
  const startBoard = pageant ? judges.filter((j) => j.panel !== "proper") : judges;
  const startUnpaired = pageant ? unpaired.filter((j) => j.panel !== "proper") : unpaired;
  // A pageant with separate boards, before the start: its judges by board, in the order they judge. Pageant proper's own
  // judges come later, so the desk shows them stepping back.
  const boardGroups =
    pageant && judges.some((j) => j.panel !== "all")
      ? [
          { key: "preliminary", title: "Preliminary", note: "Judges the preliminary only.", later: false, judges: judges.filter((j) => j.panel === "preliminary") },
          { key: "all", title: "Both segments", note: "Judges the preliminary, then pageant proper.", later: false, judges: judges.filter((j) => j.panel === "all") },
          {
            key: "proper",
            title: "Pageant proper",
            note: "Judges once pageant proper starts, after the preliminary. They can pair now or then.",
            later: true,
            judges: judges.filter((j) => j.panel === "proper"),
          },
        ].filter((g) => g.judges.length > 0)
      : null;
  const missing = progress.possible - progress.submitted;
  const missingLine = `${missing} ${missing === 1 ? "score is" : "scores are"} missing`;
  // Ending with scores missing: said in the end's own dialog, with who hasn't scored every entry (an event's).
  const behind = pageant ? [] : judges.filter((j) => scores.filter((s) => s.judgeId === j.id).length < entries.length);
  const missingWarning = missing > 0 && state === "live" && (
    <span className="mb-3 block font-semibold text-prussian">
      {missingLine}
      {behind.length > 0 &&
        `: ${behind.length <= 3 ? listNames(behind) : `${behind.length} judges`} ${behind.length === 1 ? "hasn't" : "haven't"} scored every entry`}
      .
    </span>
  );
  // An event with live scoring that ended with every score in: by itself, and for good (see setSessionState).
  const endedForGood = state === "ended" && activity.kind === "event" && activity.liveScoring && progress.complete;
  /** Once judging has ended, every download in one menu; a pageant's are in its program instead. */
  const exportMenu = (className: string) =>
    progress.complete &&
    !pageant && (
      <ExportMenu
        activityId={activity.id}
        options={[
          ...sheetOptions("", { judges: true }),
          ...(hasNotes ? [{ label: "Judges' notes (PDF)", query: "sheet=notes", held: false }] : []),
        ]}
        className={className}
      />
    );

  /*
   * On air: what the audience's screens show right now, in the desk's own words, so the operator never has to open
   * them to check. The live results page shows the entry being judged as it stands; the LED wall follows the entry
   * shown, in its display, with its scores as its settings let them through.
   */
  const heldBack = !activity.liveScoring && !activity.signedOffAt;
  // As the live results show it: a rank only once every judge is in (see liveStandings).
  const standing = entry && !heldBack ? liveStandings(rankEntries(entries, judges, scores, activity), judges.length).find((r) => r.entry.id === entry.id) : undefined;
  const liveNow = heldBack
    ? "A tick for each score in; the scores show once the judges have signed"
    : !standing
      ? activity.showRank
        ? `Every ${noun}, ranked by average`
        : `Every ${noun}, in running order`
      : standing.count === 0
        ? `${standing.entry.name}: no scores yet`
        : [
            activity.showRank && standing.rank ? `Rank ${standing.rank}` : null,
            `${averageText(standing.average, activity)} average`,
            standing.count < judges.length ? `${standing.count} of ${judges.length} judges` : null,
          ]
            .filter(Boolean)
            .join(" · ");
  const ledEntry = entries.find((e) => e.id === activity.ledEntryId);
  const ledNow = [
    activity.ledFullscreen ? "Full screen" : "Green screen overlay",
    ledEntry ? ledEntry.name : `no ${noun} yet`,
    heldBack ? "scores once the judges have signed" : activity.ledHoldScores ? "scores once every judge is in" : null,
  ]
    .filter(Boolean)
    .join(" · ");
  const onAir = (
    <section aria-labelledby="on-air" className="shrink-0 border-t border-oxford px-6 py-3 text-sm">
      <h3 id="on-air" className="sr-only">
        On the audience&apos;s screens
      </h3>
      {/* One line each where the desk is wide; on a phone they wrap rather than lose the end of the line. */}
      <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-5 gap-y-1">
        <dt className="text-powder">Live results</dt>
        <dd className="min-w-0 font-semibold sm:truncate" title={liveNow}>
          {liveNow}
        </dd>
        {/* An event without live scoring has no LED wall (see the LED wall tab). */}
        {(pageant || activity.liveScoring) && (
          <>
            <dt className="text-powder">LED wall</dt>
            <dd className="min-w-0 font-semibold sm:truncate" title={ledNow}>
              {ledNow}
            </dd>
          </>
        )}
      </dl>
    </section>
  );
  // The last entry fully scored: ending the session is the next thing to do, so the desk offers it right there.
  // So is a pageant sub-activity back on screens with every candidate in it scored (signed off after its deliberation,
  // say): what comes next is offered, and any candidate can still be shown again from the running order.
  const lastOneIn =
    (allIn && !next) || (pageant && round !== null && !entry && entries.length > 0 && judges.length > 0 && entries.every((e) => scoreCount(e.id) >= judges.length));
  // In a pageant, the last candidate of a sub-activity leads to its cut, or the next sub-activity, instead.
  const upNext = pageant ? nextUp(board, round) : null;
  // The sub-activity being judged, when a part of it is on judges' screens: its cut comes after its last part.
  const unitId = round ? unitOf(board.rounds, board.rounds.find((r) => r.id === round.id) ?? round).id : null;
  const nextClass = "btn bg-mint text-prussian hover:bg-white max-sm:order-1 max-sm:w-full";
  const pageantNext =
    upNext?.kind === "cut" ? (
      <button type="button" className={nextClass} onClick={() => setCutOpen(upNext.round.id)}>
        {upNext.round.id === unitId ? `Review the Top ${upNext.round.cutSize}` : `Review the ${upNext.round.name} cut`}
      </button>
    ) : upNext?.kind === "round" ? (
      <JudgeRoundButton board={board} round={upNext.round} className={nextClass} label={`Next: ${upNext.round.name}`} onDone={setResult} />
    ) : upNext?.kind === "deliberate" ? (
      <StartRoundDeliberation board={board} round={upNext.round} className={nextClass} onDone={setResult} />
    ) : null;
  // A sub-activity's deliberation once every judge on its panel has signed: the organizer's sign-off is next.
  const reviewSigned = !!underReview && roundSignatures !== null && judgesFor(board, underReview).every((j) => roundSignatures.some((s) => s.judgeId === j.id));
  // The sub-activity (or part) whose scoring the Session tab shows first: the one on judges' screens, else the next one
  // to judge, else the first.
  // (As stored: the round on screens carries its full name already.)
  const scoringId = round?.id ?? (upNext?.kind === "round" ? upNext.round.id : null);
  const scoringOf = pageant ? (board.rounds.find((r) => r.id === scoringId) ?? null) : null;
  // The break between a pageant's segments: the preliminary has ended, pageant proper hasn't started.
  const theBreak = between && judging === null;
  // The final cut confirmed with nothing left to judge: the desk turns to the placements and the pageant's end.
  const finalCut = pageant ? finalCutRound(board.rounds) : null;
  const finale = live && judging === "proper" && !!finalCut?.cutEntryIds && !upNext && (between || lastOneIn);
  // Devices are approved on the desk where its judges are (their tiles, or the break's judges); elsewhere the panel's
  // dialog asks, as on any other page.
  const approvesHere = theBreak || (!between && !underReview && !finale);
  // The final placements by candidate, for the running order in the finale.
  const placedAt = new Map((finale ? (finalCut?.cutEntryIds ?? []) : []).map((id, i) => [id, i + 1]));
  const fullyScored = (e: Entry) => judges.length > 0 && scoreCount(e.id) >= judges.length;
  // Without live scoring, a fully scored session goes to the deliberation rather than straight to its end.
  const deliberateNext = !pageant && !activity.liveScoring && progress.complete;
  // Judges scoring at their own pace (see atOwnPace): no entry to show, only how far they've got, then the deliberation.
  const ownPace = atOwnPace(activity);
  // At their own pace: how far the event, or the pageant sub-activity on screens, has got.
  const paceProgress = pageant && round ? roundProgress(board, round) : progress;

  /**
   * What moving to `target` would interrupt or skip, in the order the operator needs to hear it. Empty when the
   * move is routine (everyone has scored, and it's the next or previous entry), so routine moves stay one click.
   * Moving still works after the warning: the operator decides.
   */
  const warningsFor = (target: Entry, kind: "next" | "previous" | "jump"): string[] => {
    const warnings: string[] = [];
    if (entry && stillScoring.length > 0) {
      warnings.push(
        `${listNames(stillScoring)} ${stillScoring.length === 1 ? "hasn't" : "haven't"} scored ${entry.name} yet. Their screen will move to ${target.name}, and you can come back to ${entry.name} later.`,
      );
    }
    if (kind === "jump") {
      const expected = entry ? next : entries[0];
      const position = entries.findIndex((e) => e.id === target.id);
      if (fullyScored(target)) warnings.push(`Every judge has already scored ${target.name}.`);
      else if (target.id !== expected?.id) {
        warnings.push(
          !entry
            ? `${target.name} isn't first in the running order. ${entries[0]?.name} is.`
            : position < index
              ? `${target.name} comes earlier in the running order.`
              : `${target.name} isn't next in the running order.${next ? ` ${next.name} is.` : ""}`,
        );
      }
    }
    if (warnings.length) warnings.push(`Judges' screens and the LED wall will switch to ${target.name}.`);
    return warnings;
  };

  const moveControl = ({
    target,
    kind,
    label,
    className,
    title,
    confirmLabel,
    keyShortcuts,
  }: {
    target: Entry;
    kind: "next" | "previous" | "jump";
    label: React.ReactNode;
    className: string;
    title: string;
    confirmLabel: string;
    keyShortcuts?: string;
  }) => {
    const warnings = warningsFor(target, kind);
    if (warnings.length === 0) {
      return (
        <button type="button" className={className} onClick={() => show(target.id)} disabled={!live || pending} aria-keyshortcuts={keyShortcuts}>
          {label}
        </button>
      );
    }
    return (
      <ConfirmDialog
        triggerLabel={label}
        triggerClassName={className}
        triggerDisabled={!live || pending}
        triggerKeyShortcuts={keyShortcuts}
        title={title}
        confirmLabel={confirmLabel}
        onConfirm={() => move(target.id)}
      >
        {warnings.map((w) => (
          <span key={w} className="mt-2 block first:mt-0">
            {w}
          </span>
        ))}
      </ConfirmDialog>
    );
  };

  const startDeliberation = (triggerClassName: string) => (
    <ConfirmDialog
      triggerLabel="Start deliberation"
      triggerClassName={triggerClassName}
      title="Start the deliberation?"
      confirmLabel="Start deliberation"
      onConfirm={() => changeState("deliberation")}
    >
      Every entry is scored. Each judge reviews their scores and notes on their own screen, corrects any that&apos;s wrong, then signs. You end the
      session once every judge has signed, and the results show then.
    </ConfirmDialog>
  );

  /** `done`: everything is judged and placed, so ending is the next step, not a warning. */
  const endSession = (triggerClassName: string, done = false) =>
    pageant ? (
      <ConfirmDialog
        triggerLabel="End pageant proper"
        triggerClassName={triggerClassName}
        title="End pageant proper?"
        tone={done ? "primary" : "danger"}
        confirmLabel="End pageant proper"
        passwordLabel="Your password"
        onConfirm={(password) => changeState("ended", password)}
      >
        {!done && missingWarning}
        {done ? "Every candidate is placed. " : ""}Ending pageant proper ends the pageant: judges can&apos;t submit any more scores, and candidates
        can&apos;t be changed. Enter your admin password to confirm. You can reopen it if you need to.
      </ConfirmDialog>
    ) : (
      <ConfirmDialog
        triggerLabel="End session"
        triggerClassName={triggerClassName}
        title="End the session?"
        tone="danger"
        confirmLabel="End session"
        passwordLabel="Your password"
        onConfirm={(password) => changeState("ended", password)}
      >
        {missingWarning}
        Judges won&apos;t be able to submit any more scores, and entries can&apos;t be changed. Enter your admin password to confirm. You can reopen the
        session if you need to.
      </ConfirmDialog>
    );

  /** The preliminary's end: its own judges are done, and pageant proper can start. */
  const endPreliminary = (triggerClassName: string) => (
    <ConfirmDialog
      triggerLabel="End preliminary"
      triggerClassName={triggerClassName}
      title="End the preliminary?"
      tone="danger"
      confirmLabel="End preliminary"
      passwordLabel="Your password"
      onConfirm={(password) => changeSegment("endPreliminary", password)}
    >
      Its scores are final. Judges who judge only the preliminary are done, and their screens thank them. Deductions stay open until pageant proper
      starts, and you can reopen the preliminary until then. Enter your admin password to confirm.
    </ConfirmDialog>
  );
  // Pageant proper's judges without an approved device yet, for its start to name.
  const unpairedProper = unpaired.filter((j) => j.panel !== "preliminary");
  // The break's judges: pageant proper's, and anyone else whose device is asking to be approved.
  const properJudges = judges.filter((j) => j.panel !== "preliminary");
  const pairedProper = properJudges.length - unpairedProper.length;
  const breakJudges = judges.filter((j) => j.panel !== "preliminary" || devicesOf(j.id).some((d) => d.status === "pending"));
  const deductionCount = board.deductions?.length ?? 0;
  const startProper = (triggerClassName: string) => (
    <ConfirmDialog
      triggerLabel="Start pageant proper"
      triggerClassName={triggerClassName}
      title="Start pageant proper?"
      confirmLabel="Start pageant proper"
      openOnMount={askedToStartProper}
      onConfirm={() => changeSegment("startProper")}
    >
      Pageant proper&apos;s judges&apos; screens open, and its judges and sub-activities lock.
      {activity.violations !== null && ` Deductions close: ${board.deductions?.length ?? 0} given, none after this.`} Choose its first sub-activity when
      you&apos;re ready.
      {unpairedProper.length > 0 && (
        <span className="mt-3 block font-semibold text-prussian">
          {listNames(unpairedProper)} {unpairedProper.length === 1 ? "doesn't" : "don't"} have an approved device yet. They can still pair after you start.
        </span>
      )}
    </ConfirmDialog>
  );
  const reopenPreliminary = (triggerClassName: string) => (
    <ConfirmDialog triggerLabel="Reopen preliminary" triggerClassName={triggerClassName} title="Reopen the preliminary?" confirmLabel="Reopen preliminary" onConfirm={() => changeSegment("reopenPreliminary")}>
      Its judges&apos; screens open again, and any of its sub-activities can be judged again. Pageant proper waits until you end the preliminary
      again.
    </ConfirmDialog>
  );
  /** What ends what's being judged: the preliminary, pageant proper (the session), or an event's session. Nothing between segments. */
  // The preliminary's end is offered once it can work (every score in, its deliberations signed off), not refused after the password.
  const endControl = (triggerClassName: string) =>
    judging === "preliminary"
      ? preliminaryEndGap(board)
        ? null
        : endPreliminary(triggerClassName)
      : pageant && judging === null
        ? null
        : endSession(triggerClassName);

  // The side column keeps the entry on air in view when it scrolls beside the desk. Instant, never animated.
  const orderRef = useRef<HTMLOListElement>(null);
  const sideRef = useRef<HTMLElement>(null);
  useEffect(() => {
    const side = sideRef.current;
    const row = orderRef.current?.querySelector<HTMLElement>('[data-on-air="true"]');
    if (!side || !row || side.scrollHeight <= side.clientHeight) return;
    // Only as far as it takes to show it, so the program above stays in view when it can.
    const top = row.getBoundingClientRect().top - side.getBoundingClientRect().top + side.scrollTop;
    const bottom = top + row.offsetHeight;
    if (top < side.scrollTop) side.scrollTop = top - 16;
    else if (bottom > side.scrollTop + side.clientHeight) side.scrollTop = bottom - side.clientHeight + 16;
  }, [current, live]);

  /*
   * Keyboard shortcuts while live: → or Space for the next entry, ← for the previous one. They press the same
   * buttons (found by their aria-keyshortcuts), so the same "move on anyway?" guard applies. Ignored while a dialog
   * is open, while typing, with a modifier held, and on key repeat, so a held key can't skip through the show.
   * Space moves the show only when nothing in particular has focus: on a focused list (the running order, the
   * judges) it scrolls the list, and on a focused control it presses that control, as Space always does.
   */
  useEffect(() => {
    if (!live) return;
    // Space presses on key-up, like a button does: pressed on key-down, the guard dialog would open and take
    // focus, and the key-up would then press its Cancel button.
    const handle = (e: KeyboardEvent) => {
      if (e.repeat || e.altKey || e.ctrlKey || e.metaKey || e.shiftKey || document.querySelector("dialog[open]")) return;
      const target = e.target instanceof HTMLElement ? e.target : null;
      if (target?.closest("input, textarea, select, [contenteditable='true']")) return;
      const space = e.key === " " && (!target || target === document.body || target === document.documentElement);
      if (space) e.preventDefault(); // no page scroll, on either edge of the press
      const key =
        e.type === "keydown"
          ? e.key === "ArrowRight"
            ? "ArrowRight"
            : e.key === "ArrowLeft"
              ? "ArrowLeft"
              : null
          : space
            ? "Space"
            : null;
      const button = key && document.querySelector<HTMLButtonElement>(`[aria-keyshortcuts~="${key}"]`);
      if (!button) return;
      e.preventDefault();
      button.click();
    };
    window.addEventListener("keydown", handle);
    window.addEventListener("keyup", handle);
    return () => {
      window.removeEventListener("keydown", handle);
      window.removeEventListener("keyup", handle);
    };
  }, [live]);

  const kbd = (key: string) => (
    <kbd aria-hidden className="hidden rounded border border-current/35 px-1.5 text-xs leading-5 font-semibold opacity-80 lg:pointer-fine:inline-block">
      {key}
    </kbd>
  );

  /** The running order. `compact` is the live desk's rundown: it scrolls inside its column and keeps the entry on air in view. */
  const runningOrder = (compact: boolean) =>
    entries.length > 0 && (
      <section aria-labelledby="running-order">
        <h2 id="running-order" className="sr-only">
          {round ? `Running order: ${round.name}` : "Running order"}
        </h2>
        <ol ref={compact ? orderRef : undefined} aria-labelledby={compact ? "running-order" : undefined} className="card mt-3 divide-y divide-line overflow-hidden">
          {entries.map((e, i) => {
            const onAir = e.id === current;
            return (
              <li
                key={e.id}
                data-on-air={onAir && live && !finale ? "true" : undefined}
                className={`flex items-center ${compact ? "gap-3 px-3 py-2" : "gap-4 px-4 py-3"} ${onAir && live && !finale ? "bg-wash" : ""}`}
              >
                <span className={`tabular text-right font-semibold text-prussian/70 ${compact ? "w-6" : "w-8"}`}>{e.number ?? i + 1}</span>
                <span className="min-w-0 flex-1 truncate font-semibold" title={e.name}>
                  {e.name}
                </span>
                {/* Between a pageant's sub-activities nothing is being scored: no counts, which would read 0 of every judge. */}
                {!between && (
                <span className="tabular hint">
                  {compact ? (
                    <>
                      {scoreCount(e.id)}/{judges.length}
                      <span className="sr-only"> scores</span>
                    </>
                  ) : (
                    <>
                      {scoreCount(e.id)} of {judges.length}
                      <span className="hidden sm:inline"> scores</span>
                    </>
                  )}
                </span>
                )}
                {finale ? (
                  // The placements are decided: each placed candidate's title, and nothing to put back on screens.
                  placedAt.has(e.id) && (
                    <span className={`inline-flex h-9 items-center px-1 text-sm font-semibold ${placedAt.get(e.id) === 1 ? "text-regal" : "text-prussian/80"}`}>
                      {placeTitle(placedAt.get(e.id)!)}
                    </span>
                  )
                ) : state === "draft" || between || underReview || (ownPace && state === "live") ? null : state === "ended" || state === "deliberation" ? (
                  // Judging is over: no "now judging" or "judge now" to suggest otherwise.
                  <span className="inline-flex h-9 items-center px-3 text-sm font-semibold text-prussian/80">
                    {scoreCount(e.id) > 0 ? "Judged" : "Not judged"}
                  </span>
                ) : onAir ? (
                  // A state, not a control: the on-air tally light and its words, with no button's shape.
                  <span className="inline-flex h-9 items-center gap-2 px-1 text-sm font-semibold text-regal">
                    <span aria-hidden className="size-2 shrink-0 rounded-full bg-tally" />
                    Now judging
                  </span>
                ) : (
                  // Jumping around the running order asks first unless it's simply the next entry with everyone in.
                  moveControl({
                    target: e,
                    kind: "jump",
                    label: (
                      <>
                        {fullyScored(e) ? "Show again" : "Judge now"}
                        <span className="sr-only"> {e.name}</span>
                      </>
                    ),
                    // Quiet text, not a column of bordered buttons down every row: the next entry has the desk's own button.
                    className: "btn btn-sm text-regal hover:bg-wash",
                    title: fullyScored(e) ? `Show ${e.name} again?` : `Show ${e.name} now?`,
                    confirmLabel: fullyScored(e) ? "Show it again" : "Show this entry",
                  })
                )}
              </li>
            );
          })}
        </ol>
      </section>
    );

  /*
   * The live desk: one screen that doesn't scroll on a 1366×768 laptop. The desk (what's on, who we're waiting on,
   * and the action bar that never moves) on the left; the running order as a rundown and the show's screens on the
   * right. Only the judge grid and the rundown scroll, inside themselves. Below xl (with the sidebar, too narrow for both
   * columns) it stacks as before.
   */
  if (live) {
    return (
      <PdfHold value={held}>
        {/* Where the desk approves devices itself (see approvesHere), the panel's dialog doesn't (see AssistanceAlerts). */}
        <div
          data-device-approvals={approvesHere ? activity.id : undefined}
          className="max-xl:space-y-8 xl:-mb-6 xl:grid xl:h-[calc(100dvh-13rem)] xl:min-h-[22rem] xl:grid-cols-[minmax(0,1fr)_minmax(20rem,24rem)] xl:gap-6">
          <section aria-labelledby="desk-heading" className="admin-desk keep-light flex min-h-0 flex-col overflow-hidden rounded-[1.25rem] bg-prussian text-mint">
            {offline}
            {/* The eyebrow shares its row with the connection and the end; the name below has the desk's whole width. */}
            <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 px-6 pt-4">
                <h2 id="desk-heading" className="text-sm text-powder">
                  {round && !finale && <span className="font-semibold text-mint">{round.name} · </span>}
                  {finale
                    ? "Final cut confirmed"
                    : underReview
                    ? "Deliberation"
                    : ownPace
                    ? "Judges score at their own pace"
                    : entry
                    ? entry.number
                      ? // "(2 of 3)" stays on one line when the heading wraps.
                        `Now judging: No. ${entry.number} (${index + 1}\u00a0of\u00a0${entries.length})`
                      : `Now judging: No. ${index + 1} of ${entries.length}`
                    : between
                      ? pageant && judging === null
                        ? "Waiting for pageant proper"
                        : "Between sub-activities"
                      : "On judges' screens"}
                </h2>
                <p title={entry?.name} className="col-span-2 mt-0.5 line-clamp-2 text-[clamp(1.375rem,2vw,1.75rem)] leading-tight font-light tracking-[-0.02em] text-balance wrap-anywhere">
                  {finale
                    ? `${board.entries.find((e) => e.id === finalCut?.cutEntryIds?.[0])?.name ?? "The winner"} wins`
                    : underReview
                    ? reviewSigned
                      ? `Every judge has signed: sign off ${underReview.name}`
                      : "The judges are reviewing their scores"
                    : ownPace
                    ? `${paceProgress.submitted} of ${paceProgress.possible} scores in`
                    : entry
                      ? entry.name
                      : between
                        ? pageant && judging === null
                          ? "The preliminary has ended"
                          : upNext
                            ? "Choose what to judge next"
                            : judging === "preliminary"
                              ? "Every preliminary sub-activity is judged"
                              : "Every sub-activity is judged"
                        : `Judges are waiting for ${pageant ? "a candidate" : "an entry"}`}
                </p>
              <div className="col-start-2 row-start-1 flex shrink-0 items-center gap-3">
                <DeskConnection status={connection} renderedAt={renderedAt} className="text-powder" />
                {deliberateNext
                  ? !lastOneIn && !ownPace && startDeliberation("btn btn-sm border border-oxford text-mint hover:bg-oxford")
                  : (finale || ((!lastOneIn || pageantNext) && !(between && !upNext))) &&
                    // In the final placements the desk's own button ends the pageant (and between sub-activities with
                    // nothing left, the desk's body offers the end). This one stays, hidden, in the final placements, so a
                    // dialog opened from it just before the desk turned over (the cut confirmed a moment ago) isn't lost.
                    // Ending is a control, not the connection's status beside it: the danger tone its dialog has.
                    endControl(finale ? "hidden" : "btn btn-sm border border-danger-soft/60 text-danger-soft hover:bg-oxford")}
              </div>
            </div>
            {/* A pageant's timer is its sub-activity's; an event's, its own (an entry at a time). */}
            <DeskTimer activity={activity} timerSeconds={finale ? null : round ? round.timerSeconds : eventTimer(activity)} renderedAt={renderedAt} />
            {/* A success ("The session has ended…") is what the desk now shows anyway, so it's announced, not repeated on screen. */}
            <FormMessage state={result} small onDark className={result?.ok ? "sr-only" : "px-6 pt-2 font-semibold"} />
            <CorrectionsPanel activityId={activity.id} corrections={corrections} onDark />

            {theBreak ? (
              // The break between the segments, in the order the work goes: deductions are tallied (they close when
              // pageant proper starts), pageant proper's judges pair (approved right here). Its start waits in the action
              // bar, where Next is during the show.
              <>
                {/* The steps say what's left; starting pageant proper says what it closes. */}
                <div role="region" aria-label="Before pageant proper" className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto border-t border-oxford px-6 py-5">
                  <ol className="max-w-2xl space-y-6">
                    {activity.violations !== null && (
                      <BreakStep n={1} title="Record deductions" status={deductionCount ? `${deductionCount} given` : "None given"}>
                        <DeductionsButton board={board} className="btn btn-sm mt-1 border border-oxford text-mint hover:bg-oxford">
                          {deductionCount ? "Review or add deductions" : "Add a deduction"}
                        </DeductionsButton>
                      </BreakStep>
                    )}
                    <BreakStep
                      n={activity.violations !== null ? 2 : 1}
                      title="Pair pageant proper's judges"
                      status={`${pairedProper} of ${properJudges.length} paired`}
                      done={unpairedProper.length === 0}
                    >
                      <ul aria-label="Pageant proper's judges" className="mt-2 grid gap-2">
                        {breakJudges.map((j) => (
                          <JudgeTile key={j.id} judge={j} devices={devicesOf(j.id)} scored={null} />
                        ))}
                      </ul>
                    </BreakStep>
                  </ol>
                </div>
                <div role="group" aria-label="Pageant proper's start" className="flex shrink-0 flex-wrap items-center gap-3 border-t border-oxford px-6 py-3">
                  {/* Only who's still missing: the pairing step shows when they're all in. */}
                  <p role="status" className="min-w-48 flex-1 leading-snug font-semibold">
                    {unpairedProper.length > 0 && `${listNames(unpairedProper)} ${unpairedProper.length === 1 ? "doesn't" : "don't"} have an approved device yet.`}
                  </p>
                  <div className="ml-auto flex min-w-0 max-w-full items-center gap-3 max-sm:w-full max-sm:flex-col">
                    {reopenPreliminary("btn border border-oxford text-mint hover:bg-oxford max-sm:order-2 max-sm:w-full")}
                    {startProper("btn bg-mint text-prussian hover:bg-white max-sm:order-1 max-sm:w-full")}
                  </div>
                </div>
              </>
            ) : finale ? (
              // The final cut confirmed, nothing left to judge: the placements for the announcement, what the audience's
              // screens show, then the pageant's end in the action bar.
              <>
                <div className="flex min-h-0 flex-1 flex-col overflow-y-auto border-t border-oxford px-6 py-5">
                  <FinalPlacements board={board} />
                </div>
                {onAir}
                <div role="group" aria-label="The pageant's end" className="flex shrink-0 flex-wrap items-center gap-3 border-t border-oxford px-6 py-3">
                  <div className="ml-auto flex min-w-0 max-w-full items-center gap-3 max-sm:w-full max-sm:flex-col">
                    {finalCut && (
                      <PdfLink activityId={activity.id} query={`cut=${finalCut.id}`} className="btn border border-oxford text-mint hover:bg-oxford max-sm:order-2 max-sm:w-full">
                        Download final results PDF
                      </PdfLink>
                    )}
                    {endSession("btn bg-mint text-prussian hover:bg-white max-sm:order-1 max-sm:w-full", true)}
                  </div>
                </div>
              </>
            ) : underReview ? (
              <RoundDeliberationDesk board={board} round={underReview} signatures={roundSignatures} />
            ) : between ? (
              // The headline says where the pageant stands; the one button, what's next (the program offers the rest).
              <div className="flex min-h-0 flex-1 flex-col items-start gap-4 overflow-y-auto border-t border-oxford px-6 py-5">
                {upNext?.kind === "deliberate" && (
                  <StartRoundDeliberation board={board} round={upNext.round} className="btn bg-mint text-prussian hover:bg-white" onDone={setResult} />
                )}
                {upNext?.kind === "round" && (
                  <JudgeRoundButton board={board} round={upNext.round} className="btn bg-mint text-prussian hover:bg-white" label={`Judge ${upNext.round.name}`} onDone={setResult} />
                )}
                {upNext?.kind === "cut" && (
                  <button type="button" className="btn bg-mint text-prussian hover:bg-white" onClick={() => setCutOpen(upNext.round.id)}>
                    Review the {upNext.round.cutSize === null ? "" : `Top ${upNext.round.cutSize} `}cut after {upNext.round.name}
                  </button>
                )}
                {!upNext && endControl("btn bg-mint text-prussian hover:bg-white")}
              </div>
            ) : (
              <>
                <div tabIndex={0} role="region" aria-label="Judges" className="@container mt-3 min-h-0 flex-1 overflow-y-auto px-6 pb-3">
                  <ul className="grid gap-2 @sm:grid-cols-2 @2xl:grid-cols-4">
                    {judges.map((j) => (
                      <JudgeTile key={j.id} judge={j} devices={devicesOf(j.id)} scored={entry ? scoredBy.has(j.id) : null} stacked />
                    ))}
                  </ul>
                </div>

                {!ownPace && onAir}

                {ownPace ? (
                  // At their own pace there's nothing to show: how many scores are still to come, then the deliberation.
                  <div role="group" aria-label="Show controls" className="flex shrink-0 flex-wrap items-center gap-3 border-t border-oxford px-6 py-3">
                    <p role="status" className="min-w-48 flex-1 leading-snug font-semibold">
                      {paceProgress.complete
                        ? `Every judge has scored every ${noun}.`
                        : `${paceProgress.possible - paceProgress.submitted} ${paceProgress.possible - paceProgress.submitted === 1 ? "score" : "scores"} to come.`}
                    </p>
                    {/* A pageant sub-activity's own deliberation (nextUp offers it once every score is in); an event's. */}
                    {paceProgress.complete && (pageant ? pageantNext : startDeliberation("btn bg-mint text-prussian hover:bg-white max-sm:w-full"))}
                  </div>
                ) : (
                /* The action bar: the status on the left, Previous and Next on the right, in the same place all show. */
                <div role="group" aria-label="Show controls" className="flex shrink-0 flex-wrap items-center gap-3 border-t border-oxford px-6 py-3">
                  {/* Wraps rather than losing its end: it names at most three judges (the tiles show the rest). */}
                  <p role="status" className="min-w-48 flex-1 leading-snug font-semibold">
                    {entry &&
                      (allIn
                        ? next
                          ? `Every judge has scored ${entry.name}.`
                          : `Every judge has scored ${entry.name}. That was the last entry.`
                        : `${scoredBy.size} of ${judges.length} ${judges.length === 1 ? "judge has" : "judges have"} scored. Waiting on ${
                            stillScoring.length <= 3 ? listNames(stillScoring) : `${stillScoring.length} judges`
                          }.`)}
                  </p>
                  {/*
                    Previous and Next stay together on the right: when the status needs the room they move under it as a
                    pair, so Next is never pushed to the left. On phones they go full width, the next entry first: it's the
                    one the operator reaches for.
                  */}
                  <div className="ml-auto flex min-w-0 max-w-full items-center gap-3 max-sm:w-full max-sm:flex-col">
                    {previous ? (
                      moveControl({
                        target: previous,
                        kind: "previous",
                        label: (
                          <>
                            {kbd("←")}
                            {pageant ? "Previous candidate" : "Previous entry"}
                          </>
                        ),
                        className: "btn border border-oxford text-mint hover:bg-oxford max-sm:order-2 max-sm:w-full",
                        title: `Go back to ${previous.name}?`,
                        confirmLabel: "Go back anyway",
                        keyShortcuts: "ArrowLeft",
                      })
                    ) : (
                      <button type="button" className="btn border border-oxford text-mint max-sm:order-2 max-sm:w-full" disabled>
                        {pageant ? "Previous candidate" : "Previous entry"}
                      </button>
                    )}
                    {lastOneIn ? (
                      (pageantNext ??
                      (deliberateNext
                        ? startDeliberation("btn bg-mint text-prussian hover:bg-white max-sm:order-1 max-sm:w-full")
                        : endControl("btn bg-mint text-prussian hover:bg-white max-sm:order-1 max-sm:w-full")))
                    ) : next ? (
                      moveControl({
                        target: next,
                        kind: "next",
                        label: (
                          <>
                            <span className="truncate">{entry ? `Next: ${next.name}` : `Show first ${noun}`}</span>
                            {kbd("→")}
                          </>
                        ),
                        className: `btn min-w-0 max-sm:order-1 max-sm:w-full ${allIn || !entry ? "bg-mint text-prussian hover:bg-white" : "border border-powder/60 text-mint hover:bg-oxford"}`,
                        title: `Move on to ${next.name}?`,
                        confirmLabel: "Move on anyway",
                        keyShortcuts: "ArrowRight Space",
                      })
                    ) : (
                      <button type="button" className="btn min-w-0 border border-oxford text-mint max-sm:order-1 max-sm:w-full" disabled>
                        {entry ? (pageant ? "No more candidates" : "No more entries") : pageant ? "No candidates" : "No entries yet"}
                      </button>
                    )}
                  </div>
                  {moveError && (
                    <p role="alert" className="basis-full text-sm font-semibold text-danger-soft max-sm:order-3">
                      {moveError}
                    </p>
                  )}
                </div>
                )}
              </>
            )}
          </section>

          {/* One column that scrolls as a whole beside the desk (so it's one stop for the keyboard), not a scroller in each part. */}
          <aside ref={sideRef} tabIndex={0} aria-label="Running order and screens" className="flex min-h-0 flex-col gap-4 xl:overflow-y-auto">
            {pageant && <ProgramPanel board={board} live compact onReviewCut={setCutOpen} />}
            {/* Each sub-activity's scoring, starting on the one on judges' screens: folded away until it's wanted. */}
            {pageant && (
              <details className="card shrink-0 px-5 py-3 text-sm">
                <summary className="flex cursor-pointer items-center gap-2 font-semibold pointer-coarse:min-h-11">
                  Scoring
                  {scoringOf && <span className="min-w-0 truncate font-normal text-prussian/75">· {roundLabel(board.rounds, scoringOf)}</span>}
                </summary>
                <div className="mt-3 border-t border-line pt-3">
                  <PageantScoring key={scoringOf?.id ?? "none"} rounds={board.rounds} initialId={scoringOf?.id} compact />
                </div>
              </details>
            )}
            {runningOrder(true)}

            {screens(progress.complete && !pageant && activity.liveScoring && (
                  <div className="border-t border-line pt-2">
                    <ExportMenu activityId={activity.id} options={sheetOptions("", { judges: true })} className="btn btn-primary btn-sm" />
                  </div>
                ))}
          </aside>
          {cutDialog}
        </div>
      </PdfHold>
    );
  }

  return (
    <PdfHold value={held}>
      <div className="max-w-4xl space-y-10" data-device-approvals={state === "draft" ? activity.id : undefined}>
        <div className="space-y-4">
          <CorrectionsPanel activityId={activity.id} corrections={corrections} />
          {/*
           * The control desk carries the whole show: who is ready before it starts, who has scored while it runs,
           * and the official results once it ends. It looks like the judges' screens, so it keeps their colours in dark mode.
           */}
          {state === "draft" && (
            <section aria-labelledby="desk-heading" className="admin-desk keep-light overflow-hidden rounded-[1.25rem] bg-prussian text-mint">
              {offline}
              <div className="px-6 pt-6 pb-5">
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0 flex-1">
                    <h2 id="desk-heading" className="text-powder">
                      Before you start
                    </h2>
                    <p className="mt-1 text-[clamp(1.4rem,2.6vw,1.9rem)] leading-tight font-light tracking-[-0.02em] text-balance">
                      {judges.length === 0
                        ? "Add judges to get started"
                        : boardGroups
                          ? // The start needs the preliminary's judges; pageant proper's pair in their own time.
                            startUnpaired.length === 0
                            ? "Every preliminary judge has an approved device"
                            : `${startBoard.length - startUnpaired.length} of ${startBoard.length} preliminary ${startBoard.length === 1 ? "judge has" : "judges have"} an approved device`
                          : unpaired.length === 0
                            ? "Every judge has an approved device"
                            : `${judges.length - unpaired.length} of ${judges.length} ${judges.length === 1 ? "judge has" : "judges have"} an approved device`}
                    </p>
                  </div>
                  <DeskConnection status={connection} renderedAt={renderedAt} className="shrink-0 pt-1 text-powder" />
                </div>
                <FormMessage state={result} small onDark className={result?.ok ? "sr-only" : "pt-2 font-semibold"} />
                {judges.length > 0 &&
                  (boardGroups ? (
                    // Separate boards: each board apart, in the order they judge. Pageant proper's own judges step back
                    // until it's their turn (their devices can still be approved now).
                    <div className="mt-5 space-y-5">
                      {boardGroups.map((group) => (
                        <section key={group.key} aria-labelledby={`desk-board-${group.key}`} className={group.later ? "opacity-60" : undefined}>
                          <h3 id={`desk-board-${group.key}`} className="flex flex-wrap items-baseline gap-x-2 text-sm">
                            <span className="font-semibold text-mint">{group.title}</span>
                            <span className="text-powder">{group.note}</span>
                          </h3>
                          <ul className="mt-2 grid gap-2 sm:grid-cols-2">
                            {group.judges.map((j) => (
                              <JudgeTile key={j.id} judge={j} devices={devicesOf(j.id)} scored={null} />
                            ))}
                          </ul>
                        </section>
                      ))}
                    </div>
                  ) : (
                    <ul className="mt-5 grid gap-2 sm:grid-cols-2">
                      {judges.map((j) => (
                        <JudgeTile key={j.id} judge={j} devices={devicesOf(j.id)} scored={null} />
                      ))}
                    </ul>
                  ))}
              </div>
              <div className="flex flex-wrap items-center gap-x-6 gap-y-3 border-t border-oxford px-6 py-4">
                <p className="min-w-56 flex-1 text-[15px] text-powder">
                  {/* A pageant's candidates are listed below; an event's entries count here. */}
                  {!pageant && `${entries.length} ${entries.length === 1 ? "entry" : "entries"} in the running order. `}
                  {judges.length === 0 ? (
                    <Link href={`/admin/${activity.id}?tab=judges`} scroll={false} className="font-semibold text-mint underline underline-offset-2">
                      Add judges
                    </Link>
                  ) : (pageant && unpaired.length === 0) ? null : (
                    <>
                      Judges&apos; codes and QR codes are on the{" "}
                      <Link href={`/admin/${activity.id}?tab=judges`} scroll={false} className="font-semibold text-mint underline underline-offset-2">
                        Judges
                      </Link>{" "}
                      tab.
                    </>
                  )}
                  {!pageant && !activity.liveScoring && " Live scoring is off, so the judges deliberate and sign before the results show."}
                </p>
                <ConfirmDialog
                  triggerLabel={pageant ? "Start preliminary" : "Start session"}
                  openOnMount={askedToStart}
                  triggerClassName="btn shrink-0 bg-mint text-prussian hover:bg-white"
                  title={pageant ? "Start the preliminary?" : "Start judging?"}
                  confirmLabel={pageant ? "Start preliminary" : "Start session"}
                  onConfirm={() => changeState("live")}
                >
                  {pageant
                    ? "The preliminary's judges' screens open, and its judges, its sub-activities and the running order lock. Pageant proper's judges and sub-activities can still change until it starts. Choose the first sub-activity to judge when you're ready."
                    : "Judges' screens open, and the judges and running order lock. You can still add and rename entries. Show the first entry when you're ready."}
                  {judges.length > 0 && startUnpaired.length > 0 && (
                    <span className="mt-3 block font-semibold text-prussian">
                      {listNames(startUnpaired)} {startUnpaired.length === 1 ? "doesn't" : "don't"} have an approved device yet. They can still pair after you
                      start.
                    </span>
                  )}
                </ConfirmDialog>
              </div>
            </section>
          )}

          {state === "deliberation" &&
            (() => {
              const signedIds = new Set((signatures ?? []).map((sig) => sig.judgeId));
              const allSigned = signatures !== null && unsignedJudges(judges, signatures).length === 0;
              const openCorrection = corrections.some((c) => c.status === "open");
              // Every tie in the ranking is broken (by a judge correcting a score, on their screen) before anyone signs. The
              // ties and the signed results come from the server, which keeps the scores themselves.
              const breaks = board.tieBreaks ?? [];
              const nameOf = new Map(entries.map((e) => [e.id, e.name]));
              const ties = (deliberation?.ties ?? []).map((tie) => ({ tie, settled: breakFor(tie, breaks) }));
              const openTies = ties.filter((t) => !t.settled).length;
              return (
                <section aria-labelledby="desk-heading" className="admin-desk keep-light overflow-hidden rounded-[1.25rem] bg-prussian text-mint">
                  {offline}
                  <div className="px-6 pt-6 pb-5">
                    <div className="flex items-start justify-between gap-4">
                      <div className="min-w-0 flex-1">
                        <h2 id="desk-heading" className="text-powder">
                          Deliberation
                        </h2>
                        <p role="status" className="mt-1 text-[clamp(1.4rem,2.6vw,1.9rem)] leading-tight font-light tracking-[-0.02em] text-balance">
                          {allSigned ? "Every judge has signed" : `${signedIds.size} of ${judges.length} ${judges.length === 1 ? "judge has" : "judges have"} signed`}
                        </p>
                      </div>
                      <DeskConnection status={connection} renderedAt={renderedAt} className="shrink-0 pt-1 text-powder" />
                    </div>
                    <FormMessage state={result} small onDark className={result?.ok ? "sr-only" : "pt-2 font-semibold"} />
                    <ul aria-label="Who has signed" className="mt-5 grid gap-2 sm:grid-cols-2">
                      {judges.map((j) => {
                        const signed = signedIds.has(j.id);
                        return (
                          <li
                            key={j.id}
                            className={`flex items-center gap-3 rounded-xl px-3 py-2.5 ${signed ? "bg-oxford/45 text-mint/75" : "bg-oxford ring-1 ring-powder/50"}`}
                          >
                            <Avatar name={j.name} src={j.photoUrl} size={36} />
                            <span className="min-w-0 flex-1 truncate font-semibold">{j.name}</span>
                            {j.isChair && <span className="text-xs font-semibold text-powder">Chair</span>}
                            {signed ? (
                              <span className="flex items-center gap-1.5 text-sm font-semibold text-powder">
                                {check}
                                Signed
                              </span>
                            ) : (
                              <span className="text-sm font-bold text-mint">Reviewing</span>
                            )}
                          </li>
                        );
                      })}
                    </ul>
                    {ties.length > 0 && (
                      <ul aria-label="Ties in the ranking" className="mt-4 space-y-2">
                        {ties.map(({ tie, settled }) => (
                          <li key={tie.key} className={`rounded-xl px-3 py-2.5 ${settled ? "bg-oxford/45" : "bg-caution/15 ring-1 ring-caution"}`}>
                            <span className={`font-semibold ${settled ? "" : "text-caution"}`}>Tie for {ordinal(tie.rank)}</span>
                            {settled ? (
                              <span className="text-mint/85">
                                , broken: {settled.entryIds.map((id) => nameOf.get(id) ?? "an entry").join(", then ")}. &ldquo;{settled.reason}&rdquo;
                              </span>
                            ) : (
                              <span>: {listNames(tie.entryIds.map((id) => ({ name: nameOf.get(id) ?? "an entry" })))}. A judge corrects a score to break it before anyone signs.</span>
                            )}
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                  <div className="flex flex-wrap items-center gap-x-6 gap-y-3 border-t border-oxford px-6 py-4">
                    <p className="min-w-56 flex-1 text-[15px] text-powder">
                      {signatures === null
                        ? "Signatures need a database update. Run supabase/migrations/021_deliberation.sql in the Supabase SQL editor."
                        : openTies > 0
                          ? `${openTies === 1 ? "A tie" : `${openTies} ties`} in the ranking ${openTies === 1 ? "isn't" : "aren't"} broken yet. A judge corrects a score to break ${openTies === 1 ? "it" : "each"}; the judges sign after.`
                          : allSigned
                            ? "Sign the results to end the session."
                            : openCorrection
                              ? "A score correction is open. The judges sign once it's settled."
                              : "Each judge reviews their scores on their own screen, then signs. You sign the results once they all have."}
                    </p>
                  </div>
                  {/* Everyone has signed: the organizer's sign-off takes over until the session ends. */}
                  {allSigned && openTies === 0 && deliberation?.ranking && (
                    <FinalSignOff
                      activity={activity}
                      ranking={deliberation.ranking}
                      ties={ties.flatMap(({ tie, settled }) =>
                        settled
                          ? [
                              {
                                place: tie.rank,
                                names: settled.entryIds.map((id) => nameOf.get(id) ?? "an entry"),
                                reason: settled.reason,
                                by: judges.find((j) => j.id === settled.judgeId)?.name ?? null,
                              },
                            ]
                          : [],
                      )}
                      judges={judges}
                      onEnd={(password, signature) => changeState("ended", password, signature)}
                    />
                  )}
                </section>
              );
            })()}

          {state === "ended" && !archived && (
            <section aria-labelledby="desk-heading" className="card overflow-hidden">
              {/* One row on a wide screen: what happened, then what's left to do. Quiet once the show is over: a plain card
                  rather than the live desk's navy, its one filled button the download. The report ID is on every PDF and
                  CSV it downloads, so the desk leaves it to them. */}
              <div className="flex flex-wrap items-center gap-x-6 gap-y-4 px-6 py-5">
                <div className="mr-auto">
                  <h2 id="desk-heading" className="title-sm">
                    Judging has ended
                  </h2>
                  {/* With live scoring, the last score ended it: final, so there's nothing to reopen. */}
                  {endedForGood && <p className="mt-1 text-[15px] text-prussian/70">Every judge scored every entry, so it ended by itself.</p>}
                </div>
                <div className="flex flex-wrap items-center gap-3 max-sm:w-full">
                  {exportMenu("btn btn-primary max-sm:w-full")}
                  <ArchiveButton activityId={activity.id} name={activity.name} blocked={archiveBlocked(activity, progress)} className="btn btn-quiet max-sm:flex-1" />
                  {/*
                    A deliberated session deliberates again, with the password ending took: it reopens the signed record. Any
                    other reopens, and at least asks.
                  */}
                  {activity.signedOffAt && !activity.liveScoring && !pageant ? (
                    <ConfirmDialog
                      triggerLabel="Redeliberate"
                      triggerClassName="btn btn-quiet max-sm:flex-1"
                      title="Deliberate again?"
                      tone="danger"
                      confirmLabel="Redeliberate"
                      passwordLabel="Your password"
                      onConfirm={(password) => changeState("deliberation", password)}
                    >
                      The judges review their scores and sign again, then you sign the results to end the session again. Until then the results
                      come off the live results page. Judges whose devices were signed out sign in again with their code, and you approve them.
                    </ConfirmDialog>
                  ) : endedForGood ? null : (
                    <ConfirmDialog
                      triggerLabel="Reopen session"
                      triggerClassName="btn btn-quiet max-sm:flex-1"
                      title="Reopen the session?"
                      confirmLabel="Reopen session"
                      onConfirm={() => changeState("live")}
                    >
                      Judges can score again, and entries can be changed. If a new score comes in, the report ID changes, so a results PDF you&apos;ve
                      already downloaded or printed won&apos;t match anymore.
                      {activity.signedOffAt && " The judges' signatures are taken back, and the results leave the live results page until they sign again."}
                    </ConfirmDialog>
                  )}
                </div>
              </div>
              <FormMessage state={result} small className={result?.ok ? "sr-only" : "px-6 pb-4 font-semibold"} />
              {!progress.complete && (
                <div className="border-t border-line px-6 py-4">
                  <p className="font-semibold">{missingLine}</p>
                  <p className="mt-1 text-[15px] text-prussian/70">Reopen the session so the judges can finish.</p>
                </div>
              )}
            </section>
          )}
          {!archived &&
            liveResultsCard(
              state === "draft"
                ? // A pageant's sub-activities each say how their results come out (live, or after a deliberation).
                  pageant
                  ? null
                  : `Share it now: the audience sees that judging hasn't started, then ${
                      activity.liveScoring ? "each score as it comes in." : "the results once the judges have deliberated and signed."
                    }`
                : state === "deliberation"
                  ? "The audience sees that the judges are deliberating. The results show once they've all signed, and you have."
                  : "The final standings, until you archive the activity.",
            )}

          {/*
            Archived, nothing is left to run: no heading to say judging ended (the archived mark under the name says it),
            only what can still be done with it, straight on the page. The download leads, larger, as the reason to come
            back; deleting it at the far end (on a phone, under it, across the width).
          */}
          {archived && (
            <div className="bare-actions flex flex-wrap items-center gap-3">
              {exportMenu("btn btn-primary h-12 px-7 text-base max-sm:w-full")}
              <div className="max-sm:w-full sm:ml-auto">
                <DeleteArchivedButton activityId={activity.id} name={activity.name} className="btn btn-danger-quiet max-sm:w-full" />
              </div>
            </div>
          )}
          {archived && !progress.complete && (
            <p role="note" className="note font-semibold">
              {missingLine}
            </p>
          )}
        </div>

        {pageant && <ProgramPanel board={board} live={false} onReviewCut={setCutOpen} />}
        {pageant && (
          // Its "Scoring of" choice heads the card: a title above it would only say it twice.
          <section aria-labelledby="scoring-heading" className="card p-5 sm:px-6">
            <h2 id="scoring-heading" className="sr-only">
              Scoring
            </h2>
            <PageantScoring key={scoringOf?.id ?? "none"} rounds={board.rounds} initialId={scoringOf?.id} />
          </section>
        )}
        {runningOrder(false)}
        {cutDialog}

      </div>
    </PdfHold>
  );
}
