"use client";

import { useEffect, useEffectEvent, useId, useRef, useState, useTransition } from "react";
import { Avatar } from "@/components/avatar";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { LiveStatusBadge } from "@/components/live-status";
import { TimerBar, useScoringTimer } from "@/components/scoring-timer";
import { MAX_CORRECTION_REASON, type CorrectionView } from "@/lib/corrections";
import { entryNeighbors, judgeView, type JudgeView } from "@/lib/judging";
import { SCORE_UNDO_MS } from "@/lib/pageant";
import { applyKey, criterionRules, formatBound, formatScore, overMax, overMaxMessage, parseBreakdown, parseScore, rangeLabel, type Key } from "@/lib/scoring";
import type { Activity, Criterion, Entry, Judge } from "@/lib/types";
import { useDeviceSetting } from "@/lib/use-device-setting";
import { useLiveRefresh } from "@/lib/use-live-refresh";
import { leavePortal, moveToEntry, requestApproval, requestCorrection, submitScore, voteOnCorrection, withdrawCorrection } from "../actions";
import { NotesBeside, NotesInline, useWideScreen, type NoteStore } from "./entry-notes";

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
 * entry on screen, whether other judges (or, for a judge alone on their panel, the organizer) decide theirs, and the
 * points per criterion they gave the entry on screen, to start a correction from.
 */
export type Corrections = {
  toVote: CorrectionView[];
  mine: CorrectionView | null;
  othersVote: boolean;
  fromBreakdown: Record<string, number> | null;
};

/**
 * A score the judge has confirmed, waiting out its undo window before it goes to the server. `typed`: what the keypad
 * sends (the score, or each criterion's points). `sending`: the window is over and it's on its way.
 */
type PendingScore = { entry: Entry; typed: string | Record<string, string>; value: number; sending: boolean };
/** What a keypad needs to hand over a confirmed score, and to know whether one is waiting or failed. */
type Submission = {
  submit: (entry: Entry, typed: PendingScore["typed"], value: number) => void;
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

export function ScoringPanel({ activity, judge, entries, myScores, notes, corrections, gate, panel, round, serverNow, offPanel = false }: Props) {
  const pageant = activity.kind === "pageant";
  const status = useLiveRefresh(activity.id, { pollMs: gate.status === "pending" ? PENDING_POLL_MS : JUDGE_POLL_MS });
  // Scores confirmed by the server but not yet in the refreshed page, so the keypad doesn't flash back. Once the page
  // has a score, its value wins: a correction can change it.
  const [justSaved, setJustSaved] = useState<Map<string, number>>(() => new Map());
  const scores = new Map([...justSaved, ...myScores.map((s) => [s.entryId, s.value] as const)]);
  // Off the panel of the sub-activity on screen: nothing to score until their part comes up.
  const view: JudgeView = offPanel ? { kind: "waiting" } : judgeView(activity, entries, scores);
  const [saved, setSaved] = useState<{ name: string; value: string } | null>(null);
  const savedTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const approved = gate.status === "approved";

  const onSaved = (entry: Entry, value: number) => {
    setJustSaved((m) => new Map(m).set(entry.id, value));
    setSaved({ name: entry.name, value: myScoreText(value, activity) });
    clearTimeout(savedTimer.current);
    savedTimer.current = setTimeout(() => setSaved(null), 3500);
  };

  // A confirmed score waits SCORE_UNDO_MS before it's sent, so a slip can be undone. It lives here rather than in the
  // keypad, so it's still sent (and a failure still shown) if the organizer moves on meanwhile.
  const [pending, setPending] = useState<PendingScore | null>(null);
  const [failed, setFailed] = useState<{ entry: Entry; error: string } | null>(null);
  const send = useEffectEvent(async (score: PendingScore) => {
    setPending({ ...score, sending: true });
    const result = await submitScore(score.entry.id, score.typed).catch(() => ({ ok: false as const, error: NETWORK_ERROR }));
    setPending(null);
    if (result.ok) onSaved(score.entry, score.value);
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
  const submission = (entry: Entry): Submission => ({
    submit: (e, typed, value) => {
      setFailed(null);
      setPending({ entry: e, typed, value, sending: false });
    },
    busy: pending?.entry.id === entry.id,
    error: failed?.entry.id === entry.id ? failed.error : null,
  });

  const currentId = approved && (view.kind === "scoring" || view.kind === "scored") ? view.entry.id : null;
  // Correcting the score on screen: the keypad comes back, starting from what they gave.
  const [correctingFor, setCorrectingFor] = useState<string | null>(null);
  const correcting = corrections && view.kind === "scored" && correctingFor === view.entry.id;
  const idle: Submission = { submit: () => {}, busy: false, error: null };

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
            <p className="tabular text-powder">
              <span className="font-bold text-mint">{scores.size}</span>
              <span className="sm:hidden">/{entries.length}</span>
              <span className="hidden sm:inline"> of {entries.length} scored</span>
            </p>
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

      <div className="flex min-h-0 flex-1 flex-col md:flex-row">
        {approved && !offPanel && (
          <aside aria-label="Your scores" className="hidden shrink-0 border-oxford md:block md:w-72 md:overflow-y-auto md:border-r lg:w-80">
            <h2 className="px-6 pt-5 pb-2 text-sm font-semibold text-powder">Your scores{round && ` in ${round.name}`}</h2>
            <ol className="space-y-1 px-3 pb-4">
              {entries.map((entry, i) => {
                const value = scores.get(entry.id);
                const current = entry.id === currentId;
                return (
                  <li
                    key={entry.id}
                    aria-current={current ? "true" : undefined}
                    className={`flex items-center gap-3 rounded-xl px-3 py-3 ${current ? "bg-regal" : ""}`}
                  >
                    <span className={`tabular w-6 text-sm ${current ? "text-mint" : "text-powder"}`}>{entry.number ?? i + 1}</span>
                    <span className="min-w-0 flex-1 truncate font-semibold">
                      {entry.name}
                      {current && <span className="sr-only"> (now judging)</span>}
                    </span>
                    {value !== undefined ? (
                      <span className={`tabular text-sm font-semibold ${current ? "text-mint/80" : "text-powder"}`}>
                        {formatScore(value, activity.decimals)}
                      </span>
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
          </aside>
        )}

        <main className="flex min-h-0 flex-1 flex-col items-center overflow-y-auto px-4 py-5 sm:px-8 md:justify-center-safe">
          {saved && (
            <p
              role="status"
              className="toast-in fixed inset-x-4 top-3 z-10 mx-auto flex max-w-md items-center gap-2 rounded-xl bg-mint px-4 py-3.5 font-semibold text-prussian shadow-lg shadow-prussian/40"
            >
              <svg viewBox="0 0 16 16" className="size-5 shrink-0 text-regal" aria-hidden>
                <path d="M3 8.5l3 3 7-7" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              <span className="min-w-0 truncate">
                Saved <span className="tabular">{saved.value}</span> for {saved.name}
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
                fromBreakdown: corrections.fromBreakdown,
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
            <div className="my-auto flex w-full max-w-md flex-col items-center lg:max-w-lg">
              <WaitingCard
                view={view}
                judge={judge}
                activity={activity}
                round={round}
                scoredCount={scores.size}
                movesEntries={!!panel}
                offPanel={offPanel}
                correction={
                  corrections && view.kind === "scored" ? (
                    <CorrectionStatus mine={corrections.mine} othersVote={corrections.othersVote} onAsk={() => setCorrectingFor(view.entry.id)} />
                  ) : null
                }
              />
              {view.kind === "scored" && inlineNotes && <div className="mt-6 w-full">{inlineNotes}</div>}
              {panel && (view.kind === "waiting" || view.kind === "scored") && !(pageant && !round) && (
                <EntryControls activity={activity} entries={entries} panel={panel} />
              )}
            </div>
          )}
        </main>
        {noteStore && wide && <NotesBeside entry={noteEntry} notes={noteStore} />}
      </div>
      {pending && <UndoBar key={pending.entry.id} pending={pending} shown={myScoreText(pending.value, activity)} onUndo={() => setPending(null)} />}
      {/* Another judge's correction waits for this judge's vote: it can't be put off. */}
      {corrections && corrections.toVote.length > 0 && <CorrectionVote key={corrections.toVote[0].id} view={corrections.toVote[0]} />}
    </div>
  );
}

/**
 * Another judge asks to change their score: this judge sees the score, the new one and the reason, and agrees or
 * disagrees. It can't be closed without a vote (Escape reopens it), and the vote is final.
 */
function CorrectionVote({ view }: { view: CorrectionView }) {
  const ref = useRef<HTMLDialogElement>(null);
  // Focus starts on the question, so neither answer is one Enter away.
  const titleRef = useRef<HTMLHeadingElement>(null);
  const [pending, startTransition] = useTransition();
  const [voted, setVoted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!ref.current?.open) ref.current?.showModal();
    titleRef.current?.focus();
  }, []);
  const vote = (agree: boolean) =>
    startTransition(async () => {
      setError(null);
      const result = await voteOnCorrection(view.id, agree).catch(() => ({ ok: false as const, error: "Your vote didn't go through. Check your connection and try again." }));
      if (result.ok) setVoted(true);
      else setError(result.error);
    });
  const where = view.roundName ? ` in ${view.roundName}` : "";
  return (
    <dialog
      ref={ref}
      aria-labelledby="vote-title"
      aria-describedby="vote-rule"
      onCancel={(e) => e.preventDefault()}
      onClose={() => {
        if (!voted) ref.current?.showModal();
      }}
      className="m-auto max-h-[calc(100dvh-2rem)] w-[min(30rem,calc(100vw-2rem))] overflow-y-auto rounded-3xl bg-mint p-0 text-prussian shadow-2xl"
    >
      <div className="px-6 pt-6 pb-5">
        <p className="text-sm font-semibold text-regal">Score correction · your vote</p>
        <h2 id="vote-title" ref={titleRef} tabIndex={-1} className="mt-1 text-xl leading-snug font-bold text-balance focus:outline-none">
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
          It changes only if every other judge agrees; one disagreeing keeps the score as it is. Your vote is final.
        </p>
        {error && (
          <p role="alert" className="mt-3 font-semibold text-danger">
            {error}
          </p>
        )}
      </div>
      <div className="grid grid-cols-2 gap-3 px-6 pb-6">
        <button type="button" disabled={pending || voted} onClick={() => vote(false)} className="btn btn-quiet h-auto min-h-14 flex-col gap-0 rounded-xl py-2 text-lg">
          Disagree
          <span className="tabular text-sm font-normal">Keep {view.from}</span>
        </button>
        <button type="button" disabled={pending || voted} onClick={() => vote(true)} className="btn btn-primary h-auto min-h-14 flex-col gap-0 rounded-xl py-2 text-lg">
          {voted ? "Vote sent" : "Agree"}
          {!voted && <span className="tabular text-sm font-normal">Change to {view.to}</span>}
        </button>
      </div>
    </dialog>
  );
}

/**
 * Under a judge's submitted score: their correction waiting for votes (with Withdraw), how their last one ended, and
 * a way to ask for one.
 */
function CorrectionStatus({ mine, othersVote, onAsk }: { mine: CorrectionView | null; othersVote: boolean; onAsk: () => void }) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  if (mine?.status === "open") {
    return (
      <div className="mt-5 rounded-xl bg-oxford px-4 py-3 text-left">
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
          Withdraw it
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
    <div className="mt-5">
      {mine?.status === "approved" && (
        <p className="text-sm font-semibold">
          Corrected from <span className="tabular">{mine.from}</span>: {mine.decidedBy === "organizer" ? "the organizer approved it." : "every other judge agreed."}
        </p>
      )}
      {mine?.status === "rejected" && (
        <p className="text-sm text-powder">
          Your correction to <span className="tabular">{mine.to}</span> wasn&apos;t accepted{mine.decidedBy === "organizer" ? " by the organizer" : ": a judge disagreed"}, so
          this score stands.
        </p>
      )}
      <button type="button" onClick={onAsk} className="btn mt-3 border border-regal text-mint hover:bg-regal">
        Ask to correct this score
      </button>
    </div>
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
      <div role="status" className="my-auto flex w-full max-w-md flex-col items-center text-center">
        <WaitingDots />
        <h1 className="text-[clamp(1.6rem,4vw,2.25rem)] leading-tight font-bold text-balance">Waiting for the organizer to approve this device</h1>
        <p className="mt-3 text-lg text-powder text-balance">
          Show or read this code to the organizer. Scoring opens on this device once they approve it.
        </p>
        <p className="tabular mt-6 rounded-2xl bg-oxford px-8 py-4 text-6xl font-bold tracking-[0.25em]">
          <span className="sr-only">Pairing code </span>
          {gate.pairingCode}
        </p>
        <p className="mt-3 text-sm text-powder">{gate.label}</p>
      </div>
    );
  }
  return (
    <div role="status" className="my-auto flex w-full max-w-md flex-col items-center text-center">
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
  movesEntries,
  offPanel,
  correction,
}: {
  view: Exclude<JudgeView, { kind: "scoring" }>;
  /** Under a submitted score: asking for a correction, or how one stands (null before migration 019). */
  correction?: React.ReactNode;
  judge: Judge;
  activity: Activity;
  round: Props["round"];
  /** The sub-activity on screen has its own judges. */
  offPanel: boolean;
  scoredCount: number;
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
    ended: { title: "Judging has ended", body: `Thank you, ${firstName}. You scored ${scoredCount} ${scoredCount === 1 ? "entry" : "entries"}.` },
  };
  const tabulatorCopy: Partial<typeof copy> = {
    waiting: {
      title: scoredCount ? "Ready for the next entry" : "Ready for the first entry",
      body: "Show it below when the contestant is ready. The organizer can move entries too.",
    },
    scored: { title: "Your score is in", body: "Show the next entry below once every judge has scored. The organizer can move entries too." },
  };
  // A pageant between sub-activities: nothing to score until the organizer starts the next one.
  const betweenRounds = activity.kind === "pageant" && !round && view.kind === "waiting";
  const { title, body } = offPanel
    ? { title: "Waiting for your part of the pageant", body: `${round?.name ?? "This part"} has its own judges. Your screen opens by itself when it's your turn.` }
    : betweenRounds
      ? { title: "Waiting for the next part of the pageant", body: "The organizer will start it. It appears here by itself." }
      : ((movesEntries ? tabulatorCopy[view.kind] : undefined) ?? copy[view.kind]);

  return (
    <div role="status" className="flex w-full flex-col items-center text-center">
      {view.kind === "scored" && (
        <div className="mb-8 w-full rounded-2xl border-2 border-oxford px-6 py-7">
          <p className="text-powder">
            No. {view.number} {view.entry.name}
          </p>
          <p className="tabular mt-2 text-6xl font-bold">{myScoreText(view.value, activity)}</p>
          <p className="mt-2 text-sm text-powder">
            {correction ? "Submitted. If it's wrong, you can ask to correct it." : "Submitted. Scores can't be changed after submitting."}
          </p>
          {correction}
        </div>
      )}
      {view.kind !== "ended" && (!movesEntries || betweenRounds || offPanel) && <WaitingDots />}
      <h1 className="text-[clamp(1.6rem,4vw,2.25rem)] leading-tight font-bold text-balance">{title}</h1>
      <p className="mt-3 text-lg text-powder text-balance">{body}</p>
    </div>
  );
}

/**
 * The chair of the board of judges gets the organizer's Previous and Next entry controls on their own screen.
 * Shown once they've scored the entry on screen (or before the first entry), with who else has scored it.
 */
function EntryControls({ activity, entries, panel }: { activity: Activity; entries: Entry[]; panel: PanelJudge[] }) {
  const { entry, previous, next } = entryNeighbors(entries, activity.currentEntryId);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const scored = panel.filter((j) => j.scored).length;
  const allIn = entry !== null && panel.length > 0 && scored === panel.length;

  const go = (entryId: string) =>
    startTransition(async () => {
      setError(null);
      const result = await moveToEntry(entryId).catch(() => ({ ok: false as const, error: "That didn't go through. Check your connection and try again." }));
      if (!result.ok) setError(result.error);
    });

  return (
    <section aria-labelledby="move-entries" className="mt-8 w-full rounded-2xl border-2 border-oxford p-5 text-left">
      <h2 id="move-entries" className="font-semibold text-powder">
        Chair of the board of judges
      </h2>
      {entry && (
        <ul className="mt-3 space-y-1.5" aria-label={`Who has scored ${entry.name}`}>
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
      <p role="status" className="mt-3 font-semibold">
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
      </div>
      {error && (
        <p role="alert" className={`mt-3 text-sm font-semibold ${ERROR_TEXT}`}>
          {error}
        </p>
      )}
    </section>
  );
}

// Keypads -----------------------------------------------------------------------------

/** Digits, decimal point and backspace, sized for thumbs. */
function KeypadGrid({ decimals, onPress }: { decimals: number; onPress: (key: Key) => void }) {
  return (
    <div className="mt-4 grid grid-cols-3 gap-2.5 sm:gap-3">
      {DIGITS.map((d) => (
        <KeypadKey key={d} onPress={() => onPress(d)} label={d} />
      ))}
      {decimals > 0 ? <KeypadKey onPress={() => onPress(".")} label="." ariaLabel="Decimal point" /> : <span />}
      <KeypadKey onPress={() => onPress("0")} label="0" />
      <KeypadKey
        onPress={() => onPress("back")}
        ariaLabel="Delete last digit"
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

function KeypadKey({ label, onPress, ariaLabel }: { label: React.ReactNode; onPress: () => void; ariaLabel?: string }) {
  return (
    <button
      type="button"
      onClick={onPress}
      aria-label={ariaLabel}
      className="tabular h-[clamp(3.25rem,8.5vh,5.5rem)] rounded-2xl bg-oxford text-[clamp(1.75rem,4.5vh,2.5rem)] font-semibold text-mint transition-colors select-none hover:bg-regal active:scale-[0.97] active:bg-regal"
    >
      {label}
    </button>
  );
}

/**
 * Physical keyboard support: digits, point, Backspace, Escape to clear, Enter for the main button. Enter and Space on a
 * focused button (a keypad key, a criterion) press that button, as they do anywhere else.
 */
function useKeypadKeys(press: (key: Key) => void, enter: () => void, dialogRef: React.RefObject<HTMLDialogElement | null>) {
  const onKey = useEffectEvent((e: KeyboardEvent) => {
    if (dialogRef.current?.open || e.metaKey || e.ctrlKey || e.altKey) return;
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
  note = `After submitting you have ${SCORE_UNDO_MS / 1000} seconds to undo. Then it's final.`,
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
        className="mt-1 w-full resize-none rounded-xl border border-powder bg-white px-3 py-2 text-[15px] leading-relaxed text-prussian placeholder:text-prussian/50"
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
    setBuffer((b) => applyKey(b, key, activity));
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
  useKeypadKeys(press, review, dialogRef);

  const decimalsHint = activity.decimals === 0 ? "whole numbers only" : `up to ${activity.decimals} decimal place${activity.decimals > 1 ? "s" : ""}`;
  const typed = parseScore(buffer, activity);
  // Told as soon as it happens: no more typing can bring a score back under the max.
  const tooHigh = overMax(buffer, activity);
  const message = error ?? submission.error ?? (tooHigh ? overMaxMessage(buffer, activity) : null);

  return (
    <div className="flex w-full max-w-md flex-col lg:max-w-lg">
      {timer}
      <KeypadHeading number={number} correcting={correcting} />
      <h1 className="text-[clamp(1.6rem,4vw,2.5rem)] leading-tight font-bold text-balance">{entry.name}</h1>
      {notes}

      <div className={`mt-4 flex items-center rounded-2xl bg-oxford px-5 py-3 ${tooHigh ? ERROR_RING : ""}`} aria-live="polite">
        <output
          aria-label="Score"
          aria-describedby="score-hint"
          className={`tabular flex-1 text-[clamp(3.25rem,10vh,5rem)] leading-none font-bold ${tooHigh ? ERROR_TEXT : buffer ? "" : "text-powder/40"}`}
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

      <KeypadGrid decimals={activity.decimals} onPress={press} />

      <button
        type="button"
        onClick={review}
        disabled={!typed.ok || busy || closed}
        className="btn mt-4 h-[clamp(3.5rem,8vh,4.5rem)] w-full rounded-2xl bg-mint text-xl text-prussian hover:bg-white disabled:bg-oxford disabled:text-powder disabled:opacity-100"
      >
        {correcting ? "Review correction" : "Submit score"}
      </button>

      <ConfirmScore dialogRef={dialogRef} entry={entry} onConfirm={confirm} {...request.dialog}>
        {correcting ? (
          <>
            <FromTo from={formatScore(correcting.from, activity.decimals)} to={typed.ok ? formatScore(typed.value, activity.decimals) : buffer} />
            <ReasonField value={request.reason} onChange={request.setReason} error={request.error} />
          </>
        ) : (
          <p className="tabular mt-3 text-7xl font-bold text-regal">{typed.ok ? formatScore(typed.value, activity.decimals) : buffer}</p>
        )}
      </ConfirmScore>
    </div>
  );
}

/** Criteria scoring: points for each criterion on the same keypad, totalling up to 100. */
function CriteriaKeypad({ activity, entry, number, notes, submission, timer, closed = false, correcting }: KeypadProps) {
  const { criteria, decimals } = activity;
  const given = correcting?.fromBreakdown ?? null;
  const givenText = (id: string) => (given?.[id] === undefined ? "" : formatScore(given[id], decimals));
  // A correction starts from the points given; the first key on a criterion replaces its old value.
  const [values, setValues] = useState<Record<string, string>>(() => (given ? Object.fromEntries(criteria.map((c) => [c.id, givenText(c.id)])) : {}));
  const [untouched, setUntouched] = useState<Set<string>>(() => new Set(given ? criteria.map((c) => c.id) : []));
  const [activeId, setActiveId] = useState(criteria[0]?.id ?? "");
  const [error, setError] = useState<string | null>(null);
  const { busy } = submission;
  const dialogRef = useRef<HTMLDialogElement>(null);
  // Bumped each time the confirmation opens, so its criteria light up again.
  const [reviews, setReviews] = useState(0);
  // The active criterion's guide: open unless the judge closed it, remembered on this device.
  const [guideOpen, setGuideOpen] = useDeviceSetting("livescoring:criterion-guide-open", true);

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
    setValues((v) => ({ ...v, [active.id]: applyKey(fresh ? "" : (v[active.id] ?? ""), key, rulesFor(active)) }));
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
  useKeypadKeys(press, primary, dialogRef);

  const runningTotal = criteria.reduce((sum, c) => {
    const parsed = parseScore(values[c.id] ?? "", rulesFor(c));
    return parsed.ok ? sum + Math.round(parsed.value * 100) : sum;
  }, 0);
  const typedActive = values[active?.id ?? ""] ?? "";
  const tooHigh = (c: { id: string; max: number }) => overMax(values[c.id] ?? "", c);
  const activeTooHigh = !!active && tooHigh(active);
  const message = error ?? submission.error ?? (active && activeTooHigh ? `${active.name}: ${overMaxMessage(typedActive, active)}` : null);
  const overCount = criteria.filter(tooHigh).length;
  // Under the score sheet's lowest score: not an error yet (another digit may bring it up), but the judge is told why
  // they can't move on.
  const belowLowest = !!active?.min && /^\d+(\.\d*)?$/.test(typedActive) && Number(typedActive) < active.min;

  return (
    <div className="flex w-full max-w-md flex-col lg:max-w-lg">
      {timer}
      <KeypadHeading number={number} correcting={correcting} />
      <h1 className="text-[clamp(1.5rem,3.6vw,2.25rem)] leading-tight font-bold text-balance">{entry.name}</h1>
      {notes}

      <ul className="mt-3 space-y-1.5" aria-label="Criteria">
        {criteria.map((c) => {
          const isActive = c.id === active?.id;
          const value = values[c.id];
          const over = tooHigh(c);
          return (
            <li key={c.id}>
              <button
                type="button"
                onClick={() => setActiveId(c.id)}
                aria-pressed={isActive}
                className={`flex w-full items-center gap-3 rounded-xl px-4 py-2.5 text-left transition-colors ${
                  over
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
                {given && value !== givenText(c.id) && <span className={`tabular text-sm ${isActive ? "text-mint/80" : "text-powder"}`}>was {givenText(c.id) || "–"}</span>}
                {/* Light blue reads on the unselected rows; on the selected (brighter) one, the text colour does. */}
                <span className={`tabular text-lg font-bold ${over ? ERROR_TEXT : ""}`}>
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

      {active?.guide && (
        <div className="mt-3 rounded-xl border border-oxford">
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
        <div className={`mt-3 flex items-center rounded-2xl bg-oxford px-5 py-2.5 ${activeTooHigh ? ERROR_RING : ""}`} aria-live="polite">
          <span className="mr-3 max-w-[40%] truncate text-sm text-powder">{active.name}</span>
          <output
            aria-label={`${active.name} score`}
            aria-describedby={message ? "criteria-error" : undefined}
            className={`tabular flex-1 text-[clamp(2.5rem,7vh,4rem)] leading-none font-bold ${activeTooHigh ? ERROR_TEXT : typedActive ? "" : "text-powder/40"}`}
          >
            {typedActive || (
              <>
                <span aria-hidden className="inline-block h-[0.85em] w-[3px] translate-y-[0.08em] animate-pulse rounded-full motion-reduce:animate-none bg-powder/70" />
                <span className="sr-only">No score typed yet</span>
              </>
            )}
          </output>
          <span className="tabular text-right leading-tight text-powder">
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
          <p role="status" className="mt-2 text-sm font-semibold text-powder">
            The lowest score for {active.name} is {formatBound(active.min!)}.
          </p>
        )
      )}

      <KeypadGrid decimals={decimals} onPress={press} />

      <button
        type="button"
        onClick={primary}
        disabled={busy || (all.ok && closed && !correcting) || (!all.ok && !isValid(active?.id ?? ""))}
        className="btn mt-4 h-[clamp(3.5rem,8vh,4.5rem)] w-full rounded-2xl bg-mint text-xl text-prussian hover:bg-white disabled:bg-oxford disabled:text-powder disabled:opacity-100"
      >
        {all.ok ? (correcting ? "Review correction" : "Submit score") : nextMissing ? `Next: ${nextMissing.name}` : "Submit score"}
      </button>

      <ConfirmScore dialogRef={dialogRef} entry={entry} onConfirm={confirm} {...request.dialog}>
        {all.ok && correcting && (
          <>
            <FromTo from={formatScore(correcting.from, decimals)} to={formatScore(all.total, decimals)} />
            <p className="text-sm text-prussian/75">out of 100</p>
            <ol aria-label="Points for each criterion, before and after" className="mt-3 max-h-[min(16rem,35dvh)] space-y-1 overflow-y-auto text-left">
              {criteria.map((c) => {
                const now = formatScore(all.breakdown[c.id], decimals);
                const changed = now !== givenText(c.id);
                return (
                  <li key={c.id} className={`flex items-baseline gap-3 rounded-lg px-3 py-1.5 ${changed ? "bg-white font-semibold ring-1 ring-regal/40" : ""}`}>
                    <span className="min-w-0 flex-1">{c.name}</span>
                    <span className="tabular">
                      {changed ? (
                        <>
                          {givenText(c.id) || "–"} <span aria-hidden>→</span>
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
