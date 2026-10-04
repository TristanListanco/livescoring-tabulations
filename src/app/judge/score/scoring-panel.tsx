"use client";

import { useEffect, useEffectEvent, useRef, useState, useTransition } from "react";
import { Avatar } from "@/components/avatar";
import { LiveStatusBadge } from "@/components/live-status";
import { applyKey, formatScore, parseScore, rangeLabel, type Key } from "@/lib/scoring";
import type { Activity, Entry, Judge } from "@/lib/types";
import { useLiveRefresh } from "@/lib/use-live-refresh";
import { leavePortal, submitScore } from "../actions";

type Props = {
  activity: Activity;
  judge: Judge;
  entries: Entry[];
  myScores: { entryId: string; value: number }[];
};

const DIGITS: Key[] = ["1", "2", "3", "4", "5", "6", "7", "8", "9"];

function nextUnscored(entries: Entry[], scored: Set<string>, afterId?: string): string | undefined {
  const start = afterId ? entries.findIndex((e) => e.id === afterId) + 1 : 0;
  const rotated = [...entries.slice(start), ...entries.slice(0, start)];
  return rotated.find((e) => !scored.has(e.id))?.id;
}

export function ScoringPanel({ activity, judge, entries, myScores }: Props) {
  const status = useLiveRefresh(activity.id);
  const scores = new Map(myScores.map((s) => [s.entryId, s.value]));
  const scoredIds = new Set(scores.keys());

  const [chosenId, setChosenId] = useState<string | undefined>(() => nextUnscored(entries, scoredIds) ?? entries[0]?.id);
  const [buffer, setBuffer] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [saved, setSaved] = useState<{ name: string; value: string } | null>(null);
  const savedTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const activeChipRef = useRef<HTMLButtonElement>(null);

  // If the organizer removed the chosen entry, fall back to the next one to score.
  const selected = entries.find((e) => e.id === chosenId) ?? entries.find((e) => !scoredIds.has(e.id)) ?? entries[0];
  const selectedScore = selected ? scores.get(selected.id) : undefined;
  const locked = selectedScore !== undefined;
  const allDone = entries.length > 0 && entries.every((e) => scoredIds.has(e.id));

  const select = (id: string) => {
    setChosenId(id);
    setBuffer("");
    setError(null);
  };

  const press = (key: Key) => {
    if (locked || pending) return;
    setError(null);
    setBuffer((b) => applyKey(b, key, activity));
  };

  const review = () => {
    if (!selected || locked || pending) return;
    const parsed = parseScore(buffer, activity);
    if (!parsed.ok) {
      setError(parsed.error);
      return;
    }
    dialogRef.current?.showModal();
  };

  const confirm = () => {
    if (!selected) return;
    const entryId = selected.id;
    startTransition(async () => {
      const result = await submitScore(entryId, buffer);
      dialogRef.current?.close();
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setSaved({ name: selected.name, value: formatScore(Number(buffer), activity.decimals) });
      clearTimeout(savedTimer.current);
      savedTimer.current = setTimeout(() => setSaved(null), 3500);
      const next = nextUnscored(entries, new Set([...scoredIds, entryId]), entryId);
      select(next ?? entryId);
    });
  };

  // Keep the chosen entry visible in the phone's sideways entry strip after auto-advancing.
  useEffect(() => {
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    activeChipRef.current?.scrollIntoView({ block: "nearest", inline: "center", behavior: reduceMotion ? "auto" : "smooth" });
  }, [selected?.id]);

  const onKey = useEffectEvent((e: KeyboardEvent) => {
    if (dialogRef.current?.open || e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.target instanceof HTMLElement && e.target.closest("input, textarea")) return;
    if (/^[0-9]$/.test(e.key)) press(e.key as Key);
    else if (e.key === "." || e.key === ",") press(".");
    else if (e.key === "Backspace") press("back");
    else if (e.key === "Escape" || e.key === "Delete") press("clear");
    else if (e.key === "Enter") {
      e.preventDefault();
      review();
    } else return;
    e.preventDefault();
  });

  useEffect(() => {
    const listener = (e: KeyboardEvent) => onKey(e);
    window.addEventListener("keydown", listener);
    return () => window.removeEventListener("keydown", listener);
  }, []);

  const decimalsHint =
    activity.decimals === 0 ? "whole numbers only" : `up to ${activity.decimals} decimal place${activity.decimals > 1 ? "s" : ""}`;
  const typed = parseScore(buffer, activity);

  return (
    <div className="flex h-dvh flex-col bg-prussian text-mint">
      <header className="flex items-center gap-3 border-b border-oxford px-4 py-3 sm:px-6">
        <Avatar name={judge.name} src={judge.photoUrl} size={44} />
        <div className="min-w-0">
          <p className="truncate font-semibold">{judge.name}</p>
          <p className="truncate text-sm text-powder">{activity.name}</p>
        </div>
        <div className="ml-auto flex items-center gap-4 sm:gap-6">
          <p className="tabular text-powder">
            <span className="font-bold text-mint">{scoredIds.size}</span>
            <span className="sm:hidden">/{entries.length}</span>
            <span className="hidden sm:inline"> of {entries.length} scored</span>
          </p>
          <LiveStatusBadge status={status} className="text-mint" compact />
          <form action={leavePortal}>
            <button className="btn btn-sm border border-oxford text-powder hover:bg-oxford hover:text-mint">Sign out</button>
          </form>
        </div>
      </header>

      <div className="flex min-h-0 flex-1 flex-col md:flex-row">
        <nav aria-label="Entries" className="shrink-0 border-b border-oxford md:w-72 md:overflow-y-auto md:border-r md:border-b-0 lg:w-80">
          <h2 className="hidden px-6 pt-5 pb-2 text-sm font-semibold text-powder md:block">Entries</h2>
          {entries.length === 0 ? (
            <p className="px-6 py-4 text-powder">No entries yet. They appear here as soon as the organizer adds them.</p>
          ) : (
            <ol className="flex gap-2 overflow-x-auto px-4 py-3 md:flex-col md:gap-1 md:px-3 md:pt-0 md:pb-4">
              {entries.map((entry, i) => {
                const value = scores.get(entry.id);
                const active = entry.id === selected?.id;
                return (
                  <li key={entry.id} className="shrink-0 last:pr-4 md:last:pr-0">
                    <button
                      type="button"
                      ref={active ? activeChipRef : undefined}
                      onClick={() => select(entry.id)}
                      aria-current={active ? "true" : undefined}
                      className={`flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition-colors md:py-3 ${
                        active ? "bg-regal text-mint" : "bg-oxford/50 text-mint hover:bg-oxford md:bg-transparent"
                      }`}
                    >
                      <span className={`tabular w-6 text-sm ${active ? "text-mint" : "text-powder"}`}>{i + 1}</span>
                      <span className="max-w-40 truncate font-semibold md:max-w-none md:flex-1">{entry.name}</span>
                      {value !== undefined ? (
                        <span className={`tabular ml-auto flex items-center gap-1 text-sm font-semibold ${active ? "text-mint/80" : "text-powder"}`}>
                          <svg viewBox="0 0 16 16" className="size-4" aria-hidden>
                            <path d="M3 8.5l3 3 7-7" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                          </svg>
                          {formatScore(value, activity.decimals)}
                        </span>
                      ) : (
                        <span className="ml-auto size-2.5 shrink-0 rounded-full border-2 border-powder/60" aria-label="Not scored yet" />
                      )}
                    </button>
                  </li>
                );
              })}
            </ol>
          )}
        </nav>

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

          {allDone && (
            <p className="mb-4 w-full max-w-md rounded-xl bg-oxford px-4 py-3 text-center font-semibold lg:max-w-lg">
              You&apos;ve scored every entry. Thank you!
            </p>
          )}

          {selected && (
            <div className="flex w-full max-w-md flex-col lg:max-w-lg">
              <p className="text-powder">No. {entries.indexOf(selected) + 1}</p>
              <h1 className="text-[clamp(1.6rem,4vw,2.5rem)] leading-tight font-bold text-balance">{selected.name}</h1>

              {locked ? (
                <div className="mt-6 rounded-2xl border-2 border-oxford px-6 py-8 text-center">
                  <p className="tabular text-7xl font-bold">{formatScore(selectedScore, activity.decimals)}</p>
                  <p className="mt-3 text-powder">Submitted. Scores can&apos;t be changed after submitting.</p>
                </div>
              ) : (
                <>
                  <div className="mt-4 flex items-center rounded-2xl bg-oxford px-5 py-3" aria-live="polite">
                    <output
                      aria-label="Score"
                      className={`tabular flex-1 text-[clamp(3.25rem,10vh,5rem)] leading-none font-bold ${buffer ? "" : "text-powder/40"}`}
                    >
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

                  <div className="mt-4 grid grid-cols-3 gap-2.5 sm:gap-3">
                    {DIGITS.map((d) => (
                      <KeypadKey key={d} onPress={() => press(d)} label={d} />
                    ))}
                    {activity.decimals > 0 ? (
                      <KeypadKey onPress={() => press(".")} label="." ariaLabel="Decimal point" />
                    ) : (
                      <span />
                    )}
                    <KeypadKey onPress={() => press("0")} label="0" />
                    <KeypadKey
                      onPress={() => press("back")}
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

                  <button
                    type="button"
                    onClick={review}
                    disabled={!typed.ok || pending}
                    className="btn mt-4 h-[clamp(3.5rem,8vh,4.5rem)] w-full rounded-2xl bg-mint text-xl text-prussian hover:bg-white disabled:bg-oxford disabled:text-powder disabled:opacity-100"
                  >
                    Submit score
                  </button>
                </>
              )}
            </div>
          )}
        </main>
      </div>

      <dialog
        ref={dialogRef}
        aria-labelledby="confirm-title"
        className="m-auto w-[min(26rem,calc(100vw-2rem))] rounded-3xl bg-mint p-0 text-prussian shadow-2xl"
      >
        <div className="px-6 pt-7 pb-6 text-center">
          <h2 id="confirm-title" className="text-lg font-semibold">
            Submit this score for {selected?.name}?
          </h2>
          <p className="tabular mt-3 text-7xl font-bold text-regal">{typed.ok ? formatScore(typed.value, activity.decimals) : buffer}</p>
          <p className="mt-3 text-prussian/75">You can&apos;t change it after submitting.</p>
        </div>
        <div className="grid grid-cols-2 gap-3 px-6 pb-6">
          <button type="button" className="btn h-14 rounded-xl btn-quiet text-lg" onClick={() => dialogRef.current?.close()} disabled={pending} autoFocus>
            Go back
          </button>
          <button type="button" className="btn h-14 rounded-xl btn-primary text-lg" onClick={confirm} disabled={pending}>
            {pending ? "Submitting…" : "Submit"}
          </button>
        </div>
      </dialog>
    </div>
  );
}

function KeypadKey({ label, onPress, ariaLabel }: { label: React.ReactNode; onPress: () => void; ariaLabel?: string }) {
  return (
    <button
      type="button"
      onClick={onPress}
      aria-label={ariaLabel}
      className="tabular h-[clamp(3.5rem,9.5vh,5.5rem)] rounded-2xl bg-oxford text-[clamp(1.75rem,4.5vh,2.5rem)] font-semibold text-mint transition-colors select-none hover:bg-regal active:scale-[0.97] active:bg-regal"
    >
      {label}
    </button>
  );
}
