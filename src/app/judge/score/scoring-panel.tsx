"use client";

import { useEffect, useEffectEvent, useId, useRef, useState, useTransition } from "react";
import { Avatar } from "@/components/avatar";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { LiveStatusBadge } from "@/components/live-status";
import { TimerBar, useScoringTimer } from "@/components/scoring-timer";
import { MAX_CORRECTION_REASON, type CorrectionView } from "@/lib/corrections";
import { entryNeighbors, judgeView, type JudgeView } from "@/lib/judging";
import { listNames } from "@/lib/names";
import { SCORE_UNDO_MS } from "@/lib/pageant";
import { applyKey, criterionRules, formatBound, formatScore, overMax, overMaxMessage, parseBreakdown, parseScore, rangeLabel, type Key } from "@/lib/scoring";
import type { Activity, Criterion, Entry, Judge } from "@/lib/types";
import { useDeviceSetting } from "@/lib/use-device-setting";
import { useLiveRefresh } from "@/lib/use-live-refresh";
import { leavePortal, moveToEntry, requestApproval, requestCorrection, submitScore, voteOnCorrection, withdrawCorrection } from "../actions";
import { NotesBeside, NotesInline, useMediaQuery, useWideScreen, type NoteStore } from "./entry-notes";

/** Whether the organizer has approved this device for the judge. Only the approved device can score. */
export type DeviceGate = { status: "approved" } | { status: "pending"; pairingCode: string; label: string } | { status: "revoked" };

/** For the chair of the board of judges: the panel, and whether each judge has scored the entry on screen. */
export type PanelJudge = { id: string; name: string; photoUrl: string | null; scored: boolean };

type Props = {
  activity: Activity;
  judge: Judge;
  entries: Entry[];
  myScores: { entryId: string; value: number }[];
  /** The judge's notes, by entry id; null when there are none to show (not approved yet, or before migration 018). */
  notes: Record<string, string> | null;
  /** With criteria, the points this judge gave the entry on screen, once it's scored (null otherwise). */
  breakdown: Record<string, number> | null;
  /** Score corrections; null when judges can't ask for them (not approved yet, or before migration 019). */
  corrections: Corrections | null;
  gate: DeviceGate;
  /** Only for the chair, who can move entries. */
  panel: PanelJudge[] | null;
  /** A pageant's sub-activity being judged now (its rules are already in `activity`). */
  round: { name: string; timerSeconds: number | null } | null;
  /** When the server rendered this page, so the scoring timer counts down on the server's clock. */
  serverNow: number;
  /** A pageant sub-activity is on that this judge doesn't judge (the preliminary can have its own judges). */
  offPanel?: boolean;
};

const DIGITS: Key[] = ["1", "2", "3", "4", "5", "6", "7", "8", "9"];
const NETWORK_ERROR = "The score didn't save. Check your connection and try again.";
/** Error red that stays readable on the navy panels. */
const ERROR_TEXT = "text-danger-soft";
const ERROR_RING = "ring-3 ring-danger-soft";
/**
 * The readout, keypad and main button, held at the bottom of the screen (see .keypad-dock in globals.css). On a phone
 * it sits there even when everything fits, where a thumb reaches.
 */
const DOCK = "keypad-dock max-md:mt-auto";
/** How long a correction vote's answers wait after it opens, so a tap meant for what was under it can't cast the vote. */
const VOTE_ARM_MS = 600;

/** Marks a criterion with a guide for judges. */
function GuideIcon({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 20 20" className={`size-4 shrink-0 ${className}`} aria-hidden>
      <circle cx="10" cy="10" r="7.5" fill="none" stroke="currentColor" strokeWidth="1.6" />
      <path d="M10 9v4.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      <circle cx="10" cy="6.4" r="1" fill="currentColor" />
    </svg>
  );
}

function WarningIcon() {
  return (
    <svg viewBox="0 0 20 20" className="mr-1.5 inline size-4 -translate-y-px" aria-hidden>
      <path d="M10 2.5l8 14H2l8-14z" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
      <path d="M10 8v3.6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      <circle cx="10" cy="14.2" r="1" fill="currentColor" />
    </svg>
  );
}

/** A judge's own score as they think of it: the score, or criteria points out of 100. */
function myScoreText(value: number, activity: Activity): string {
  return activity.scoringMode === "criteria" ? `${formatScore(value, activity.decimals)} / 100` : formatScore(value, activity.decimals);
}

/**
 * Score corrections on this judge's screen: the ones waiting for their vote (oldest first), their own latest one on the
 * entry on screen, and whether other judges (or, for a judge alone on their panel, the organizer) decide theirs.
 */
export type Corrections = {
  toVote: CorrectionView[];
  mine: CorrectionView | null;
  othersVote: boolean;
};

/**
 * A score the judge has confirmed, waiting out its undo window before it goes to the server. `typed`: what the keypad
 * sends (the score, or each criterion's points). `sending`: the window is over and it's on its way.
 */
type PendingScore = { entry: Entry; typed: string | Record<string, string>; value: number; sending: boolean };
/** What a keypad needs to hand over a confirmed score, and to know whether one is waiting or failed. */
type Submission = {
  submit: (entry: Entry, typed: PendingScore["typed"], value: number) => void;
  /** Whether anything is typed on the keypad: a correction vote waits until it's submitted or cleared. */
  typing: (typing: boolean) => void;
  /** A score for this entry is waiting out its undo window, or on its way. */
  busy: boolean;
  /** Why this entry's last score didn't save. */
  error: string | null;
};

/**
 * The judge's screen. Nothing opens until the organizer approves this device. After that the organizer
 * decides which entry is judged and when: judges only ever see the entry on screen, and wait in between.
 */
// A device waiting for approval checks every few seconds even when realtime is down, so the organizer's
// approval lands on the judge's screen right away. Other judge screens check a little less often.
const PENDING_POLL_MS = 2_500;
const JUDGE_POLL_MS = 5_000;

export function ScoringPanel({ activity, judge, entries, myScores, notes, breakdown, corrections, gate, panel, round, serverNow, offPanel = false }: Props) {
  const pageant = activity.kind === "pageant";
  const status = useLiveRefresh(activity.id, { pollMs: gate.status === "pending" ? PENDING_POLL_MS : JUDGE_POLL_MS });
  // Scores confirmed by the server but not yet in the refreshed page, so the keypad doesn't flash back. Once the page
  // has a score, its value wins: a correction can change it.
  const [justSaved, setJustSaved] = useState<Map<string, number>>(() => new Map());
  // With criteria, the points behind each of those scores: a correction asked for before the page has them starts from these.
  const [justSavedPoints, setJustSavedPoints] = useState<Map<string, Record<string, number>>>(() => new Map());
  const scores = new Map([...justSaved, ...myScores.map((s) => [s.entryId, s.value] as const)]);
  // Off the panel of the sub-activity on screen: nothing to score until their part comes up.
  const view: JudgeView = offPanel ? { kind: "waiting" } : judgeView(activity, entries, scores);
  // A short message at the top: a score saved, a vote cast.
  const [toast, setToast] = useState<React.ReactNode>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const approved = gate.status === "approved";

  const showToast = (content: React.ReactNode) => {
    setToast(content);
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 3500);
  };
  const onSaved = (entry: Entry, value: number, typed: PendingScore["typed"]) => {
    setJustSaved((m) => new Map(m).set(entry.id, value));
    const points = typeof typed === "string" ? null : parseBreakdown(typed, activity.criteria, activity.decimals);
    if (points?.ok) setJustSavedPoints((m) => new Map(m).set(entry.id, points.breakdown));
    showToast(
      <span className="block truncate">
        Saved <span className="tabular">{myScoreText(value, activity)}</span> for {entry.name}
      </span>,
    );
  };

  // A confirmed score waits SCORE_UNDO_MS before it's sent, so a slip can be undone. It lives here rather than in the
  // keypad, so it's still sent (and a failure still shown) if the organizer moves on meanwhile.
  const [pending, setPending] = useState<PendingScore | null>(null);
  const [failed, setFailed] = useState<{ entry: Entry; error: string } | null>(null);
  const send = useEffectEvent(async (score: PendingScore) => {
    setPending({ ...score, sending: true });
    const result = await submitScore(score.entry.id, score.typed).catch(() => ({ ok: false as const, error: NETWORK_ERROR }));
    setPending(null);
    if (result.ok) onSaved(score.entry, score.value, score.typed);
    else setFailed({ entry: score.entry, error: result.error });
  });
  useEffect(() => {
    if (!pending || pending.sending) return;
    const timer = setTimeout(() => send(pending), SCORE_UNDO_MS);
    // Leaving the page now would drop the score: the browser asks first.
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => {
      clearTimeout(timer);
      window.removeEventListener("beforeunload", warn);
    };
  }, [pending]);
  // The entry whose keypad has a score typed on it (not yet submitted).
  const [typingFor, setTypingFor] = useState<string | null>(null);
  const submission = (entry: Entry): Submission => ({
    submit: (e, typed, value) => {
      setFailed(null);
      setPending({ entry: e, typed, value, sending: false });
    },
    typing: (typing) => setTypingFor((t) => (typing ? entry.id : t === entry.id ? null : t)),
    busy: pending?.entry.id === entry.id,
    error: failed?.entry.id === entry.id ? failed.error : null,
  });

  const currentId = approved && (view.kind === "scoring" || view.kind === "scored") ? view.entry.id : null;
  // The points behind the score on screen (criteria): the page's, or, until it has them, the ones just saved here.
  const pointsOnScreen = view.kind === "scored" ? (breakdown ?? justSavedPoints.get(view.entry.id) ?? null) : null;
  // Correcting the score on screen: the keypad comes back, starting from what they gave.
  const [correctingFor, setCorrectingFor] = useState<string | null>(null);
  const correcting = corrections && view.kind === "scored" && correctingFor === view.entry.id;
  const idle: Submission = { submit: () => {}, typing: () => {}, busy: false, error: null };

  // Another judge's correction can't be put off, but it waits while this judge is typing a score, inside its undo
  // window, or correcting their own: over the keypad, a tap meant for a digit could cast the vote.
  const [votedIds, setVotedIds] = useState<Set<string>>(() => new Set());
  const toVote = corrections?.toVote.filter((c) => !votedIds.has(c.id)) ?? [];
  const busyScoring = !!pending || !!correcting || (view.kind === "scoring" && typingFor === view.entry.id);
  const onVoted = (c: CorrectionView, agree: boolean) => {
    setVotedIds((ids) => new Set(ids).add(c.id));
    showToast(
      agree ? (
        <>
          You agreed to change {c.judgeName}&apos;s score to <span className="tabular whitespace-nowrap">{c.to}</span>.
        </>
      ) : (
        <>
          You disagreed, so {c.judgeName}&apos;s score stays <span className="tabular whitespace-nowrap">{c.from}</span>.
        </>
      ),
    );
  };

  // Notes on the entry on screen: beside the keypad on a wide screen, under the entry's name otherwise. Notes saved here
  // are remembered until the refreshed page has them.
  const [savedNotes, setSavedNotes] = useState<Map<string, string>>(() => new Map());
  const noteStore: NoteStore | null =
    notes && approved && !offPanel
      ? { get: (id) => savedNotes.get(id) ?? notes[id] ?? "", stored: (id, body) => setSavedNotes((m) => new Map(m).set(id, body)) }
      : null;
  const wide = useWideScreen();
  const noteEntry = view.kind === "scoring" || view.kind === "scored" ? view.entry : null;
  const inlineNotes = noteStore && noteEntry && !wide ? <NotesInline key={noteEntry.id} entry={noteEntry} notes={noteStore} /> : null;
  // A pageant sub-activity's timer: green while judges can score, yellow as it's about to close, red once it has.
  const timer = useScoringTimer(view.kind === "scoring" ? activity.scoringClosesAt : null, round?.timerSeconds ?? null, serverNow);
  const timerBar = timer && round?.timerSeconds && (
    <div className="mb-4 w-full">
      <TimerBar state={timer} timerSeconds={round.timerSeconds} closedHint="Ask the organizer to reopen scoring." />
    </div>
  );

  return (
    <div className="flex h-dvh flex-col bg-prussian text-mint">
      <header className="flex items-center gap-3 border-b border-oxford px-4 py-3 sm:px-6">
        <Avatar name={judge.name} src={judge.photoUrl} size={44} />
        <div className="min-w-0">
          <p className="truncate font-semibold">{judge.name}</p>
          <p className="truncate text-sm text-powder">
            {activity.name}
            {round && ` · ${round.name}`}
          </p>
        </div>
        <div className="ml-auto flex items-center gap-4 sm:gap-6">
          {approved && !offPanel && (
            <>
              <p className="tabular hidden text-powder md:block">
                <span className="font-bold text-mint">{scores.size}</span> of {entries.length} scored
              </p>
              {/* Narrower, the list isn't beside the keypad: the count opens it. */}
              <ScoresSheet title={`Your scores${round ? ` in ${round.name}` : ""}`} scored={scores.size} total={entries.length}>
                <ScoreList entries={entries} scores={scores} currentId={currentId} decimals={activity.decimals} />
              </ScoresSheet>
            </>
          )}
          <LiveStatusBadge status={status} className="text-mint" compact />
          {approved ? (
            // Signing out revokes this device, so judging can't carry on here without the organizer: asked first, as a
            // stray tap mid-show would stall the panel.
            <ConfirmDialog
              triggerLabel="Sign out"
              triggerClassName="btn btn-sm border border-oxford text-powder hover:bg-oxford hover:text-mint"
              title="Sign out of judging?"
              confirmLabel="Sign out"
              tone="danger"
              onConfirm={async () => {
                await leavePortal();
              }}
            >
              This device stops scoring. To judge again you&apos;ll need your judge code, and the organizer has to approve a new pairing code.
            </ConfirmDialog>
          ) : (
            <form action={leavePortal}>
              <button className="btn btn-sm border border-oxford text-powder hover:bg-oxford hover:text-mint">Sign out</button>
            </form>
          )}
        </div>
      </header>

      <div className="relative flex min-h-0 flex-1 flex-col md:flex-row">
        {/* A short message (a score saved, a vote cast), just under the header so the judge's name and count stay in view. */}
        {toast && (
          <p
            role="status"
            className="toast-in absolute inset-x-4 top-3 z-10 mx-auto flex max-w-md items-center gap-2 rounded-xl bg-mint px-4 py-3.5 font-semibold text-prussian shadow-lg shadow-prussian/40"
          >
            <svg viewBox="0 0 16 16" className="size-5 shrink-0 text-regal" aria-hidden>
              <path d="M3 8.5l3 3 7-7" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            <span className="min-w-0 text-balance">{toast}</span>
          </p>
        )}
        {approved && !offPanel && (
          <aside aria-label="Your scores" className="hidden shrink-0 border-oxford md:block md:w-72 md:overflow-y-auto md:border-r lg:w-80">
            <h2 className="px-6 pt-5 pb-2 text-sm font-semibold text-powder">Your scores{round && ` in ${round.name}`}</h2>
            <ScoreList entries={entries} scores={scores} currentId={currentId} decimals={activity.decimals} />
          </aside>
        )}

        <main className="flex min-h-0 flex-1 flex-col items-center overflow-y-auto px-4 pt-5 sm:px-8 md:justify-center-safe">

          {/* A correction waits for this judge's vote, held until they're done here: said, so it doesn't surprise them. */}
          {busyScoring && toVote.length > 0 && (
            <p role="status" className="mb-4 flex w-full max-w-md items-start gap-2 text-sm text-powder lg:max-w-lg">
              <GuideIcon className="mt-0.5" />
              <span>
                {toVote[0].judgeName} asks to correct a score. You&apos;ll vote once {correcting ? "your correction is done" : "your score is in"}.
              </span>
            </p>
          )}

          {/* A score that didn't save after the organizer had moved on: its keypad is gone, so it's said here. */}
          {failed && failed.entry.id !== currentId && (
            <p role="alert" className={`mb-4 w-full max-w-md rounded-xl border border-danger-soft px-4 py-3 font-semibold lg:max-w-lg ${ERROR_TEXT}`}>
              <WarningIcon />
              Your score for {failed.entry.name} didn&apos;t save. {failed.error}
            </p>
          )}

          {!approved ? (
            <DeviceGateCard gate={gate} />
          ) : correcting ? (
            (() => {
              const fix: Correcting = {
                from: view.value,
                fromBreakdown: pointsOnScreen,
                othersVote: corrections.othersVote,
                onDone: () => setCorrectingFor(null),
              };
              return activity.scoringMode === "criteria" ? (
                <CriteriaKeypad key={`${view.entry.id}-fix`} activity={activity} entry={view.entry} number={view.number} submission={idle} correcting={fix} />
              ) : (
                <Keypad key={`${view.entry.id}-fix`} activity={activity} entry={view.entry} number={view.number} submission={idle} correcting={fix} />
              );
            })()
          ) : view.kind === "scoring" ? (
            activity.scoringMode === "criteria" ? (
              <CriteriaKeypad
                key={view.entry.id}
                activity={activity}
                entry={view.entry}
                number={view.number}
                notes={inlineNotes}
                submission={submission(view.entry)}
                timer={timerBar}
                closed={timer?.phase === "closed"}
              />
            ) : (
              <Keypad
                key={view.entry.id}
                activity={activity}
                entry={view.entry}
                number={view.number}
                notes={inlineNotes}
                submission={submission(view.entry)}
                timer={timerBar}
                closed={timer?.phase === "closed"}
              />
            )
          ) : (
            <div className="my-auto flex w-full max-w-md flex-col items-center pb-5 lg:max-w-lg">
              <WaitingCard
                view={view}
                judge={judge}
                activity={activity}
                round={round}
                scoredCount={scores.size}
                entryCount={entries.length}
                points={
                  pointsOnScreen && activity.scoringMode === "criteria"
                    ? activity.criteria.flatMap((c) => (pointsOnScreen[c.id] === undefined ? [] : [{ id: c.id, name: c.name, points: pointsOnScreen[c.id], max: c.max }]))
                    : null
                }
                movesEntries={!!panel}
                offPanel={offPanel}
                correction={
                  corrections && view.kind === "scored" ? (
                    <CorrectionStatus mine={corrections.mine} othersVote={corrections.othersVote} onAsk={() => setCorrectingFor(view.entry.id)} />
                  ) : null
                }
              />
              {panel && (view.kind === "waiting" || view.kind === "scored") && !(pageant && !round) && (
                <EntryControls activity={activity} entries={entries} panel={panel} />
              )}
              {view.kind === "scored" && inlineNotes && <div className="mt-6 w-full">{inlineNotes}</div>}
            </div>
          )}
        </main>
        {noteStore && wide && <NotesBeside entry={noteEntry} notes={noteStore} />}
      </div>
      {pending && <UndoBar key={pending.entry.id} pending={pending} shown={myScoreText(pending.value, activity)} onUndo={() => setPending(null)} />}
      {/* Another judge's correction waits for this judge's vote: it can't be put off, only held while they score. */}
      {!busyScoring && toVote.length > 0 && <CorrectionVote key={toVote[0].id} view={toVote[0]} onVoted={(agree) => onVoted(toVote[0], agree)} />}
    </div>
  );
}

/** The entries in running order with this judge's score for each: beside the keypad from 768px, in a sheet below. */
function ScoreList({ entries, scores, currentId, decimals }: { entries: Entry[]; scores: Map<string, number>; currentId: string | null; decimals: Activity["decimals"] }) {
  return (
    <ol className="space-y-1 px-3 pb-4">
      {entries.map((entry, i) => {
        const value = scores.get(entry.id);
        const current = entry.id === currentId;
        return (
          <li key={entry.id} aria-current={current ? "true" : undefined} className={`flex items-center gap-3 rounded-xl px-3 py-3 ${current ? "bg-regal" : ""}`}>
            <span className={`tabular w-6 text-sm ${current ? "text-mint" : "text-powder"}`}>{entry.number ?? i + 1}</span>
            <span className="min-w-0 flex-1 truncate font-semibold">
              {entry.name}
              {current && <span className="sr-only"> (now judging)</span>}
            </span>
            {value !== undefined ? (
              <span className={`tabular text-sm font-semibold ${current ? "text-mint/80" : "text-powder"}`}>{formatScore(value, decimals)}</span>
            ) : (
              <span className="text-sm text-powder">
                <span aria-hidden>–</span>
                <span className="sr-only">Not scored</span>
              </span>
            )}
          </li>
        );
      })}
    </ol>
  );
}

/**
 * Below 768px, the header's count ("1/3") opens the judge's scores in a sheet from the bottom of the screen, so they can
 * compare as they go, as the list beside the keypad lets them on a wider screen.
 */
function ScoresSheet({ title, scored, total, children }: { title: string; scored: number; total: number; children: React.ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  return (
    <>
      <button
        type="button"
        onClick={() => ref.current?.showModal()}
        aria-haspopup="dialog"
        className="tabular flex h-11 shrink-0 items-center gap-1 rounded-lg border border-oxford px-2 text-powder hover:bg-oxford hover:text-mint md:hidden"
      >
        <svg viewBox="0 0 16 16" className="size-4" aria-hidden>
          <path d="M5.5 4h8M5.5 8h8M5.5 12h8" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
          <circle cx="2.5" cy="4" r="1" fill="currentColor" />
          <circle cx="2.5" cy="8" r="1" fill="currentColor" />
          <circle cx="2.5" cy="12" r="1" fill="currentColor" />
        </svg>
        <span>
          <span className="font-bold text-mint">{scored}</span>/{total}
          <span className="sr-only"> scored. Show your scores</span>
        </span>
      </button>
      <dialog
        ref={ref}
        aria-labelledby={titleId}
        // A tap on the dimmed page around the sheet closes it.
        onClick={(e) => e.target === ref.current && ref.current.close()}
        className="mx-0 mt-auto mb-0 max-h-[85dvh] w-full max-w-full overflow-y-auto rounded-t-3xl bg-prussian p-0 text-mint shadow-2xl"
      >
        <div className="sticky top-0 flex items-center justify-between gap-3 bg-prussian px-6 pt-5 pb-3">
          <h2 id={titleId} className="font-semibold">
            {title}
          </h2>
          <button type="button" onClick={() => ref.current?.close()} className="btn btn-sm border border-oxford text-powder hover:bg-oxford hover:text-mint">
            Close
          </button>
        </div>
        {children}
      </dialog>
    </>
  );
}

/**
 * Another judge asks to change their score: this judge sees the score, the new one and the reason, and agrees or
 * disagrees. It can't be closed without a vote (Escape reopens it), and the vote is final. Once it's cast, `onVoted`
 * takes it off the screen.
 */
function CorrectionVote({ view, onVoted }: { view: CorrectionView; onVoted: (agree: boolean) => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  // Focus starts on the question, so neither answer is one Enter away.
  const titleRef = useRef<HTMLHeadingElement>(null);
  const [pending, startTransition] = useTransition();
  const voted = useRef(false);
  const [error, setError] = useState<string | null>(null);
  // The answers wake a moment after the dialog opens, so a tap already on its way (on the keypad that was there) can't
  // land on one of them.
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    if (!ref.current?.open) ref.current?.showModal();
    titleRef.current?.focus();
    const wake = setTimeout(() => setArmed(true), VOTE_ARM_MS);
    return () => clearTimeout(wake);
  }, []);
  const vote = (agree: boolean) =>
    startTransition(async () => {
      setError(null);
      const result = await voteOnCorrection(view.id, agree).catch(() => ({ ok: false as const, error: "Your vote didn't go through. Check your connection and try again." }));
      if (!result.ok) {
        setError(result.error);
        return;
      }
      voted.current = true;
      ref.current?.close();
      onVoted(agree);
    });
  const where = view.roundName ? ` in ${view.roundName}` : "";
  const answer = "btn h-auto min-h-14 flex-col gap-0 rounded-xl border-2 border-regal bg-white py-2 text-lg text-regal transition hover:bg-regal hover:text-mint";
  return (
    <dialog
      ref={ref}
      aria-labelledby="vote-title"
      aria-describedby="vote-rule"
      onCancel={(e) => e.preventDefault()}
      onClose={() => {
        if (!voted.current) ref.current?.showModal();
      }}
      className="m-auto max-h-[calc(100dvh-2rem)] w-[min(30rem,calc(100vw-2rem))] overflow-y-auto rounded-3xl bg-mint p-0 text-prussian shadow-2xl"
    >
      <div className="px-6 pt-6 pb-5">
        <h2 id="vote-title" ref={titleRef} tabIndex={-1} className="text-xl leading-snug font-bold text-balance focus:outline-none">
          {view.judgeName} asks to change their score for No. {view.entryNumber} {view.entryName}
          {where}
        </h2>
        <FromTo from={view.fromNumber} to={view.toNumber} />
        {view.outOf100 && <p className="text-center text-sm text-prussian/75">out of 100</p>}
        {view.criteria.length > 0 && (
          <ol aria-label="Points for each criterion, before and after" className="mt-4 space-y-1 text-left">
            {view.criteria.map((c) => (
              <li key={c.name} className={`flex items-baseline gap-3 rounded-lg px-3 py-1.5 ${c.changed ? "bg-white font-semibold ring-1 ring-regal/40" : ""}`}>
                <span className="min-w-0 flex-1">{c.name}</span>
                <span className="tabular">
                  {c.changed ? (
                    <>
                      {c.from} <span aria-hidden>→</span>
                      <span className="sr-only"> to </span> {c.to}
                    </>
                  ) : (
                    c.to
                  )}
                </span>
              </li>
            ))}
          </ol>
        )}
        <blockquote className="mt-4 rounded-xl bg-white px-4 py-3 text-left">
          <p className="text-sm text-prussian/70">Why</p>
          <p className="mt-0.5 whitespace-pre-line">{view.reason}</p>
        </blockquote>
        <p id="vote-rule" className="mt-3 text-sm text-prussian/75">
          It changes only if every other judge agrees; one disagreeing keeps the score as it is. Your vote is final, and no one sees it by
          name.
        </p>
        {error && (
          <p role="alert" className="mt-3 font-semibold text-danger">
            {error}
          </p>
        )}
      </div>
      {/* The two answers look alike, so neither reads as the one expected. */}
      <div className="grid grid-cols-2 gap-3 px-6 pb-6">
        <button type="button" disabled={!armed || pending} onClick={() => vote(false)} className={answer}>
          Disagree
          <span className="tabular text-sm font-normal">Keep {view.from}</span>
        </button>
        <button type="button" disabled={!armed || pending} onClick={() => vote(true)} className={answer}>
          Agree
          <span className="tabular text-sm font-normal">Change to {view.to}</span>
        </button>
      </div>
    </dialog>
  );
}

/**
 * Under a judge's submitted score: what they can do about it, their correction waiting for votes (with Withdraw), or
 * how their last one ended and what's left to do.
 */
function CorrectionStatus({ mine, othersVote, onAsk }: { mine: CorrectionView | null; othersVote: boolean; onAsk: () => void }) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  if (mine?.status === "open") {
    return (
      <div className="mt-4 rounded-xl bg-oxford px-4 py-3 text-left">
        <p className="font-semibold">
          You asked to change it to <span className="tabular">{mine.to}</span>.
        </p>
        <p className="mt-1 text-sm text-powder">
          {othersVote
            ? `${mine.agreed} of ${mine.voters} ${mine.voters === 1 ? "judge has" : "judges have"} agreed. It changes only if every one of them agrees.`
            : "Waiting for the organizer to approve it."}
        </p>
        <button
          type="button"
          disabled={pending}
          onClick={() =>
            startTransition(async () => {
              setError(null);
              const result = await withdrawCorrection(mine.id).catch(() => ({ ok: false as const, error: "That didn't go through. Check your connection and try again." }));
              if (!result.ok) setError(result.error);
            })
          }
          className="btn btn-sm mt-3 border border-regal text-mint hover:bg-regal"
        >
          Withdraw correction
        </button>
        {error && (
          <p role="alert" className={`mt-2 text-sm font-semibold ${ERROR_TEXT}`}>
            {error}
          </p>
        )}
      </div>
    );
  }
  return (
    <>
      {mine?.status === "approved" ? (
        <p className="mt-2 text-sm font-semibold">
          Corrected from <span className="tabular">{mine.from}</span>: {mine.decidedBy === "organizer" ? "the organizer approved it." : "every other judge agreed."}
        </p>
      ) : mine?.status === "rejected" ? (
        <p className="mt-2 text-sm text-balance">
          Your correction to <span className="tabular">{mine.to}</span> wasn&apos;t accepted{mine.decidedBy === "organizer" ? " by the organizer" : ": a judge disagreed"}, so
          this score stands. If it&apos;s still wrong, you can ask again and say more about why.
        </p>
      ) : (
        <p className="mt-2 text-sm text-powder">Submitted. If it&apos;s wrong, you can ask to correct it.</p>
      )}
      <button type="button" onClick={onAsk} className="btn mt-4 border border-regal text-mint hover:bg-regal">
        {mine?.status === "rejected" ? "Ask again" : "Ask to correct this score"}
      </button>
    </>
  );
}

/**
 * The few seconds after a judge submits, before the score goes in: a countdown, a draining bar and Undo, at the
 * bottom where a thumb reaches. Undo takes focus, so a keyboard judge can take it back at once.
 */
function UndoBar({ pending, shown, onUndo }: { pending: PendingScore; shown: string; onUndo: () => void }) {
  const seconds = SCORE_UNDO_MS / 1000;
  const [left, setLeft] = useState(seconds);
  const undoRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    undoRef.current?.focus();
    const started = Date.now();
    const tick = setInterval(() => setLeft(Math.max(1, Math.ceil((SCORE_UNDO_MS - (Date.now() - started)) / 1000))), 200);
    return () => clearInterval(tick);
  }, []);
  return (
    <div className="toast-in fixed inset-x-4 bottom-4 z-20 mx-auto max-w-md overflow-hidden rounded-2xl bg-mint text-prussian shadow-lg shadow-prussian/40 lg:max-w-lg">
      {/* Said once; the ticking seconds are only for the eye. */}
      <p role="status" className="sr-only">
        {pending.sending
          ? `Submitting ${shown} for ${pending.entry.name}.`
          : `Submitting ${shown} for ${pending.entry.name} in ${seconds} seconds. Press Undo to change it.`}
      </p>
      <div aria-hidden={pending.sending || undefined} className="flex items-center gap-3 px-4 py-3">
        <p aria-hidden className="min-w-0 flex-1">
          <span className="block font-semibold">{pending.sending ? "Submitting…" : `Submitting in ${left}…`}</span>
          <span className="block truncate text-sm text-prussian/75">
            <span className="tabular font-semibold text-prussian">{shown}</span> for {pending.entry.name}
          </span>
        </p>
        {!pending.sending && (
          <button ref={undoRef} type="button" onClick={onUndo} className="btn h-12 shrink-0 rounded-xl bg-prussian px-6 text-lg text-mint hover:bg-regal">
            Undo
          </button>
        )}
      </div>
      <div aria-hidden className="h-1.5 bg-powder/40">
        {!pending.sending && <div className="undo-drain h-full bg-regal" style={{ animationDuration: `${SCORE_UNDO_MS}ms` }} />}
      </div>
    </div>
  );
}

function WaitingDots() {
  return (
    <span aria-hidden className="mb-5 flex gap-2 text-powder">
      <span className="led-dot size-3 rounded-full bg-current" />
      <span className="led-dot size-3 rounded-full bg-current [animation-delay:.2s]" />
      <span className="led-dot size-3 rounded-full bg-current [animation-delay:.4s]" />
    </span>
  );
}

/** Until the organizer approves this device: a pairing code to read out, or a way to ask again. */
function DeviceGateCard({ gate }: { gate: Exclude<DeviceGate, { status: "approved" }> }) {
  if (gate.status === "pending") {
    return (
      <div role="status" className="my-auto flex w-full max-w-md flex-col items-center pb-5 text-center">
        <WaitingDots />
        <h1 className="text-[clamp(1.6rem,4vw,2.25rem)] leading-tight font-bold text-balance">Waiting for the organizer to approve this device</h1>
        <p className="mt-3 text-lg text-powder text-balance">
          Show or read this code to the organizer. Scoring opens on this device once they approve it.
        </p>
        <p className="tabular mt-6 rounded-2xl bg-oxford px-8 py-4 text-6xl font-bold tracking-[0.25em]">
          <span className="sr-only">Pairing code </span>
          <span className="-mr-[0.25em]">{gate.pairingCode}</span>
        </p>
        <p className="mt-3 text-sm text-powder">This device: {gate.label}</p>
      </div>
    );
  }
  return (
    <div role="status" className="my-auto flex w-full max-w-md flex-col items-center pb-5 text-center">
      <h1 className="text-[clamp(1.6rem,4vw,2.25rem)] leading-tight font-bold text-balance">This device isn&apos;t approved</h1>
      <p className="mt-3 text-lg text-powder text-balance">
        The organizer signed this device out or approved a different one for you. If this is the device you&apos;re judging on, ask for approval
        again.
      </p>
      <form action={requestApproval} className="mt-6">
        <button className="btn h-14 rounded-xl bg-mint px-6 text-lg text-prussian hover:bg-white">Ask for approval again</button>
      </form>
    </div>
  );
}

function WaitingCard({
  view,
  judge,
  activity,
  round,
  scoredCount,
  entryCount,
  movesEntries,
  offPanel,
  correction,
  points,
}: {
  view: Exclude<JudgeView, { kind: "scoring" }>;
  /** Under a submitted score: asking for a correction, or how one stands (null before migration 019). */
  correction?: React.ReactNode;
  /** With criteria, the points behind the submitted score, when this screen has them. */
  points: CriterionPoints[] | null;
  judge: Judge;
  activity: Activity;
  round: Props["round"];
  /** The sub-activity on screen has its own judges. */
  offPanel: boolean;
  scoredCount: number;
  entryCount: number;
  /** The chair shows the next entry themselves, so they aren't told to wait. */
  movesEntries: boolean;
}) {
  const firstName = judge.name.split(" ").find((w) => !/\.$/.test(w)) ?? judge.name;
  const copy: Record<typeof view.kind, { title: string; body: string }> = {
    "not-started": { title: "Waiting for the organizer to start", body: "Your screen opens by itself when judging begins. Keep this page open." },
    waiting: {
      title: scoredCount ? "Waiting for the next entry" : "Waiting for the first entry",
      body: "The organizer will show the entry to score. It appears here by itself.",
    },
    scored: { title: "Waiting for the next entry", body: "Your score is in. The organizer will show the next entry when every judge is ready." },
    ended: { title: "Judging has ended", body: `Thank you, ${firstName}. You scored ${scoredCount} of ${entryCount} ${entryCount === 1 ? "entry" : "entries"}.` },
  };
  const tabulatorCopy: Partial<typeof copy> = {
    waiting: {
      title: scoredCount ? "Ready for the next entry" : "Ready for the first entry",
      body: "Show it below when the contestant is ready.",
    },
    scored: { title: "Your score is in", body: "Show the next entry below once every judge has scored." },
  };
  // A pageant between sub-activities: nothing to score until the organizer starts the next one.
  const betweenRounds = activity.kind === "pageant" && !round && view.kind === "waiting";
  const { title, body } = offPanel
    ? { title: "Waiting for your part of the pageant", body: `${round?.name ?? "This part"} has its own judges. Your screen opens by itself when it's your turn.` }
    : betweenRounds
      ? { title: "Waiting for the next part of the pageant", body: "The organizer will start it. It appears here by itself." }
      : ((movesEntries ? tabulatorCopy[view.kind] : undefined) ?? copy[view.kind]);

  const submitted = correction ?? <p className="mt-2 text-sm text-powder">Submitted. Scores can&apos;t be changed after submitting.</p>;

  // The chair, scored: their score kept short, so the controls to move on come straight after it.
  if (view.kind === "scored" && movesEntries && !offPanel) {
    return (
      <div role="status" className="w-full text-left">
        <h1 className="text-2xl leading-tight font-bold">{title}</h1>
        <div className="mt-4 rounded-2xl border-2 border-oxford px-5 py-4">
          {/* The score beside the name where there's room; under it, on the right, where there isn't. */}
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            {view.entry.photoUrl && <Avatar name={view.entry.name} src={view.entry.photoUrl} size={48} square className="rounded-lg" />}
            <p className="min-w-36 flex-1 text-powder">
              No. {view.number} <span className="font-semibold text-mint">{view.entry.name}</span>
            </p>
            <ScoreFigure value={view.value} activity={activity} className="ml-auto text-4xl" />
          </div>
          {points && <PointsList points={points} decimals={activity.decimals} />}
          {submitted}
        </div>
      </div>
    );
  }
  return (
    <div role="status" className="flex w-full flex-col items-center text-center">
      {view.kind === "scored" && (
        <div className="mb-8 w-full rounded-2xl border-2 border-oxford px-6 py-7">
          <div className="flex items-center justify-center gap-3">
            {view.entry.photoUrl && <Avatar name={view.entry.name} src={view.entry.photoUrl} size={40} square className="rounded-lg" />}
            <p className="text-powder">
              No. {view.number} {view.entry.name}
            </p>
          </div>
          <ScoreFigure value={view.value} activity={activity} className="mt-2 block text-6xl" />
          {points && <PointsList points={points} decimals={activity.decimals} centered />}
          {submitted}
        </div>
      )}
      {view.kind !== "ended" && (!movesEntries || betweenRounds || offPanel) && <WaitingDots />}
      <h1 className="text-[clamp(1.6rem,4vw,2.25rem)] leading-tight font-bold text-balance">{title}</h1>
      <p className="mt-3 text-lg text-powder text-balance">{body}</p>
    </div>
  );
}

/** A criterion's points in a submitted score. */
type CriterionPoints = { id: string; name: string; points: number; max: number };

/** The judge's submitted score, large; with criteria, "/ 100" smaller beside it. */
function ScoreFigure({ value, activity, className = "" }: { value: number; activity: Activity; className?: string }) {
  return (
    <span className={`tabular font-bold ${className}`}>
      {formatScore(value, activity.decimals)}
      {activity.scoringMode === "criteria" && <span className="ml-1.5 text-lg font-semibold text-powder">/ 100</span>}
    </span>
  );
}

/** Under a submitted criteria score: what each criterion got, to compare entries by. */
function PointsList({ points, decimals, centered = false }: { points: CriterionPoints[]; decimals: Activity["decimals"]; centered?: boolean }) {
  return (
    <ul aria-label="Your points for each criterion" className={`mt-3 space-y-0.5 text-left text-sm ${centered ? "mx-auto max-w-xs" : ""}`}>
      {points.map((p) => (
        <li key={p.id} className="flex items-baseline gap-3">
          <span className="min-w-0 flex-1 truncate text-powder">{p.name}</span>
          <span className="tabular font-semibold">{formatScore(p.points, decimals)}</span>
          <span className="tabular w-10 text-right text-powder">/ {formatBound(p.max)}</span>
        </li>
      ))}
    </ul>
  );
}

/**
 * The chair of the board of judges gets the organizer's Previous and Next entry controls on their own screen, right
 * under their score: how many have scored, the buttons, then who has. Shown once they've scored the entry on screen (or
 * before the first entry).
 */
function EntryControls({ activity, entries, panel }: { activity: Activity; entries: Entry[]; panel: PanelJudge[] }) {
  const { entry, previous, next } = entryNeighbors(entries, activity.currentEntryId);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const scored = panel.filter((j) => j.scored).length;
  const allIn = entry !== null && panel.length > 0 && scored === panel.length;
  const waiting = panel.filter((j) => !j.scored);

  const go = (entryId: string) =>
    startTransition(async () => {
      setError(null);
      const result = await moveToEntry(entryId).catch(() => ({ ok: false as const, error: "That didn't go through. Check your connection and try again." }));
      if (!result.ok) setError(result.error);
    });

  return (
    <section aria-labelledby="move-entries" className="mt-5 w-full rounded-2xl border-2 border-oxford p-5 text-left">
      <h2 id="move-entries" className="font-semibold text-powder">
        Chair of the board of judges
      </h2>
      <p role="status" className="mt-2 font-semibold">
        {!entry
          ? "No entry on screen yet."
          : allIn
            ? next
              ? `Every judge has scored ${entry.name}.`
              : `Every judge has scored ${entry.name}. That was the last entry.`
            : `${scored} of ${panel.length} judges have scored.`}
      </p>
      <div className="mt-4 grid grid-cols-[auto_1fr] gap-3">
        <button
          type="button"
          onClick={() => previous && go(previous.id)}
          disabled={!previous || pending}
          className="btn h-14 rounded-xl border border-oxford px-5 text-lg text-mint hover:bg-oxford disabled:opacity-40"
        >
          Previous
        </button>
        {entry && next && waiting.length > 0 ? (
          // As on the organizer's desk: moving on with judges still scoring asks first.
          <ConfirmDialog
            triggerLabel={<span className="truncate">Next: {next.name}</span>}
            triggerClassName="btn h-14 min-w-0 rounded-xl border border-oxford text-lg text-mint hover:bg-oxford disabled:bg-oxford disabled:text-powder disabled:opacity-100"
            triggerDisabled={pending}
            title={`Move on to ${next.name}?`}
            confirmLabel="Move on anyway"
            onConfirm={() => moveToEntry(next.id).catch(() => ({ ok: false as const, error: "That didn't go through. Check your connection and try again." }))}
          >
            {listNames(waiting)} {waiting.length === 1 ? "hasn't" : "haven't"} scored {entry.name} yet. Their screen will move to {next.name}, and you can
            come back to {entry.name} later.
          </ConfirmDialog>
        ) : (
          <button
            type="button"
            onClick={() => next && go(next.id)}
            disabled={!next || pending}
            className={`btn h-14 min-w-0 rounded-xl text-lg ${
              allIn || !entry ? "bg-mint text-prussian hover:bg-white" : "border border-oxford text-mint hover:bg-oxford"
            } disabled:bg-oxford disabled:text-powder disabled:opacity-100`}
          >
            <span className="truncate">{entry ? (next ? `Next: ${next.name}` : "No more entries") : next ? `Show first entry: ${next.name}` : "No entries"}</span>
          </button>
        )}
      </div>
      {error && (
        <p role="alert" className={`mt-3 text-sm font-semibold ${ERROR_TEXT}`}>
          {error}
        </p>
      )}
      {entry && (
        <ul className="mt-4 space-y-1.5" aria-label={`Who has scored ${entry.name}`}>
          {panel.map((j) => (
            <li key={j.id} className="flex items-center gap-3 rounded-xl bg-oxford px-3 py-2">
              <Avatar name={j.name} src={j.photoUrl} size={32} />
              <span className="min-w-0 flex-1 truncate font-semibold">{j.name}</span>
              {j.scored ? (
                <span className="flex items-center gap-1.5 text-sm font-semibold">
                  <svg viewBox="0 0 16 16" className="size-4" aria-hidden>
                    <path d="M3 8.5l3 3 7-7" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                  Scored
                </span>
              ) : (
                <span className="text-sm text-powder">Waiting</span>
              )}
            </li>
          ))}
        </ul>
      )}
      <p className="mt-3 text-sm text-powder">The organizer can move entries too.</p>
    </section>
  );
}

// Keypads -----------------------------------------------------------------------------

/** Digits, decimal point and backspace, sized for thumbs. Dimmed and still while a score waits out its undo window. */
function KeypadGrid({ decimals, onPress, disabled = false }: { decimals: number; onPress: (key: Key) => void; disabled?: boolean }) {
  return (
    <div className="mt-3 grid grid-cols-3 gap-2.5 sm:gap-3 md:mt-4">
      {DIGITS.map((d) => (
        <KeypadKey key={d} onPress={() => onPress(d)} label={d} disabled={disabled} />
      ))}
      {decimals > 0 ? <KeypadKey onPress={() => onPress(".")} label="." ariaLabel="Decimal point" disabled={disabled} /> : <span />}
      <KeypadKey onPress={() => onPress("0")} label="0" disabled={disabled} />
      <KeypadKey
        onPress={() => onPress("back")}
        ariaLabel="Delete last digit"
        disabled={disabled}
        label={
          <svg viewBox="0 0 24 24" className="mx-auto size-8" aria-hidden>
            <path
              d="M9 5h11a1 1 0 011 1v12a1 1 0 01-1 1H9l-6-7 6-7zM12.5 9.5l5 5m0-5l-5 5"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinejoin="round"
              strokeLinecap="round"
            />
          </svg>
        }
      />
    </div>
  );
}

function KeypadKey({ label, onPress, ariaLabel, disabled = false }: { label: React.ReactNode; onPress: () => void; ariaLabel?: string; disabled?: boolean }) {
  return (
    <button
      type="button"
      onClick={onPress}
      aria-label={ariaLabel}
      disabled={disabled}
      className="tabular h-[clamp(2.75rem,6.5vh,5.5rem)] rounded-2xl bg-oxford disabled:pointer-events-none disabled:opacity-40 md:h-[clamp(3.25rem,8.5vh,5.5rem)] text-[clamp(1.75rem,4.5vh,2.5rem)] font-semibold text-mint transition-colors select-none hover:bg-regal active:scale-[0.97] active:bg-regal"
    >
      {label}
    </button>
  );
}

/**
 * Physical keyboard support: digits, point, Backspace, Escape to clear, Enter for the main button. Enter and Space on a
 * focused button (a keypad key, a criterion) press that button, as they do anywhere else. Nothing reaches the keypad
 * while a dialog is open over it: its own confirmation, a correction vote, signing out.
 */
function useKeypadKeys(press: (key: Key) => void, enter: () => void) {
  const onKey = useEffectEvent((e: KeyboardEvent) => {
    if (document.querySelector("dialog[open]") || e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.target instanceof HTMLElement && e.target.closest("input, textarea")) return;
    if ((e.key === "Enter" || e.key === " ") && e.target instanceof HTMLElement && e.target.closest("button, a, summary")) return;
    if (/^[0-9]$/.test(e.key)) press(e.key as Key);
    else if (e.key === "." || e.key === ",") press(".");
    else if (e.key === "Backspace") press("back");
    else if (e.key === "Escape" || e.key === "Delete") press("clear");
    else if (e.key === "Enter") enter();
    else return;
    e.preventDefault();
  });
  useEffect(() => {
    const listener = (e: KeyboardEvent) => onKey(e);
    window.addEventListener("keydown", listener);
    return () => window.removeEventListener("keydown", listener);
  }, []);
}

function ConfirmScore({
  dialogRef,
  entry,
  onConfirm,
  title = `Submit this score for ${entry.name}?`,
  note = `You'll have ${SCORE_UNDO_MS / 1000} seconds to undo before it goes in. Then it's final.`,
  confirmLabel = "Submit",
  confirmDisabled = false,
  children,
}: {
  dialogRef: React.RefObject<HTMLDialogElement | null>;
  entry: Entry;
  onConfirm: () => void;
  title?: string;
  note?: string;
  confirmLabel?: string;
  confirmDisabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <dialog
      ref={dialogRef}
      aria-labelledby="confirm-title"
      className="m-auto w-[min(26rem,calc(100vw-2rem))] rounded-3xl bg-mint p-0 text-prussian shadow-2xl"
    >
      <div className="px-6 pt-7 pb-6 text-center">
        <h2 id="confirm-title" className="text-lg font-semibold">
          {title}
        </h2>
        {children}
        <p className="mt-3 text-prussian/75">{note}</p>
      </div>
      <div className="grid grid-cols-2 gap-3 px-6 pb-6">
        <button type="button" className="btn btn-quiet h-14 rounded-xl text-lg" onClick={() => dialogRef.current?.close()} autoFocus>
          Go back
        </button>
        <button type="button" className="btn btn-primary h-14 rounded-xl text-lg" onClick={onConfirm} disabled={confirmDisabled}>
          {confirmLabel}
        </button>
      </div>
    </dialog>
  );
}

/**
 * Correcting a submitted score: what was given (with criteria, each criterion's points, which the keypad starts from),
 * whether other judges or the organizer decide, and what to do once it's asked for or cancelled.
 */
type Correcting = { from: number; fromBreakdown: Record<string, number> | null; othersVote: boolean; onDone: () => void };

/** Sending a correction request from the confirmation: the reason, whether it's on its way, and why it didn't go. */
function useCorrectionRequest(entry: Entry, correcting: Correcting | undefined, dialogRef: React.RefObject<HTMLDialogElement | null>) {
  const [reason, setReason] = useState("");
  const [asking, setAsking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ask = async (typed: string | Record<string, string>) => {
    if (!correcting || asking) return;
    setAsking(true);
    setError(null);
    const result = await requestCorrection(entry.id, typed, reason).catch(() => ({ ok: false as const, error: "That didn't go through. Check your connection and try again." }));
    setAsking(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    dialogRef.current?.close();
    correcting.onDone();
  };
  const dialog = correcting
    ? {
        title: `Ask to change your score for ${entry.name}?`,
        note: correcting.othersVote
          ? "Every other judge has to agree before it changes. They'll see your score, this one and your reason."
          : "The organizer has to approve it before it changes.",
        confirmLabel: asking ? "Asking…" : correcting.othersVote ? "Ask the judges" : "Ask the organizer",
        confirmDisabled: asking || !reason.trim(),
      }
    : {};
  return { reason, setReason, error, ask, dialog };
}

/** The reason a correction is asked for, required: the other judges decide on it. */
function ReasonField({ value, onChange, error }: { value: string; onChange: (value: string) => void; error: string | null }) {
  const id = useId();
  return (
    <div className="mt-4 text-left">
      <label htmlFor={id} className="text-sm font-semibold">
        Why does it need correcting?
      </label>
      <textarea
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        maxLength={MAX_CORRECTION_REASON}
        rows={2}
        required
        placeholder="e.g. I typed 59 instead of 95."
        className="mt-1 w-full resize-none rounded-xl border border-powder bg-white px-3 py-2 text-[15px] leading-relaxed text-prussian placeholder:text-prussian/70"
      />
      {error && (
        <p role="alert" className="mt-2 text-sm font-semibold text-danger">
          {error}
        </p>
      )}
    </div>
  );
}

/** The score before and after, large. */
function FromTo({ from, to }: { from: string; to: string }) {
  return (
    <p className="tabular mt-3 flex items-baseline justify-center gap-3">
      <span className="text-3xl font-bold text-prussian/60">{from}</span>
      <span aria-hidden className="text-2xl text-prussian/60">
        →
      </span>
      <span className="sr-only">to</span>
      <span className="text-5xl font-bold text-regal">{to}</span>
    </p>
  );
}

/** The entry's photo, when it has one, beside its heading: the judge sees who's on stage, as the LED wall does. */
function EntryTitle({ entry, children }: { entry: Entry; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-3 sm:gap-4">
      {entry.photoUrl && <Avatar name={entry.name} src={entry.photoUrl} size={64} square className="rounded-xl" />}
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}

/** Above the keypad: the entry being judged, or the one whose score is being corrected (with Cancel). */
function KeypadHeading({ number, correcting }: { number: number; correcting?: Correcting }) {
  if (!correcting) return <p className="text-powder">Now judging: No. {number}</p>;
  return (
    <div className="flex items-center justify-between gap-3">
      <p className="font-semibold text-powder">Correcting your score: No. {number}</p>
      <button type="button" onClick={correcting.onDone} className="btn btn-sm border border-oxford text-powder hover:bg-oxford hover:text-mint">
        Cancel
      </button>
    </div>
  );
}

type KeypadProps = {
  activity: Activity;
  entry: Entry;
  number: number;
  /** Correcting the judge's submitted score rather than scoring: asks the other judges (or the organizer) instead of submitting. */
  correcting?: Correcting;
  /** The judge's notes on this entry, under its name (phones and narrow tablets). */
  notes?: React.ReactNode;
  submission: Submission;
  /** A pageant sub-activity's timer bar, above the entry. */
  timer?: React.ReactNode;
  /** The timer has run out: no submitting until the organizer reopens scoring. */
  closed?: boolean;
};

/** The keypad's main button: Submit score, Next criterion, Review correction. */
const PRIMARY =
  "btn mt-3 h-[clamp(3.25rem,7vh,4.5rem)] w-full rounded-2xl bg-mint text-xl text-prussian hover:bg-white disabled:bg-oxford disabled:text-powder disabled:opacity-100 md:mt-4 md:h-[clamp(3.5rem,8vh,4.5rem)]";

const TIME_UP = "Time's up, so scoring has closed. Ask the organizer to reopen it.";

/** Simple scoring: one score between min and max. */
function Keypad({ activity, entry, number, notes, submission, timer, closed = false, correcting }: KeypadProps) {
  const [buffer, setBuffer] = useState("");
  const [error, setError] = useState<string | null>(null);
  // While the score waits out its undo window (or is on its way), the keypad holds still; Undo brings it back as it was.
  const { busy } = submission;
  const dialogRef = useRef<HTMLDialogElement>(null);

  const press = (key: Key) => {
    if (busy) return;
    setError(null);
    const typed = applyKey(buffer, key, activity);
    setBuffer(typed);
    submission.typing(typed !== "");
  };
  const review = () => {
    if (busy) return;
    if (closed) {
      setError(TIME_UP);
      return;
    }
    const parsed = parseScore(buffer, activity);
    if (!parsed.ok) setError(parsed.error);
    else dialogRef.current?.showModal();
  };
  const request = useCorrectionRequest(entry, correcting, dialogRef);
  const confirm = () => {
    const parsed = parseScore(buffer, activity);
    if (busy || !parsed.ok) return;
    if (correcting) {
      void request.ask(buffer);
      return;
    }
    dialogRef.current?.close();
    setError(null);
    submission.submit(entry, buffer, parsed.value);
  };
  useKeypadKeys(press, review);

  const decimalsHint = activity.decimals === 0 ? "whole numbers only" : `up to ${activity.decimals} decimal place${activity.decimals > 1 ? "s" : ""}`;
  const typed = parseScore(buffer, activity);
  // Told as soon as it happens: no more typing can bring a score back under the max.
  const tooHigh = overMax(buffer, activity);
  const message = error ?? submission.error ?? (tooHigh ? overMaxMessage(buffer, activity) : null);

  return (
    <div className="flex w-full max-w-md flex-col max-md:flex-1 lg:max-w-lg">
      {timer}
      <EntryTitle entry={entry}>
        <KeypadHeading number={number} correcting={correcting} />
        <h1 className="text-[clamp(1.6rem,4vw,2.5rem)] leading-tight font-bold text-balance">{entry.name}</h1>
      </EntryTitle>
      {notes}

      <div className={DOCK}>
        <div className={`flex items-center rounded-2xl bg-oxford px-5 py-3 ${tooHigh ? ERROR_RING : ""}`} aria-live="polite">
          <output
            aria-label="Score"
            aria-describedby="score-hint"
            className={`tabular flex-1 text-[clamp(2.75rem,8vh,5rem)] leading-none font-bold md:text-[clamp(3.25rem,10vh,5rem)] ${tooHigh ? ERROR_TEXT : buffer ? "" : "text-powder/40"}`}
          >
            {buffer || (
              <>
                <span aria-hidden className="inline-block h-[0.85em] w-[3px] translate-y-[0.08em] animate-pulse rounded-full motion-reduce:animate-none bg-powder/70" />
                <span className="sr-only">No score typed yet</span>
              </>
            )}
          </output>
          {buffer && (
            <button type="button" onClick={() => press("clear")} className="btn btn-sm text-powder hover:text-mint">
              Clear
            </button>
          )}
        </div>
        <p id="score-hint" className={`mt-2 text-sm ${message ? `font-semibold ${ERROR_TEXT}` : "text-powder"}`} role={message ? "alert" : undefined}>
          {message ? (
            <>
              <WarningIcon />
              {message}
              {tooHigh && !error && " Clear it and type a lower score."}
            </>
          ) : (
            `Score from ${rangeLabel(activity)}, ${decimalsHint}.${correcting ? ` You gave ${formatScore(correcting.from, activity.decimals)}.` : ""}`
          )}
        </p>

        <KeypadGrid decimals={activity.decimals} onPress={press} disabled={busy} />

        <button
          type="button"
          onClick={review}
          disabled={!typed.ok || busy || closed}
          className={PRIMARY}
        >
          {correcting ? "Review correction" : "Submit score"}
        </button>
      </div>

      <ConfirmScore dialogRef={dialogRef} entry={entry} onConfirm={confirm} {...request.dialog}>
        {correcting ? (
          <>
            <FromTo from={formatScore(correcting.from, activity.decimals)} to={typed.ok ? formatScore(typed.value, activity.decimals) : buffer} />
            <ReasonField value={request.reason} onChange={request.setReason} error={request.error} />
          </>
        ) : (
          <>
            <p className="tabular mt-3 text-7xl font-bold text-regal">{typed.ok ? formatScore(typed.value, activity.decimals) : buffer}</p>
            <p className="text-sm text-prussian/75">out of {formatBound(activity.max)}</p>
          </>
        )}
      </ConfirmScore>
    </div>
  );
}

/** Criteria scoring: points for each criterion on the same keypad, totalling up to 100. */
function CriteriaKeypad({ activity, entry, number, notes, submission, timer, closed = false, correcting }: KeypadProps) {
  const { criteria, decimals } = activity;
  const given = correcting?.fromBreakdown ?? null;
  // The points given, as the judge would type them ("33", "24.5"), so they read the same as anything typed over them.
  const givenText = (id: string) => (given?.[id] === undefined ? "" : String(Number(formatScore(given[id], decimals))));
  // A correction starts from the points given; the first key on a criterion replaces its old value.
  const [values, setValues] = useState<Record<string, string>>(() => (given ? Object.fromEntries(criteria.map((c) => [c.id, givenText(c.id)])) : {}));
  const [untouched, setUntouched] = useState<Set<string>>(() => new Set(given ? criteria.map((c) => c.id) : []));
  // Whether a criterion still has the points it was given: compared as numbers, so "33" and "33.0" are the same.
  const unchanged = (id: string) => given?.[id] !== undefined && /\d/.test(values[id] ?? "") && Number(values[id]) === given[id];
  const [activeId, setActiveId] = useState(criteria[0]?.id ?? "");
  const [error, setError] = useState<string | null>(null);
  const { busy } = submission;
  const dialogRef = useRef<HTMLDialogElement>(null);
  // Bumped each time the confirmation opens, so its criteria light up again.
  const [reviews, setReviews] = useState(0);
  // The active criterion's guide: remembered on this device once the judge opens or closes it. Until then it starts
  // open where there's room, and closed on a phone, where it would push the criteria away from the keypad.
  const [guideChoice, setGuideOpen] = useDeviceSetting<boolean | null>("livescoring:criterion-guide-open", null);
  const roomy = useMediaQuery("(min-width: 768px)", true);
  const guideOpen = guideChoice ?? roomy;

  const active = criteria.find((c) => c.id === activeId) ?? criteria[0];
  // From the criterion's lowest score (if the score sheet sets one) to its points.
  const rulesFor = (c: Criterion) => criterionRules(c, decimals);
  const isValid = (id: string) => {
    const c = criteria.find((x) => x.id === id);
    return !!c && parseScore(values[id] ?? "", rulesFor(c)).ok;
  };
  const activeIndex = criteria.indexOf(active);
  const nextMissing = [...criteria.slice(activeIndex + 1), ...criteria.slice(0, activeIndex)].find((c) => !isValid(c.id));
  const all = parseBreakdown(values, criteria, decimals);

  const press = (key: Key) => {
    if (busy || !active) return;
    setError(null);
    const fresh = untouched.has(active.id);
    if (fresh) setUntouched((u) => new Set([...u].filter((id) => id !== active.id)));
    const typed = { ...values, [active.id]: applyKey(fresh ? "" : (values[active.id] ?? ""), key, rulesFor(active)) };
    setValues(typed);
    submission.typing(Object.values(typed).some(Boolean));
  };
  const primary = () => {
    if (busy) return;
    if (all.ok && closed && !correcting) {
      setError(TIME_UP);
      return;
    }
    if (all.ok) {
      setReviews((n) => n + 1);
      dialogRef.current?.showModal();
      return;
    }
    const parsed = parseScore(values[active.id] ?? "", rulesFor(active));
    if (!parsed.ok) setError(`${active.name}: ${parsed.error}`);
    else if (nextMissing) setActiveId(nextMissing.id);
  };
  const request = useCorrectionRequest(entry, correcting, dialogRef);
  const confirm = () => {
    if (busy || !all.ok) return;
    if (correcting) {
      void request.ask(values);
      return;
    }
    dialogRef.current?.close();
    setError(null);
    submission.submit(entry, values, all.total);
  };
  useKeypadKeys(press, primary);

  const runningTotal = criteria.reduce((sum, c) => {
    const parsed = parseScore(values[c.id] ?? "", rulesFor(c));
    return parsed.ok ? sum + Math.round(parsed.value * 100) : sum;
  }, 0);
  const typedActive = values[active?.id ?? ""] ?? "";
  const tooHigh = (c: { id: string; max: number }) => overMax(values[c.id] ?? "", c);
  const activeTooHigh = !!active && tooHigh(active);
  const message = error ?? submission.error ?? (active && activeTooHigh ? `${active.name}: ${overMaxMessage(typedActive, active)}` : null);
  const overCount = criteria.filter(tooHigh).length;
  // Under the score sheet's lowest score: not an error while it's being typed (another digit may bring it up), but the
  // judge is told why they can't move on; a criterion left that way is marked, like one above its maximum.
  const tooLow = (c: Criterion) => !!c.min && /^\d+(\.\d*)?$/.test(values[c.id] ?? "") && Number(values[c.id]) < c.min;
  const belowLowest = !!active && tooLow(active);

  return (
    // One column, its keypad held at the bottom; from 1024px, the entry and its criteria beside the keypad instead.
    <div className="flex w-full max-w-md flex-col max-md:flex-1 lg:grid lg:max-w-4xl lg:grid-cols-2 lg:items-start lg:gap-x-10">
      <div className="min-w-0">
        {timer}
        <EntryTitle entry={entry}>
          <KeypadHeading number={number} correcting={correcting} />
          <h1 className="text-[clamp(1.5rem,3.6vw,2.25rem)] leading-tight font-bold text-balance">{entry.name}</h1>
        </EntryTitle>
        {notes}

        <ul className="mt-3 space-y-1.5" aria-label="Criteria">
          {criteria.map((c) => {
            const isActive = c.id === active?.id;
            const value = values[c.id];
            const over = tooHigh(c);
            const low = !isActive && tooLow(c);
            return (
              <li key={c.id}>
                <button
                  type="button"
                  onClick={() => setActiveId(c.id)}
                  aria-pressed={isActive}
                  className={`flex w-full items-center gap-3 rounded-xl px-4 py-2.5 text-left transition-colors ${
                    over || low
                      ? `${isActive ? "bg-regal" : "bg-oxford"} ${ERROR_RING}`
                      : isActive
                        ? "bg-regal ring-2 ring-powder"
                        : "bg-oxford hover:bg-regal/60"
                  }`}
                >
                  <span className="min-w-0 flex-1 truncate font-semibold">
                    {c.name}
                    {c.guide && <span className="sr-only">, has a guide</span>}
                  </span>
                  {c.guide && <GuideIcon className={isActive ? "text-mint/80" : "text-powder"} />}
                  {over && <span className={`text-sm font-semibold ${ERROR_TEXT}`}>Too high</span>}
                  {low && <span className={`text-sm font-semibold ${ERROR_TEXT}`}>Too low</span>}
                  {given && !unchanged(c.id) && <span className={`tabular text-sm ${isActive ? "text-mint/80" : "text-powder"}`}>was {givenText(c.id) || "–"}</span>}
                  {/* Light blue reads on the unselected rows; on the selected (brighter) one, the text colour does. */}
                  <span className={`tabular text-lg font-bold ${over || low ? ERROR_TEXT : ""}`}>
                    {value || <span className={isActive ? "text-mint/70" : "text-powder"}>–</span>}
                  </span>
                  <span className={`tabular w-12 text-right text-sm ${isActive ? "text-mint/80" : "text-powder"}`}>/ {formatBound(c.max)}</span>
                </button>
              </li>
            );
          })}
        </ul>
        <p className="tabular mt-2 flex justify-between text-sm text-powder">
          <span>Total</span>
          <span>
            <span className="font-bold text-mint">{formatScore(runningTotal / 100, decimals)}</span> / 100
          </span>
        </p>
      </div>

      <div className={`${DOCK} lg:static lg:bg-none lg:pt-0 lg:pb-5`}>
        {active?.guide && (
          <div className="rounded-xl border border-oxford">
            <button
              type="button"
              aria-expanded={guideOpen}
              aria-controls="criterion-guide"
              onClick={() => setGuideOpen(!guideOpen)}
              className="flex w-full items-center gap-2 rounded-xl px-4 py-2.5 text-left text-sm font-semibold text-powder hover:text-mint pointer-coarse:min-h-11"
            >
              <GuideIcon />
              <span className="min-w-0 flex-1 truncate">Guide for {active.name}</span>
              <svg viewBox="0 0 16 16" className={`size-4 shrink-0 transition-transform ${guideOpen ? "rotate-180" : ""}`} aria-hidden>
                <path d="M4 6l4 4 4-4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
            {guideOpen && (
              <p id="criterion-guide" className="max-h-40 overflow-y-auto px-4 pb-3 text-[15px] leading-relaxed whitespace-pre-line text-mint/90">
                {active.guide}
              </p>
            )}
          </div>
        )}

        {active && (
          <div className={`flex items-center rounded-2xl bg-oxford px-5 py-2.5 ${active.guide ? "mt-3" : ""} ${activeTooHigh ? ERROR_RING : ""}`} aria-live="polite">
            <span className="mr-3 max-w-[40%] truncate text-sm text-powder">{active.name}</span>
            <output
              aria-label={`${active.name} score`}
              aria-describedby={message ? "criteria-error" : undefined}
              className={`tabular flex-1 text-[clamp(2.25rem,6vh,4rem)] leading-none font-bold md:text-[clamp(2.5rem,7vh,4rem)] ${activeTooHigh ? ERROR_TEXT : typedActive ? "" : "text-powder/40"}`}
            >
              {typedActive || (
                <>
                  <span aria-hidden className="inline-block h-[0.85em] w-[3px] translate-y-[0.08em] animate-pulse rounded-full motion-reduce:animate-none bg-powder/70" />
                  <span className="sr-only">No score typed yet</span>
                </>
              )}
            </output>
            <span className="tabular shrink-0 text-right leading-tight whitespace-nowrap text-powder">
              <span className="block text-lg">/ {formatBound(active.max)}</span>
              {active.min ? <span className="block text-sm">lowest {formatBound(active.min)}</span> : null}
            </span>
          </div>
        )}
        {message ? (
          <p id="criteria-error" className={`mt-2 text-sm font-semibold ${ERROR_TEXT}`} role="alert">
            <WarningIcon />
            {message}
            {activeTooHigh && !error && " Delete it and type a lower score."}
          </p>
        ) : overCount > 0 ? (
          <p className={`mt-2 text-sm font-semibold ${ERROR_TEXT}`} role="alert">
            <WarningIcon />
            {overCount === 1 ? "One criterion is" : `${overCount} criteria are`} above the maximum. Tap {overCount === 1 ? "it" : "each one"} to fix it.
          </p>
        ) : (
          belowLowest && (
            <p role="status" className="mt-2 text-sm font-semibold text-mint">
              The lowest score for {active.name} is {formatBound(active.min!)}.
            </p>
          )
        )}

        <KeypadGrid decimals={decimals} onPress={press} disabled={busy} />

        <button
          type="button"
          onClick={primary}
          disabled={busy || (all.ok && closed && !correcting) || (!all.ok && !isValid(active?.id ?? ""))}
          className={PRIMARY}
        >
          {all.ok ? (correcting ? "Review correction" : "Submit score") : nextMissing ? `Next: ${nextMissing.name}` : "Submit score"}
        </button>
      </div>

      <ConfirmScore dialogRef={dialogRef} entry={entry} onConfirm={confirm} {...request.dialog}>
        {all.ok && correcting && (
          <>
            <FromTo from={formatScore(correcting.from, decimals)} to={formatScore(all.total, decimals)} />
            <p className="text-sm text-prussian/75">out of 100</p>
            <ol aria-label="Points for each criterion, before and after" className="mt-3 max-h-[min(16rem,35dvh)] space-y-1 overflow-y-auto text-left">
              {criteria.map((c) => {
                const now = formatScore(all.breakdown[c.id], decimals);
                const was = given?.[c.id] === undefined ? "–" : formatScore(given[c.id], decimals);
                const changed = now !== was;
                return (
                  <li key={c.id} className={`flex items-baseline gap-3 rounded-lg px-3 py-1.5 ${changed ? "bg-white font-semibold ring-1 ring-regal/40" : ""}`}>
                    <span className="min-w-0 flex-1">{c.name}</span>
                    <span className="tabular">
                      {changed ? (
                        <>
                          {was} <span aria-hidden>→</span>
                          <span className="sr-only"> to </span> {now}
                        </>
                      ) : (
                        now
                      )}
                    </span>
                  </li>
                );
              })}
            </ol>
            <ReasonField value={request.reason} onChange={request.setReason} error={request.error} />
          </>
        )}
        {all.ok && !correcting && (
          <>
            <p className="mt-1 text-sm font-semibold text-prussian/80">Check each criterion before you submit.</p>
            {/* Each criterion lights up in turn, so a slip in any one of them gets a look. */}
            <ol key={reviews} aria-label="Points for each criterion" className="mt-3 max-h-[min(22rem,45dvh)] space-y-1.5 overflow-y-auto text-left">
              {criteria.map((c, i) => {
                const points = all.breakdown[c.id];
                return (
                  <li key={c.id} className="check-in rounded-xl bg-white px-3 py-2 ring-1 ring-powder/60" style={{ animationDelay: `${i * 150}ms` }}>
                    <div className="flex items-baseline gap-3">
                      <span className="min-w-0 flex-1 font-semibold">{c.name}</span>
                      <span className="tabular text-2xl leading-none font-bold text-regal">{formatScore(points, decimals)}</span>
                      <span className="tabular w-11 text-right text-sm text-prussian/70">/ {formatBound(c.max)}</span>
                    </div>
                    <span aria-hidden className="mt-1.5 block h-1.5 overflow-hidden rounded-full bg-powder/30">
                      <span className="block h-full rounded-full bg-regal" style={{ width: `${(points / c.max) * 100}%` }} />
                    </span>
                  </li>
                );
              })}
            </ol>
            <p className="tabular mt-3 text-5xl font-bold text-regal">{formatScore(all.total, decimals)}</p>
            <p className="text-sm text-prussian/75">out of 100</p>
          </>
        )}
      </ConfirmScore>
    </div>
  );
}
