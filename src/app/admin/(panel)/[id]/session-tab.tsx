"use client";

import Link from "next/link";
import { useContext, useEffect, useOptimistic, useRef, useState, useTransition } from "react";
import { Avatar } from "@/components/avatar";
import { CopyButton } from "@/components/copy-button";
import { LiveStatusBadge } from "@/components/live-status";
import { Qr } from "@/components/qr";
import { SurveyLink } from "@/components/survey-link";
import { ConfirmDialog } from "@/components/confirm-dialog";
import type { CorrectionView } from "@/lib/corrections";
import { entryNeighbors } from "@/lib/judging";
import { listNames } from "@/lib/names";
import { showingBoard, unitOf } from "@/lib/pageant";
import { reach } from "@/lib/reach";
import { averageText, rankEntries } from "@/lib/scoring";
import { unsignedJudges, type DeliberationResults } from "@/lib/deliberation";
import { SURVEY_URL } from "@/lib/survey";
import { breakFor, ordinal } from "@/lib/ties";
import type { ActionResult, ActivitySignoff, Board, Entry, Judge, JudgeDevice, JudgeSignature, Signatory } from "@/lib/types";
import { JUDGING_OVER, useLiveRefresh, type LiveStatus } from "@/lib/use-live-refresh";
import { setCurrentEntry, setSessionState } from "../../actions";
import { ArchiveButton } from "../archive-controls";
import { FormMessage } from "../form-message";
import { CorrectionsPanel } from "./corrections-panel";
import { FinalSignOff } from "./final-signoff";
import { ApproveDeviceButton } from "./judge-devices";
import { CsvCheck, ExportMenu, HeldLink, PdfHold, sheetOptions } from "./export-menu";
import { CutDialog, DeskTimer, JudgeRoundButton, nextUp, ProgramPanel } from "./pageant-desk";
import { RankingSwitch } from "./ranking-switch";

type Progress = { submitted: number; possible: number; complete: boolean };

const list = new Intl.ListFormat("en", { style: "long", type: "conjunction" });

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
const CONNECTION_LABELS = { live: "Connected", polling: "Updating every 15 seconds" };

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
 * says so, with the approval right there when their device is asking for it.
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
        <span className="text-sm font-bold text-mint">Waiting</span>
      );
  } else if (requests.length > 0) {
    state = (
      <span className={`flex flex-wrap gap-1.5 ${stacked ? "" : "justify-end"}`}>
        {requests.map((d) => (
          <ApproveDeviceButton key={d.id} judge={judge} device={d} className="btn btn-sm bg-mint text-prussian hover:bg-white" />
        ))}
      </span>
    );
  } else {
    state = <span className="text-sm font-semibold text-danger-soft">No device</span>;
  }

  const tone = scored ? "bg-oxford/45 text-mint/75" : waiting ? "bg-oxford ring-1 ring-powder/50" : "bg-oxford";

  if (stacked) {
    return (
      <li
        className={`flex items-center gap-2.5 rounded-xl px-3 py-1.5 leading-5 ${tone} ${!approved && requests.length > 0 ? "@2xl:col-span-2" : ""}`}
        title={judge.name}
      >
        <Avatar name={judge.name} src={judge.photoUrl} size={32} />
        <div className="min-w-0 flex-1">
          <p className="flex min-w-0 items-baseline gap-1.5">
            <span className="truncate font-semibold">{judge.name}</span>
            {judge.isChair && <span className="shrink-0 text-xs font-semibold text-powder">Chair</span>}
          </p>
          <div className="mt-0.5">{state}</div>
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
    </li>
  );
}

export function SessionTab({
  board,
  renderedAt,
  devices,
  progress,
  reportId,
  signatories,
  liveUrl,
  liveQr,
  corrections,
  archived = false,
  hasNotes = false,
  signatures = null,
  signoff = null,
  deliberation,
}: {
  /** Without score values while they're withheld (see withheldScores): then `scored` says who has scored what. */
  board: Board;
  /** When the server read this board, so a desk running on fallback updates can say how fresh it is. */
  renderedAt: number;
  devices: JudgeDevice[];
  progress: Progress;
  reportId: string;
  /** The organizer's signature lines for the PDF; null for the super admin's own activities, which have none. */
  signatories: Signatory[] | null;
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
  /** The organizer's signature on a deliberated session's results, once they've ended it. */
  signoff?: ActivitySignoff | null;
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
  const { activity, judges, entries, scores } = between ? { ...board, scores: [] } : shown;
  const noun = pageant ? "candidate" : "entry";
  const [cutOpen, setCutOpen] = useState<string | null>(null);
  const cutDialog = pageant && <CutDialog key={cutOpen ?? "none"} board={board} roundId={cutOpen} onClose={() => setCutOpen(null)} />;
  const [current, setCurrent] = useOptimistic(activity.currentEntryId);
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<ActionResult | null>(null);
  const [moveError, setMoveError] = useState<string | null>(null);
  const [showQr, setShowQr] = useState(false);
  const textAction =
    "inline-flex h-7 items-center rounded px-1.5 text-sm font-semibold text-regal hover:bg-wash pointer-coarse:h-11 pointer-coarse:min-w-11 pointer-coarse:justify-center pointer-coarse:px-2.5";

  /**
   * The audience's screen, one compact card wherever the desk is: show ranks, and the live results (copy, open, QR
   * code). The LED wall's link is on its own tab, with its settings. `extra`: what follows them (the results downloads,
   * mid-show). An archived activity keeps only the link: nothing to put in front of an audience.
   */
  const screens = (extra?: React.ReactNode) => (
    <section aria-labelledby="screens" className="shrink-0 rounded-2xl border border-line bg-white/60 px-4 py-3 text-sm">
      <h2 id="screens" className="text-base font-bold">
        Screens
      </h2>
      <div className="mt-1.5 space-y-1">
        {!archived && <RankingSwitch activity={activity} compact />}
        {/* Each row says what it is, and each button what it does; screen readers also hear which screen it's for. */}
        <div className="flex flex-wrap items-center gap-x-1">
          <span className="min-w-0 flex-1 truncate font-semibold">Live results</span>
          <CopyButton value={liveUrl} label="Copy link" ariaLabel="Copy link to live results" className={textAction} />
          <a href={liveUrl} target="_blank" rel="noreferrer" aria-label="Open live results" className={textAction}>
            Open
          </a>
          {!archived && (
            <button type="button" className={textAction} aria-expanded={showQr} aria-label="QR code for live results" onClick={() => setShowQr((v) => !v)}>
              QR code
            </button>
          )}
        </div>
        {!activity.liveScoring && !activity.signedOffAt && !archived && (
          <p className="hint">Scores show there once every judge has signed and the session has ended.</p>
        )}
        {/* The scores so far, for this admin only: to tabulate by hand if judging fails. Not a link to share. Closed once
            the activity is archived: its results are final and download below. */}
        {!activity.liveScoring && !pageant && !archived && (
          <div className="flex flex-wrap items-center gap-x-1 pt-1">
            <span className="min-w-0 flex-1 font-semibold">Private tally</span>
            <a href={`/admin/${activity.id}/tally`} target="_blank" rel="noreferrer" aria-label="Open the private tally" className={textAction}>
              Open
            </a>
            <p className="hint w-full">Every score so far, unofficial, for you alone: it asks for your password each time.</p>
          </div>
        )}
        {showQr && !archived && (
          <div className="pb-1">
            <Qr svg={liveQr} label="QR code for the live results page" />
          </div>
        )}
        {/* The judges' notes, for the organizer's reference while the show runs; once it ends they download with the results. */}
        {hasNotes && activity.sessionState !== "ended" && (
          <div className="pt-1">
            <DownloadResults activityId={activity.id} notes className={`${textAction} -ml-1.5`} />
          </div>
        )}
        {extra}
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
  const missing = progress.possible - progress.submitted;

  /*
   * On air: what the audience's screens show right now, in the desk's own words, so the operator never has to open
   * them to check. The live results page shows the entry being judged as it stands; the LED wall follows the entry
   * shown, in its display, with its scores as its settings let them through.
   */
  const heldBack = !activity.liveScoring && !activity.signedOffAt;
  const standing = entry && !heldBack ? rankEntries(entries, judges, scores, activity).find((r) => r.entry.id === entry.id) : undefined;
  const liveNow = heldBack
    ? "A tick for each score in; the scores show once the judges have signed"
    : !standing
      ? activity.showRank
        ? "Every entry, ranked by average"
        : "Every entry, in running order"
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
  const lastOneIn = allIn && !next;
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
    ) : null;
  const fullyScored = (e: Entry) => judges.length > 0 && scoreCount(e.id) >= judges.length;
  // Without live scoring, a fully scored session goes to the deliberation rather than straight to its end.
  const deliberateNext = !pageant && !activity.liveScoring && progress.complete;

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

  const endSession = (triggerClassName: string) => (
    <ConfirmDialog
      triggerLabel="End session"
      triggerClassName={triggerClassName}
      title="End the session?"
      tone="danger"
      confirmLabel="End session"
      passwordLabel="Your password"
      onConfirm={(password) => changeState("ended", password)}
    >
      Judges won&apos;t be able to submit any more scores, and entries can&apos;t be changed. Enter your admin password to confirm. You can reopen the
      session if you need to.
    </ConfirmDialog>
  );

  // The rundown keeps the entry on air in view when it scrolls inside the desk. Instant, never animated.
  const orderRef = useRef<HTMLOListElement>(null);
  useEffect(() => {
    const list = orderRef.current;
    const row = list?.querySelector<HTMLElement>('[data-on-air="true"]');
    if (!list || !row || list.scrollHeight <= list.clientHeight) return;
    list.scrollTop = row.offsetTop - list.clientHeight / 2 + row.offsetHeight / 2;
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
    <kbd aria-hidden className="hidden rounded border border-current/35 px-1.5 text-xs leading-5 font-semibold opacity-80 lg:inline-block">
      {key}
    </kbd>
  );

  /** The running order. `compact` is the live desk's rundown: it scrolls inside its column and keeps the entry on air in view. */
  const runningOrder = (compact: boolean) =>
    entries.length > 0 && (
      <section aria-labelledby="running-order" className={compact ? "flex min-h-0 flex-1 flex-col" : undefined}>
        <h2 id="running-order" className="font-bold">
          {round ? `Running order: ${round.name}` : "Running order"}
        </h2>
        <ol
          ref={compact ? orderRef : undefined}
          // Scrolls on its own in the live desk, so it has to be reachable by keyboard.
          tabIndex={compact ? 0 : undefined}
          aria-labelledby={compact ? "running-order" : undefined}
          className={`mt-3 divide-y divide-line border-y border-line ${compact ? "relative min-h-0 flex-1 overflow-y-auto" : ""}`}
        >
          {entries.map((e, i) => {
            const onAir = e.id === current;
            return (
              <li
                key={e.id}
                data-on-air={onAir && live ? "true" : undefined}
                className={`flex items-center ${compact ? "gap-3 px-2 py-2" : "gap-4 px-3 py-3"} ${onAir && live ? "bg-white" : ""}`}
              >
                <span className={`tabular text-right font-semibold text-prussian/70 ${compact ? "w-6" : "w-8"}`}>{e.number ?? i + 1}</span>
                <span className="min-w-0 flex-1 truncate font-semibold" title={e.name}>
                  {e.name}
                </span>
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
                {state === "draft" || between ? null : state === "ended" || state === "deliberation" ? (
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
                    className: "btn btn-sm text-regal hover:bg-white",
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
   * right. Only the judge grid and the rundown scroll, inside themselves. Below lg it stacks as before.
   */
  if (live) {
    return (
      <PdfHold value={held}>
        <div className="max-lg:space-y-8 lg:-mb-6 lg:grid lg:h-[calc(100dvh-18rem)] lg:min-h-[22rem] lg:grid-cols-[minmax(0,1fr)_minmax(20rem,24rem)] lg:gap-6">
          <section aria-labelledby="desk-heading" className="admin-desk keep-light flex min-h-0 flex-col overflow-hidden rounded-2xl bg-prussian text-mint">
            {offline}
            <div className="flex items-start justify-between gap-4 px-6 pt-4">
              <div className="min-w-0 flex-1">
                <h2 id="desk-heading" className="text-sm text-powder">
                  {round && <span className="font-semibold text-mint">{round.name} · </span>}
                  {entry
                    ? entry.number
                      ? `Now judging: No. ${entry.number} (${index + 1} of ${entries.length})`
                      : `Now judging: No. ${index + 1} of ${entries.length}`
                    : between
                      ? "Between sub-activities"
                      : "On judges' screens"}
                </h2>
                <p title={entry?.name} className="line-clamp-2 text-[clamp(1.375rem,2vw,1.75rem)] leading-tight font-bold text-balance wrap-anywhere">
                  {entry ? entry.name : between ? "Choose what to judge next" : `Judges are waiting for ${pageant ? "a candidate" : "an entry"}`}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-3">
                <DeskConnection status={connection} renderedAt={renderedAt} className="text-powder" />
                {deliberateNext
                  ? !lastOneIn && startDeliberation("btn btn-sm border border-oxford text-mint hover:bg-oxford")
                  : (!lastOneIn || pageantNext) && endSession("btn btn-sm border border-oxford text-mint hover:bg-oxford")}
              </div>
            </div>
            {round && <DeskTimer activity={activity} round={round} renderedAt={renderedAt} />}
            {/* A success ("The session has ended…") is what the desk now shows anyway, so it's announced, not repeated on screen. */}
            <FormMessage state={result} small onDark className={result?.ok ? "sr-only" : "px-6 pt-2 font-semibold"} />
            <CorrectionsPanel activityId={activity.id} corrections={corrections} onDark />

            {between ? (
              <div className="flex min-h-0 flex-1 flex-col items-start gap-4 overflow-y-auto border-t border-oxford px-6 py-5">
                <p className="max-w-xl text-[15px] leading-relaxed text-powder">
                  Judges are waiting. Pick a sub-activity from the program to put its candidates on their screens.
                </p>
                {upNext?.kind === "round" && (
                  <JudgeRoundButton board={board} round={upNext.round} className="btn bg-mint text-prussian hover:bg-white" label={`Judge ${upNext.round.name}`} onDone={setResult} />
                )}
                {upNext?.kind === "cut" && (
                  <button type="button" className="btn bg-mint text-prussian hover:bg-white" onClick={() => setCutOpen(upNext.round.id)}>
                    Review the {upNext.round.cutSize === null ? "" : `Top ${upNext.round.cutSize} `}cut after {upNext.round.name}
                  </button>
                )}
                {!upNext && <p className="font-semibold">Every sub-activity is judged and every cut confirmed. End the session when you&apos;re ready.</p>}
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

                {onAir}

                {/* The action bar: the status on the left, Previous and Next on the right, in the same place all show. */}
                <div role="group" aria-label="Show controls" className="flex shrink-0 flex-wrap items-center gap-3 border-t border-oxford px-6 py-3">
                  {/* Two lines at most so the bar keeps its height; screen readers still get the whole sentence. */}
                  <p role="status" className="line-clamp-2 min-w-48 flex-1 leading-snug font-semibold">
                    {entry &&
                      (allIn
                        ? next
                          ? `Every judge has scored ${entry.name}.`
                          : `Every judge has scored ${entry.name}. That was the last entry.`
                        : `${scoredBy.size} of ${judges.length} ${judges.length === 1 ? "judge has" : "judges have"} scored. Waiting on ${listNames(stillScoring)}.`)}
                  </p>
                  {/* On phones the buttons go full width, the next entry first: it's the one the operator reaches for. */}
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
                      : endSession("btn bg-mint text-prussian hover:bg-white max-sm:order-1 max-sm:w-full")))
                  ) : next ? (
                    moveControl({
                      target: next,
                      kind: "next",
                      label: (
                        <>
                          <span className="truncate">{entry ? `Show next ${noun}: ${next.name}` : `Show first ${noun}`}</span>
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
                  {moveError && (
                    <p role="alert" className="basis-full text-sm font-semibold text-danger-soft max-sm:order-3">
                      {moveError}
                    </p>
                  )}
                </div>
              </>
            )}
          </section>

          <aside aria-label="Running order and screens" className="flex min-h-0 flex-col gap-4">
            {pageant && (
              <div className="max-h-[45%] min-h-0 shrink-0 overflow-y-auto">
                <ProgramPanel board={board} live compact onReviewCut={setCutOpen} />
              </div>
            )}
            {runningOrder(true)}

            {screens(progress.complete && !pageant && activity.liveScoring && (
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-line pt-2">
                    <ExportMenu activityId={activity.id} options={sheetOptions("", { judges: true })} className="btn btn-primary btn-sm" />
                    <p className="text-sm">
                      Report ID <span className="tabular font-bold tracking-wide">{reportId}</span>
                    </p>
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
      <div className="max-w-4xl space-y-10">
        <div className="space-y-4">
          <CorrectionsPanel activityId={activity.id} corrections={corrections} />
          {/*
           * The control desk carries the whole show: who is ready before it starts, who has scored while it runs,
           * and the official results once it ends. It looks like the judges' screens, so it keeps their colours in dark mode.
           */}
          {state === "draft" && (
            <section aria-labelledby="desk-heading" className="admin-desk keep-light overflow-hidden rounded-2xl bg-prussian text-mint">
              {offline}
              <div className="px-6 pt-6 pb-5">
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0 flex-1">
                    <h2 id="desk-heading" className="text-powder">
                      Before you start
                    </h2>
                    <p className="mt-1 text-[clamp(1.4rem,2.6vw,1.9rem)] leading-tight font-bold text-balance">
                      {judges.length === 0
                        ? "Add judges to get started"
                        : unpaired.length === 0
                          ? "Every judge has an approved device"
                          : `${judges.length - unpaired.length} of ${judges.length} ${judges.length === 1 ? "judge has" : "judges have"} an approved device`}
                    </p>
                  </div>
                  <DeskConnection status={connection} renderedAt={renderedAt} className="shrink-0 pt-1 text-powder" />
                </div>
                <FormMessage state={result} small onDark className={result?.ok ? "sr-only" : "pt-2 font-semibold"} />
                {judges.length > 0 && (
                  <ul className="mt-5 grid gap-2 sm:grid-cols-2">
                    {judges.map((j) => (
                      <JudgeTile key={j.id} judge={j} devices={devicesOf(j.id)} scored={null} />
                    ))}
                  </ul>
                )}
              </div>
              <div className="flex flex-wrap items-center gap-x-6 gap-y-3 border-t border-oxford px-6 py-4">
                <p className="min-w-56 flex-1 text-[15px] text-powder">
                  {entries.length} {pageant ? (entries.length === 1 ? "candidate" : "candidates") : entries.length === 1 ? "entry" : "entries"} in the running
                  order.{" "}
                  {judges.length === 0 ? (
                    <Link href={`/admin/${activity.id}?tab=judges`} scroll={false} className="font-semibold text-mint underline underline-offset-2">
                      Add judges
                    </Link>
                  ) : (
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
                  triggerLabel="Start session"
                  triggerClassName="btn shrink-0 bg-mint text-prussian hover:bg-white"
                  title="Start judging?"
                  confirmLabel="Start session"
                  onConfirm={() => changeState("live")}
                >
                  {pageant
                    ? "Judges' screens open, and the judges, running order and program lock. Choose the first sub-activity to judge when you're ready."
                    : "Judges' screens open, and the judges and running order lock. You can still add and rename entries. Show the first entry when you're ready."}
                  {judges.length > 0 && unpaired.length > 0 && (
                    <span className="mt-3 block font-semibold text-prussian">
                      {listNames(unpaired)} {unpaired.length === 1 ? "doesn't" : "don't"} have an approved device yet. They can still pair after you start.
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
              // Every tie in the ranking is broken (by the chair, on their screen) before anyone signs. The ties and the
              // signed results come from the server, which keeps the scores themselves.
              const breaks = board.tieBreaks ?? [];
              const nameOf = new Map(entries.map((e) => [e.id, e.name]));
              const ties = (deliberation?.ties ?? []).map((tie) => ({ tie, settled: breakFor(tie, breaks) }));
              const openTies = ties.filter((t) => !t.settled).length;
              return (
                <section aria-labelledby="desk-heading" className="admin-desk keep-light overflow-hidden rounded-2xl bg-prussian text-mint">
                  {offline}
                  <div className="px-6 pt-6 pb-5">
                    <div className="flex items-start justify-between gap-4">
                      <div className="min-w-0 flex-1">
                        <h2 id="desk-heading" className="text-powder">
                          Deliberation
                        </h2>
                        <p role="status" className="mt-1 text-[clamp(1.4rem,2.6vw,1.9rem)] leading-tight font-bold text-balance">
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
                              <span>: {listNames(tie.entryIds.map((id) => ({ name: nameOf.get(id) ?? "an entry" })))}. The chair breaks it on their screen before anyone signs.</span>
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
                          ? `${openTies === 1 ? "A tie" : `${openTies} ties`} in the ranking ${openTies === 1 ? "isn't" : "aren't"} broken yet. The chair breaks ${openTies === 1 ? "it" : "them"} on their screen; the judges sign after.`
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

          {state === "ended" && (
            <section aria-labelledby="desk-heading" className="admin-desk keep-light overflow-hidden rounded-2xl bg-prussian text-mint">
              <div className="px-6 pt-6 pb-6">
                <div className="flex items-start justify-between gap-4">
                  <h2 id="desk-heading" className="text-powder">
                    Judging has ended
                  </h2>
                  {/*
                    A deliberated session deliberates again, with the password ending took: it reopens the signed record. Any
                    other reopens, and at least asks. Never once archived.
                  */}
                  {!archived && activity.signedOffAt && !activity.liveScoring && !pageant && (
                    <ConfirmDialog
                      triggerLabel="Redeliberate"
                      triggerClassName="btn btn-sm shrink-0 border border-oxford text-mint hover:bg-oxford"
                      title="Deliberate again?"
                      tone="danger"
                      confirmLabel="Redeliberate"
                      passwordLabel="Your password"
                      onConfirm={(password) => changeState("deliberation", password)}
                    >
                      The judges review their scores and sign again, then you sign the results to end the session again. Until then the results
                      come off the live results page. Judges whose devices were signed out sign in again with their code, and you approve them.
                    </ConfirmDialog>
                  )}
                  {!archived && !(activity.signedOffAt && !activity.liveScoring && !pageant) && (
                    <ConfirmDialog
                      triggerLabel="Reopen session"
                      triggerClassName="btn btn-sm shrink-0 border border-oxford text-mint hover:bg-oxford"
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
                <FormMessage state={result} small onDark className={result?.ok ? "sr-only" : "pt-2 font-semibold"} />
                {progress.complete && pageant ? (
                  <>
                    <p className="mt-1 text-[clamp(1.6rem,3vw,2.25rem)] leading-tight font-bold">Every score is in</p>
                    <p className="mt-2 max-w-xl text-[15px] leading-relaxed text-powder">
                      Download each sub-activity&apos;s results, the cuts and the final results from the program below. Each sheet has its own report ID.
                    </p>
                  </>
                ) : progress.complete ? (
                  <>
                    <p className="mt-1 text-[clamp(1.6rem,3vw,2.25rem)] leading-tight font-bold">Every score is in</p>
                    {activity.signedOffAt && (
                      <p className="mt-1 font-semibold text-powder">
                        Signed by every judge after deliberating{signoff ? `, and by ${signoff.signedBy}` : ""}
                      </p>
                    )}
                    <p className="mt-5 text-sm font-semibold text-powder">Report ID</p>
                    <p className="tabular text-[clamp(1.75rem,4.5vw,2.75rem)] leading-tight font-bold tracking-[0.06em]">{reportId}</p>
                    <p className="mt-2 max-w-xl text-[15px] leading-relaxed text-powder">
                      Printed on the results PDF and on each judge&apos;s score sheet. The ID changes if any score changes, so anyone can check a printed sheet
                      against this screen.
                    </p>
                  </>
                ) : (
                  <>
                    <p className="mt-1 text-[clamp(1.6rem,3vw,2.25rem)] leading-tight font-bold">
                      {missing} {missing === 1 ? "score is" : "scores are"} missing
                    </p>
                    <p className="mt-2 max-w-xl text-[15px] leading-relaxed text-powder">
                      {archived
                        ? "It was archived with scores missing, so a results PDF can't be made."
                        : pageant
                          ? "Each results PDF needs every judge's score for every candidate in it. Reopen the session so the remaining judges can score."
                          : "The results PDF needs every judge's score for every entry. Reopen the session so the remaining judges can score."}
                    </p>
                  </>
                )}
              </div>
              {progress.complete && !pageant && (
                <div className="flex flex-wrap items-center gap-x-6 gap-y-3 border-t border-oxford px-6 py-4">
                  <div className="flex flex-wrap gap-3">
                    <ExportMenu
                      activityId={activity.id}
                      options={[
                        ...sheetOptions("", { judges: true }),
                        ...(hasNotes ? [{ label: "Judges' notes (PDF)", query: "sheet=notes", held: false }] : []),
                      ]}
                      className="btn bg-mint text-prussian hover:bg-white max-sm:w-full"
                    />
                    <CsvCheck activityId={activity.id} className="btn border border-oxford text-mint hover:bg-oxford" onDark />
                  </div>
                  {signatories && (
                    <p className="min-w-56 flex-1 text-sm leading-relaxed text-powder">
                      {signatories.length > 0
                        ? `Signature lines: ${list.format(signatories.map((s) => (s.designation ? `${s.name} (${s.designation})` : s.name)))}.`
                        : "No signatories yet, so the PDFs print one blank Tabulator line."}
                      {!archived && (
                        <>
                          {" "}
                          <Link href={`/admin/${activity.id}?tab=settings#signatories`} className="font-semibold text-mint underline underline-offset-2">
                            Edit signatories
                          </Link>
                        </>
                      )}
                    </p>
                  )}
                </div>
              )}
              {SURVEY_URL && (
                <div className="flex flex-wrap items-center gap-x-6 gap-y-3 border-t border-oxford px-6 py-4">
                  <p className="min-w-56 flex-1 text-sm leading-relaxed text-powder">
                    How did Tabulous work for this event? A short anonymous survey, about 8 minutes, helps make it better.
                  </p>
                  <SurveyLink className="btn btn-sm shrink-0 border border-oxford text-mint hover:bg-oxford">Take the survey</SurveyLink>
                </div>
              )}
              {/* Archiving is how the organizer says no more deliberating is needed: judging closes for good. */}
              {!archived && (
                <div className="flex flex-wrap items-center gap-x-6 gap-y-3 border-t border-oxford px-6 py-4">
                  <p className="min-w-56 flex-1 text-sm leading-relaxed text-powder">
                    No more deliberating needed? Archive it: judges are signed out, their codes stop working and the private tally closes.
                  </p>
                  <ArchiveButton activityId={activity.id} name={activity.name} className="btn btn-sm shrink-0 border border-oxford text-mint hover:bg-oxford" />
                </div>
              )}
            </section>
          )}
        </div>

        {pageant && <ProgramPanel board={board} live={false} onReviewCut={setCutOpen} />}
        {runningOrder(false)}
        {cutDialog}

        <div className="sm:max-w-md">{screens()}</div>
      </div>
    </PdfHold>
  );
}
