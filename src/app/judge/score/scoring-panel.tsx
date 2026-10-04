"use client";

import { useEffect, useEffectEvent, useRef, useState } from "react";
import { Avatar } from "@/components/avatar";
import { LiveStatusBadge } from "@/components/live-status";
import { judgeView, type JudgeView } from "@/lib/judging";
import { applyKey, formatBound, formatScore, parseBreakdown, parseScore, rangeLabel, type Key } from "@/lib/scoring";
import type { Activity, Entry, Judge } from "@/lib/types";
import { useLiveRefresh } from "@/lib/use-live-refresh";
import { leavePortal, requestApproval, submitScore } from "../actions";

/** Whether the organizer has approved this device for the judge. Only the approved device can score. */
export type DeviceGate = { status: "approved" } | { status: "pending"; pairingCode: string; label: string } | { status: "revoked" };

type Props = {
  activity: Activity;
  judge: Judge;
  entries: Entry[];
  myScores: { entryId: string; value: number }[];
  gate: DeviceGate;
};

const DIGITS: Key[] = ["1", "2", "3", "4", "5", "6", "7", "8", "9"];
const NETWORK_ERROR = "The score didn't save. Check your connection and try again.";

/** A judge's own score as they think of it: the score, or criteria points out of 100. */
function myScoreText(value: number, activity: Activity): string {
  return activity.scoringMode === "criteria" ? `${formatScore(value, activity.decimals)} / 100` : formatScore(value, activity.decimals);
}

/**
 * The judge's screen. Nothing opens until the organizer approves this device. After that the organizer
 * decides which entry is judged and when: judges only ever see the entry on screen, and wait in between.
 */
// A device waiting for approval checks every few seconds even when realtime is down, so the organizer's
// approval lands on the judge's screen right away. Other judge screens check a little less often.
const PENDING_POLL_MS = 2_500;
const JUDGE_POLL_MS = 5_000;

export function ScoringPanel({ activity, judge, entries, myScores, gate }: Props) {
  const status = useLiveRefresh(activity.id, gate.status === "pending" ? PENDING_POLL_MS : JUDGE_POLL_MS);
  // Scores confirmed by the server but not yet in the refreshed page, so the keypad doesn't flash back.
  const [justSaved, setJustSaved] = useState<Map<string, number>>(() => new Map());
  const scores = new Map([...myScores.map((s) => [s.entryId, s.value] as const), ...justSaved]);
  const view = judgeView(activity, entries, scores);
  const [saved, setSaved] = useState<{ name: string; value: string } | null>(null);
  const savedTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const approved = gate.status === "approved";

  const onSaved = (entry: Entry, value: number) => {
    setJustSaved((m) => new Map(m).set(entry.id, value));
    setSaved({ name: entry.name, value: myScoreText(value, activity) });
    clearTimeout(savedTimer.current);
    savedTimer.current = setTimeout(() => setSaved(null), 3500);
  };

  const currentId = approved && (view.kind === "scoring" || view.kind === "scored") ? view.entry.id : null;

  return (
    <div className="flex h-dvh flex-col bg-prussian text-mint">
      <header className="flex items-center gap-3 border-b border-oxford px-4 py-3 sm:px-6">
        <Avatar name={judge.name} src={judge.photoUrl} size={44} />
        <div className="min-w-0">
          <p className="truncate font-semibold">{judge.name}</p>
          <p className="truncate text-sm text-powder">{activity.name}</p>
        </div>
        <div className="ml-auto flex items-center gap-4 sm:gap-6">
          {approved && (
            <p className="tabular text-powder">
              <span className="font-bold text-mint">{scores.size}</span>
              <span className="sm:hidden">/{entries.length}</span>
              <span className="hidden sm:inline"> of {entries.length} scored</span>
            </p>
          )}
          <LiveStatusBadge status={status} className="text-mint" compact />
          <form action={leavePortal}>
            <button className="btn btn-sm border border-oxford text-powder hover:bg-oxford hover:text-mint">Sign out</button>
          </form>
        </div>
      </header>

      <div className="flex min-h-0 flex-1 flex-col md:flex-row">
        {approved && (
          <aside aria-label="Your scores" className="hidden shrink-0 border-oxford md:block md:w-72 md:overflow-y-auto md:border-r lg:w-80">
            <h2 className="px-6 pt-5 pb-2 text-sm font-semibold text-powder">Your scores</h2>
            <ol className="space-y-1 px-3 pb-4">
              {entries.map((entry, i) => {
                const value = scores.get(entry.id);
                const current = entry.id === currentId;
                return (
                  <li key={entry.id} aria-current={current ? "true" : undefined} className={`flex items-center gap-3 rounded-xl px-3 py-3 ${current ? "bg-regal" : ""}`}>
                    <span className={`tabular w-6 text-sm ${current ? "text-mint" : "text-powder"}`}>{i + 1}</span>
                    <span className="min-w-0 flex-1 truncate font-semibold">
                      {entry.name}
                      {current && <span className="sr-only"> (now judging)</span>}
                    </span>
                    {value !== undefined ? (
                      <span className={`tabular text-sm font-semibold ${current ? "text-mint/80" : "text-powder"}`}>{formatScore(value, activity.decimals)}</span>
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

        <main className="flex min-h-0 flex-1 flex-col items-center overflow-y-auto px-4 py-5 sm:px-8 md:justify-center">
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

          {!approved ? (
            <DeviceGateCard gate={gate} />
          ) : view.kind === "scoring" ? (
            activity.scoringMode === "criteria" ? (
              <CriteriaKeypad key={view.entry.id} activity={activity} entry={view.entry} number={view.number} onSaved={onSaved} />
            ) : (
              <Keypad key={view.entry.id} activity={activity} entry={view.entry} number={view.number} onSaved={onSaved} />
            )
          ) : (
            <WaitingCard view={view} judge={judge} activity={activity} scoredCount={scores.size} />
          )}
        </main>
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
        <p className="mt-3 text-lg text-powder text-balance">Show or read this code to the organizer. Scoring opens on this device once they approve it.</p>
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

function WaitingCard({ view, judge, activity, scoredCount }: { view: Exclude<JudgeView, { kind: "scoring" }>; judge: Judge; activity: Activity; scoredCount: number }) {
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
  const { title, body } = copy[view.kind];

  return (
    <div role="status" className="my-auto flex w-full max-w-md flex-col items-center text-center lg:max-w-lg">
      {view.kind === "scored" && (
        <div className="mb-8 w-full rounded-2xl border-2 border-oxford px-6 py-7">
          <p className="text-powder">
            No. {view.number} {view.entry.name}
          </p>
          <p className="tabular mt-2 text-6xl font-bold">{myScoreText(view.value, activity)}</p>
          <p className="mt-2 text-sm text-powder">Submitted. Scores can&apos;t be changed after submitting.</p>
        </div>
      )}
      {view.kind !== "ended" && <WaitingDots />}
      <h1 className="text-[clamp(1.6rem,4vw,2.25rem)] leading-tight font-bold text-balance">{title}</h1>
      <p className="mt-3 text-lg text-powder text-balance">{body}</p>
    </div>
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

/** Physical keyboard support: digits, point, Backspace, Escape to clear, Enter for the main button. */
function useKeypadKeys(press: (key: Key) => void, enter: () => void, dialogRef: React.RefObject<HTMLDialogElement | null>) {
  const onKey = useEffectEvent((e: KeyboardEvent) => {
    if (dialogRef.current?.open || e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.target instanceof HTMLElement && e.target.closest("input, textarea")) return;
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
  submitting,
  onConfirm,
  children,
}: {
  dialogRef: React.RefObject<HTMLDialogElement | null>;
  entry: Entry;
  submitting: boolean;
  onConfirm: () => void;
  children: React.ReactNode;
}) {
  return (
    <dialog ref={dialogRef} aria-labelledby="confirm-title" className="m-auto w-[min(26rem,calc(100vw-2rem))] rounded-3xl bg-mint p-0 text-prussian shadow-2xl">
      <div className="px-6 pt-7 pb-6 text-center">
        <h2 id="confirm-title" className="text-lg font-semibold">
          Submit this score for {entry.name}?
        </h2>
        {children}
        <p className="mt-3 text-prussian/75">You can&apos;t change it after submitting.</p>
      </div>
      <div className="grid grid-cols-2 gap-3 px-6 pb-6">
        <button type="button" className="btn btn-quiet h-14 rounded-xl text-lg" onClick={() => dialogRef.current?.close()} disabled={submitting} autoFocus>
          Go back
        </button>
        <button type="button" className="btn btn-primary h-14 rounded-xl text-lg" onClick={onConfirm} disabled={submitting}>
          {submitting ? "Submitting…" : "Submit"}
        </button>
      </div>
    </dialog>
  );
}

type KeypadProps = { activity: Activity; entry: Entry; number: number; onSaved: (entry: Entry, value: number) => void };

/** Simple scoring: one score between min and max. */
function Keypad({ activity, entry, number, onSaved }: KeypadProps) {
  const [buffer, setBuffer] = useState("");
  const [error, setError] = useState<string | null>(null);
  // True only while the score is on its way to the server, so taps right after "Saved" aren't dropped.
  const [submitting, setSubmitting] = useState(false);
  const dialogRef = useRef<HTMLDialogElement>(null);

  const press = (key: Key) => {
    if (submitting) return;
    setError(null);
    setBuffer((b) => applyKey(b, key, activity));
  };
  const review = () => {
    if (submitting) return;
    const parsed = parseScore(buffer, activity);
    if (!parsed.ok) setError(parsed.error);
    else dialogRef.current?.showModal();
  };
  const confirm = async () => {
    const parsed = parseScore(buffer, activity);
    if (submitting || !parsed.ok) return;
    setSubmitting(true);
    const result = await submitScore(entry.id, buffer).catch(() => ({ ok: false as const, error: NETWORK_ERROR }));
    setSubmitting(false);
    dialogRef.current?.close();
    if (!result.ok) setError(result.error);
    else onSaved(entry, parsed.value);
  };
  useKeypadKeys(press, review, dialogRef);

  const decimalsHint = activity.decimals === 0 ? "whole numbers only" : `up to ${activity.decimals} decimal place${activity.decimals > 1 ? "s" : ""}`;
  const typed = parseScore(buffer, activity);

  return (
    <div className="flex w-full max-w-md flex-col lg:max-w-lg">
      <p className="text-powder">Now judging: No. {number}</p>
      <h1 className="text-[clamp(1.6rem,4vw,2.5rem)] leading-tight font-bold text-balance">{entry.name}</h1>

      <div className="mt-4 flex items-center rounded-2xl bg-oxford px-5 py-3" aria-live="polite">
        <output aria-label="Score" className={`tabular flex-1 text-[clamp(3.25rem,10vh,5rem)] leading-none font-bold ${buffer ? "" : "text-powder/40"}`}>
          {buffer || (
            <>
              <span aria-hidden className="inline-block h-[0.85em] w-[3px] translate-y-[0.08em] animate-pulse rounded-full bg-powder/70" />
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
      <p className={`mt-2 text-sm ${error ? "font-semibold text-[#f4b4ae]" : "text-powder"}`} role={error ? "alert" : undefined}>
        {error ?? `Score from ${rangeLabel(activity)}, ${decimalsHint}.`}
      </p>

      <KeypadGrid decimals={activity.decimals} onPress={press} />

      <button
        type="button"
        onClick={review}
        disabled={!typed.ok || submitting}
        className="btn mt-4 h-[clamp(3.5rem,8vh,4.5rem)] w-full rounded-2xl bg-mint text-xl text-prussian hover:bg-white disabled:bg-oxford disabled:text-powder disabled:opacity-100"
      >
        Submit score
      </button>

      <ConfirmScore dialogRef={dialogRef} entry={entry} submitting={submitting} onConfirm={confirm}>
        <p className="tabular mt-3 text-7xl font-bold text-regal">{typed.ok ? formatScore(typed.value, activity.decimals) : buffer}</p>
      </ConfirmScore>
    </div>
  );
}

/** Criteria scoring: points for each criterion on the same keypad, totalling up to 100. */
function CriteriaKeypad({ activity, entry, number, onSaved }: KeypadProps) {
  const { criteria, decimals } = activity;
  const [values, setValues] = useState<Record<string, string>>({});
  const [activeId, setActiveId] = useState(criteria[0]?.id ?? "");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const dialogRef = useRef<HTMLDialogElement>(null);

  const active = criteria.find((c) => c.id === activeId) ?? criteria[0];
  const rulesFor = (max: number) => ({ min: 0, max, decimals });
  const isValid = (id: string) => {
    const c = criteria.find((x) => x.id === id);
    return !!c && parseScore(values[id] ?? "", rulesFor(c.max)).ok;
  };
  const activeIndex = criteria.indexOf(active);
  const nextMissing = [...criteria.slice(activeIndex + 1), ...criteria.slice(0, activeIndex)].find((c) => !isValid(c.id));
  const all = parseBreakdown(values, criteria, decimals);

  const press = (key: Key) => {
    if (submitting || !active) return;
    setError(null);
    setValues((v) => ({ ...v, [active.id]: applyKey(v[active.id] ?? "", key, rulesFor(active.max)) }));
  };
  const primary = () => {
    if (submitting) return;
    if (all.ok) {
      dialogRef.current?.showModal();
      return;
    }
    const parsed = parseScore(values[active.id] ?? "", rulesFor(active.max));
    if (!parsed.ok) setError(`${active.name}: ${parsed.error}`);
    else if (nextMissing) setActiveId(nextMissing.id);
  };
  const confirm = async () => {
    if (submitting || !all.ok) return;
    setSubmitting(true);
    const result = await submitScore(entry.id, values).catch(() => ({ ok: false as const, error: NETWORK_ERROR }));
    setSubmitting(false);
    dialogRef.current?.close();
    if (!result.ok) setError(result.error);
    else onSaved(entry, all.total);
  };
  useKeypadKeys(press, primary, dialogRef);

  const runningTotal = criteria.reduce((sum, c) => {
    const parsed = parseScore(values[c.id] ?? "", rulesFor(c.max));
    return parsed.ok ? sum + Math.round(parsed.value * 100) : sum;
  }, 0);
  const typedActive = values[active?.id ?? ""] ?? "";

  return (
    <div className="flex w-full max-w-md flex-col lg:max-w-lg">
      <p className="text-powder">Now judging: No. {number}</p>
      <h1 className="text-[clamp(1.5rem,3.6vw,2.25rem)] leading-tight font-bold text-balance">{entry.name}</h1>

      <ul className="mt-3 space-y-1.5" aria-label="Criteria">
        {criteria.map((c) => {
          const isActive = c.id === active?.id;
          const value = values[c.id];
          return (
            <li key={c.id}>
              <button
                type="button"
                onClick={() => setActiveId(c.id)}
                aria-pressed={isActive}
                className={`flex w-full items-center gap-3 rounded-xl px-4 py-2.5 text-left transition-colors ${
                  isActive ? "bg-regal ring-2 ring-powder" : "bg-oxford hover:bg-regal/60"
                }`}
              >
                <span className="min-w-0 flex-1 truncate font-semibold">{c.name}</span>
                <span className="tabular text-lg font-bold">{value || <span className="text-powder/60">–</span>}</span>
                <span className="tabular w-12 text-right text-sm text-powder">/ {formatBound(c.max)}</span>
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

      {active && (
        <div className="mt-3 flex items-center rounded-2xl bg-oxford px-5 py-2.5" aria-live="polite">
          <span className="mr-3 max-w-[40%] truncate text-sm text-powder">{active.name}</span>
          <output aria-label={`${active.name} score`} className={`tabular flex-1 text-[clamp(2.5rem,7vh,4rem)] leading-none font-bold ${typedActive ? "" : "text-powder/40"}`}>
            {typedActive || (
              <>
                <span aria-hidden className="inline-block h-[0.85em] w-[3px] translate-y-[0.08em] animate-pulse rounded-full bg-powder/70" />
                <span className="sr-only">No score typed yet</span>
              </>
            )}
          </output>
          <span className="tabular text-lg text-powder">/ {formatBound(active.max)}</span>
        </div>
      )}
      {error && (
        <p className="mt-2 text-sm font-semibold text-[#f4b4ae]" role="alert">
          {error}
        </p>
      )}

      <KeypadGrid decimals={decimals} onPress={press} />

      <button
        type="button"
        onClick={primary}
        disabled={submitting || (!all.ok && !isValid(active?.id ?? ""))}
        className="btn mt-4 h-[clamp(3.5rem,8vh,4.5rem)] w-full rounded-2xl bg-mint text-xl text-prussian hover:bg-white disabled:bg-oxford disabled:text-powder disabled:opacity-100"
      >
        {all.ok ? "Submit score" : nextMissing ? `Next: ${nextMissing.name}` : "Submit score"}
      </button>

      <ConfirmScore dialogRef={dialogRef} entry={entry} submitting={submitting} onConfirm={confirm}>
        {all.ok && (
          <>
            <dl className="mt-4 space-y-1 text-left">
              {criteria.map((c) => (
                <div key={c.id} className="flex justify-between gap-4">
                  <dt className="truncate">{c.name}</dt>
                  <dd className="tabular font-semibold">
                    {formatScore(all.breakdown[c.id], decimals)} / {formatBound(c.max)}
                  </dd>
                </div>
              ))}
            </dl>
            <p className="tabular mt-3 text-5xl font-bold text-regal">{formatScore(all.total, decimals)}</p>
            <p className="text-sm text-prussian/75">out of 100</p>
          </>
        )}
      </ConfirmScore>
    </div>
  );
}
