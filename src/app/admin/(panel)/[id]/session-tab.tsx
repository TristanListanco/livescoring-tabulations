"use client";

import Link from "next/link";
import { useEffect, useOptimistic, useRef, useState, useTransition } from "react";
import { Avatar } from "@/components/avatar";
import { CopyButton } from "@/components/copy-button";
import { LiveStatusBadge } from "@/components/live-status";
import { Qr } from "@/components/qr";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { entryNeighbors } from "@/lib/judging";
import { reach } from "@/lib/reach";
import type { ActionResult, Board, Entry, Judge, JudgeDevice, Signatory } from "@/lib/types";
import { useLiveRefresh, type LiveStatus } from "@/lib/use-live-refresh";
import { setCurrentEntry, setSessionState } from "../../actions";
import { FormMessage } from "../form-message";
import { LinkField } from "../link-field";
import { ApproveDeviceButton } from "./judge-devices";
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

/** "Ana Cruz", "Ana Cruz and Ben Torres", "Ana Cruz, Ben Torres and 3 others". */
function names(people: { name: string }[]): string {
  if (people.length <= 3) return list.format(people.map((p) => p.name));
  return `${people
    .slice(0, 2)
    .map((p) => p.name)
    .join(", ")} and ${people.length - 2} others`;
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

/** The results PDF link. The time zone goes along so the sheet's printed time matches the venue's clock. */
function DownloadResults({ activityId, className }: { activityId: string; className: string }) {
  return (
    <a
      href={`/admin/${activityId}/export`}
      onClick={(e) => {
        e.currentTarget.href = `/admin/${activityId}/export?tz=${encodeURIComponent(Intl.DateTimeFormat().resolvedOptions().timeZone)}`;
      }}
      className={className}
      download
    >
      Download results PDF
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
  ledUrl,
}: {
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
  ledUrl: string;
}) {
  const connection = useLiveRefresh(board.activity.id);
  const { activity, judges, entries, scores } = board;
  const [current, setCurrent] = useOptimistic(activity.currentEntryId);
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<ActionResult | null>(null);
  const [moveError, setMoveError] = useState<string | null>(null);
  const [showQr, setShowQr] = useState(false);

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
  const changeState = async (state: "live" | "ended", password?: string) => {
    const r = await reach(() => setSessionState(activity.id, state, password));
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
  const scoredBy = new Set(scores.filter((s) => s.entryId === entry?.id).map((s) => s.judgeId));
  const stillScoring = judges.filter((j) => !scoredBy.has(j.id));
  const allIn = entry !== null && judges.length > 0 && stillScoring.length === 0;
  const state = activity.sessionState;
  const live = state === "live";
  const scoreCount = (entryId: string) => scores.filter((s) => s.entryId === entryId).length;
  const devicesOf = (judgeId: string) => devices.filter((d) => d.judgeId === judgeId);
  const unpaired = judges.filter((j) => !devicesOf(j.id).some((d) => d.status === "approved"));
  const missing = progress.possible - progress.submitted;
  // The last entry fully scored: ending the session is the next thing to do, so the desk offers it right there.
  const lastOneIn = allIn && !next;
  const fullyScored = (e: Entry) => judges.length > 0 && scoreCount(e.id) >= judges.length;

  /**
   * What moving to `target` would interrupt or skip, in the order the operator needs to hear it. Empty when the
   * move is routine (everyone has scored, and it's the next or previous entry), so routine moves stay one click.
   * Moving still works after the warning: the operator decides.
   */
  const warningsFor = (target: Entry, kind: "next" | "previous" | "jump"): string[] => {
    const warnings: string[] = [];
    if (entry && stillScoring.length > 0) {
      warnings.push(
        `${names(stillScoring)} ${stillScoring.length === 1 ? "hasn't" : "haven't"} scored ${entry.name} yet. Their screen will move to ${target.name}, and you can come back to ${entry.name} later.`,
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
      Judges won&apos;t be able to submit any more scores, and entries can&apos;t be changed. Enter your admin password to confirm. You can reopen
      the session if you need to.
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
   */
  useEffect(() => {
    if (!live) return;
    // Space presses on key-up, like a button does: pressed on key-down, the guard dialog would open and take
    // focus, and the key-up would then press its Cancel button.
    const handle = (e: KeyboardEvent) => {
      if (e.repeat || e.altKey || e.ctrlKey || e.metaKey || e.shiftKey || document.querySelector("dialog[open]")) return;
      const target = e.target instanceof HTMLElement ? e.target : null;
      if (target?.closest("input, textarea, select, [contenteditable='true']")) return;
      const space = e.key === " " && !target?.closest("button, a, summary, [role='switch']");
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
          Running order
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
                <span className={`tabular text-right font-semibold text-prussian/70 ${compact ? "w-6" : "w-8"}`}>{i + 1}</span>
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
                {state === "draft" ? null : state === "ended" ? (
                  // Judging is over: no "now judging" or "judge now" to suggest otherwise.
                  <span className="inline-flex h-9 items-center px-3 text-sm font-semibold text-prussian/80">
                    {scoreCount(e.id) > 0 ? "Judged" : "Not judged"}
                  </span>
                ) : onAir ? (
                  <span className="inline-flex h-9 items-center gap-2 rounded-md bg-regal px-3 text-sm font-semibold text-mint">Now judging</span>
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
                    className: "btn btn-quiet btn-sm",
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
    const textAction = "inline-flex h-7 items-center rounded px-1.5 text-sm font-semibold text-regal hover:bg-wash pointer-coarse:h-11 pointer-coarse:min-w-11 pointer-coarse:justify-center pointer-coarse:px-2.5";
    return (
      <div className="max-lg:space-y-8 lg:-mb-6 lg:grid lg:h-[calc(100dvh-18rem)] lg:min-h-[22rem] lg:grid-cols-[minmax(0,1fr)_20rem] lg:gap-6">
        <section aria-labelledby="desk-heading" className="admin-desk keep-light flex min-h-0 flex-col overflow-hidden rounded-2xl bg-prussian text-mint">
          {offline}
          <div className="flex items-start justify-between gap-4 px-6 pt-4">
            <div className="min-w-0 flex-1">
              <h2 id="desk-heading" className="text-sm text-powder">
                {entry ? `Now judging: No. ${index + 1} of ${entries.length}` : "On judges' screens"}
              </h2>
              <p title={entry?.name} className="line-clamp-2 text-[clamp(1.375rem,2vw,1.75rem)] leading-tight font-bold text-balance wrap-anywhere">
                {entry ? entry.name : "Judges are waiting for an entry"}
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-3">
              <DeskConnection status={connection} renderedAt={renderedAt} className="text-powder" />
              {!lastOneIn && endSession("btn btn-sm border border-oxford text-mint hover:bg-oxford")}
            </div>
          </div>
          {/* A success ("The session has ended…") is what the desk now shows anyway, so it's announced, not repeated on screen. */}
          <FormMessage state={result} small onDark className={result?.ok ? "sr-only" : "px-6 pt-2 font-semibold"} />

          <div tabIndex={0} role="region" aria-label="Judges" className="@container mt-3 min-h-0 flex-1 overflow-y-auto px-6 pb-3">
            <ul className="grid gap-2 @sm:grid-cols-2 @2xl:grid-cols-4">
              {judges.map((j) => (
                <JudgeTile key={j.id} judge={j} devices={devicesOf(j.id)} scored={entry ? scoredBy.has(j.id) : null} stacked />
              ))}
            </ul>
          </div>

          {/* The action bar: the status on the left, Previous and Next on the right, in the same place all show. */}
          <div role="group" aria-label="Show controls" className="flex shrink-0 flex-wrap items-center gap-3 border-t border-oxford px-6 py-3">
            {/* Two lines at most so the bar keeps its height; screen readers still get the whole sentence. */}
            <p role="status" className="line-clamp-2 min-w-48 flex-1 leading-snug font-semibold">
              {entry &&
                (allIn
                  ? next
                    ? `Every judge has scored ${entry.name}.`
                    : `Every judge has scored ${entry.name}. That was the last entry.`
                  : `${scoredBy.size} of ${judges.length} ${judges.length === 1 ? "judge has" : "judges have"} scored. Waiting on ${names(stillScoring)}.`)}
            </p>
            {/* On phones the buttons go full width, the next entry first: it's the one the operator reaches for. */}
            {previous ? (
              moveControl({
                target: previous,
                kind: "previous",
                label: (
                  <>
                    {kbd("←")}
                    Previous entry
                  </>
                ),
                className: "btn border border-oxford text-mint hover:bg-oxford max-sm:order-2 max-sm:w-full",
                title: `Go back to ${previous.name}?`,
                confirmLabel: "Go back anyway",
                keyShortcuts: "ArrowLeft",
              })
            ) : (
              <button type="button" className="btn border border-oxford text-mint max-sm:order-2 max-sm:w-full" disabled>
                Previous entry
              </button>
            )}
            {lastOneIn ? (
              endSession("btn bg-mint text-prussian hover:bg-white max-sm:order-1 max-sm:w-full")
            ) : next ? (
              moveControl({
                target: next,
                kind: "next",
                label: (
                  <>
                    <span className="truncate">{entry ? `Show next entry: ${next.name}` : "Show first entry"}</span>
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
                {entry ? "No more entries" : "No entries yet"}
              </button>
            )}
            {moveError && (
              <p role="alert" className="basis-full text-sm font-semibold text-danger-soft max-sm:order-3">
                {moveError}
              </p>
            )}
          </div>
        </section>

        <aside aria-label="Running order and screens" className="flex min-h-0 flex-col gap-4">
          {runningOrder(true)}

          <section aria-labelledby="screens" className="shrink-0 rounded-2xl border border-line bg-white/60 px-4 py-3 text-sm">
            <h2 id="screens" className="text-base font-bold">
              Screens
            </h2>
            <div className="mt-1.5 space-y-1">
              <RankingSwitch activity={activity} compact />
              <div className="flex items-center gap-1">
                <span className="min-w-0 flex-1 truncate font-semibold">Live results</span>
                <CopyButton value={liveUrl} className={textAction} />
                <a href={liveUrl} target="_blank" rel="noreferrer" className={textAction}>
                  Open<span className="sr-only"> live results</span>
                </a>
                <button type="button" className={textAction} aria-expanded={showQr} onClick={() => setShowQr((v) => !v)}>
                  QR<span className="sr-only"> code for live results</span>
                </button>
              </div>
              {showQr && (
                <div className="pb-1">
                  <Qr svg={liveQr} label="QR code for the live results page" />
                </div>
              )}
              <div className="flex items-center gap-1">
                <Link
                  href={`/admin/${activity.id}?tab=led`}
                  scroll={false}
                  className="tap-target min-w-0 flex-1 truncate hover:underline"
                  title="Change the LED wall's display"
                >
                  <span className="font-semibold">LED wall</span>{" "}
                  <span className="text-prussian/70">
                    {activity.ledFullscreen ? "full screen" : "lower third"}, {activity.ledTransition === "wipe" ? "wipe" : "fade"}
                    {activity.ledAnonymous && ", anonymous judges"}
                  </span>
                </Link>
                <CopyButton value={ledUrl} className={textAction} />
                <a href={ledUrl} target="_blank" rel="noreferrer" className={textAction}>
                  Open<span className="sr-only"> LED wall</span>
                </a>
              </div>
              {progress.complete && (
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-line pt-2">
                  <DownloadResults activityId={activity.id} className="btn btn-primary btn-sm" />
                  <p className="text-[13px]">
                    Report ID <span className="tabular font-bold tracking-wide">{reportId}</span>
                  </p>
                </div>
              )}
            </div>
          </section>
        </aside>
      </div>
    );
  }

  return (
    <div className="max-w-4xl space-y-10">
      <div className="space-y-4">
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
                {entries.length} {entries.length === 1 ? "entry" : "entries"} in the running order.{" "}
                {judges.length === 0 ? (
                  <Link href={`/admin/${activity.id}?tab=judges`} scroll={false} className="font-semibold text-mint underline underline-offset-2">
                    Add judges
                  </Link>
                ) : (
                  <>
                    Judges&apos; codes and QR codes are on the{" "}
                    <Link href={`/admin/${activity.id}?tab=access`} scroll={false} className="font-semibold text-mint underline underline-offset-2">
                      Judge devices
                    </Link>{" "}
                    tab.
                  </>
                )}
              </p>
              <ConfirmDialog
                triggerLabel="Start session"
                triggerClassName="btn shrink-0 bg-mint text-prussian hover:bg-white"
                title="Start judging?"
                confirmLabel="Start session"
                onConfirm={() => changeState("live")}
              >
                Judges&apos; screens open, and the judges and running order lock. You can still add and rename entries. Show the first entry when
                you&apos;re ready.
                {judges.length > 0 && unpaired.length > 0 && (
                  <span className="mt-3 block font-semibold text-prussian">
                    {names(unpaired)} {unpaired.length === 1 ? "doesn't" : "don't"} have an approved device yet. They can still pair after you start.
                  </span>
                )}
              </ConfirmDialog>
            </div>
          </section>
        )}

        {state === "ended" && (
          <section aria-labelledby="desk-heading" className="admin-desk keep-light overflow-hidden rounded-2xl bg-prussian text-mint">
            <div className="px-6 pt-6 pb-6">
              <div className="flex items-start justify-between gap-4">
                <h2 id="desk-heading" className="text-powder">
                  Judging has ended
                </h2>
                {/* Ending took a password; reopening at least asks, because it reopens the official record. */}
                <ConfirmDialog
                  triggerLabel="Reopen session"
                  triggerClassName="btn btn-sm shrink-0 border border-oxford text-mint hover:bg-oxford"
                  title="Reopen the session?"
                  confirmLabel="Reopen session"
                  onConfirm={() => changeState("live")}
                >
                  Judges can score again, and entries can be changed. If a new score comes in, the report ID changes, so a results PDF you&apos;ve
                  already downloaded or printed won&apos;t match anymore.
                </ConfirmDialog>
              </div>
              <FormMessage state={result} small onDark className={result?.ok ? "sr-only" : "pt-2 font-semibold"} />
              {progress.complete ? (
                <>
                  <p className="mt-1 text-[clamp(1.6rem,3vw,2.25rem)] leading-tight font-bold">Every score is in</p>
                  <p className="mt-5 text-sm font-semibold text-powder">Report ID</p>
                  <p className="tabular text-[clamp(1.75rem,4.5vw,2.75rem)] leading-tight font-bold tracking-[0.06em]">{reportId}</p>
                  <p className="mt-2 max-w-xl text-[15px] leading-relaxed text-powder">
                    Printed on the results PDF. The ID changes if any score changes, so anyone can check a printed sheet against this screen.
                  </p>
                </>
              ) : (
                <>
                  <p className="mt-1 text-[clamp(1.6rem,3vw,2.25rem)] leading-tight font-bold">
                    {missing} {missing === 1 ? "score is" : "scores are"} missing
                  </p>
                  <p className="mt-2 max-w-xl text-[15px] leading-relaxed text-powder">
                    The results PDF needs every judge&apos;s score for every entry. Reopen the session so the remaining judges can score.
                  </p>
                </>
              )}
            </div>
            {progress.complete && (
              <div className="flex flex-wrap items-center gap-x-6 gap-y-3 border-t border-oxford px-6 py-4">
                <DownloadResults activityId={activity.id} className="btn bg-mint text-prussian hover:bg-white" />
                {signatories && (
                  <p className="min-w-56 flex-1 text-sm leading-relaxed text-powder">
                    {signatories.length > 0
                      ? `Signature lines: ${list.format(signatories.map((s) => (s.designation ? `${s.name} (${s.designation})` : s.name)))}.`
                      : "No signatories yet, so the PDF prints one blank Tabulator line."}{" "}
                    <Link href="/admin/profile" className="font-semibold text-mint underline underline-offset-2">
                      Edit signatories
                    </Link>
                  </p>
                )}
              </div>
            )}
          </section>
        )}
      </div>

      {runningOrder(false)}

      <section aria-labelledby="live-results">
        <h2 id="live-results" className="font-bold">
          Public live results
        </h2>
        <LinkField url={liveUrl} openLabel="live results" className="mt-3" />
        <div className="mt-5 flex flex-wrap items-start gap-x-10 gap-y-6">
          <Qr svg={liveQr} label="QR code for the live results page" />
          <div className="min-w-60 flex-1 pt-1">
            <RankingSwitch activity={activity} />
            <p className="hint mt-2 max-w-sm">With ranks off, entries stay in running order, so you can hold the standings back until the reveal.</p>
          </div>
        </div>
      </section>

      <section aria-labelledby="led-wall">
        <h2 id="led-wall" className="font-bold">
          LED wall
        </h2>
        <LinkField url={ledUrl} openLabel="LED wall" className="mt-3" />
        <p className="hint mt-2">
          Follows the entry being judged, as {activity.ledFullscreen ? "a full-screen scoresheet" : "a lower third on green"} with a{" "}
          {activity.ledTransition === "wipe" ? "wipe" : "fade"}.{activity.ledAnonymous && " Judges stay anonymous."}{" "}
          <Link href={`/admin/${activity.id}?tab=led`} scroll={false} className="text-action">
            Change the display
          </Link>
        </p>
      </section>
    </div>
  );
}
