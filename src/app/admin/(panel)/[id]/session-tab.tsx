"use client";

import { useOptimistic, useState, useTransition } from "react";
import { Avatar } from "@/components/avatar";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { entryNeighbors } from "@/lib/judging";
import type { ActionResult, Board, SessionState } from "@/lib/types";
import { useLiveRefresh } from "@/lib/use-live-refresh";
import { setCurrentEntry, setLedEntry, setSessionState } from "../../actions";

const STATE_COPY: Record<SessionState, { label: string; body: string }> = {
  draft: {
    label: "Not started",
    body: "Judges who sign in see a waiting screen once you approve their device in the Access tab. Starting the session locks the judges and the running order. You can still add and rename entries.",
  },
  live: { label: "Live", body: "Judges score the entry you show them, one at a time. The LED wall moves to it too." },
  ended: { label: "Ended", body: "Judges can't submit scores. Reopen the session to continue judging." },
};

export function SessionTab({ board }: { board: Board }) {
  useLiveRefresh(board.activity.id);
  const { activity, judges, entries, scores } = board;
  const [current, setCurrent] = useOptimistic(activity.currentEntryId);
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<ActionResult | null>(null);

  const show = (entryId: string | null) =>
    startTransition(async () => {
      setCurrent(entryId);
      const r = await setCurrentEntry(activity.id, entryId);
      setResult(r.ok ? null : r);
    });
  const toLed = (entryId: string) =>
    startTransition(async () => {
      const r = await setLedEntry(activity.id, entryId);
      setResult(r.ok ? { ok: true, message: "It's on the LED wall." } : r);
    });
  const changeState = async (state: "live" | "ended") => {
    const r = await setSessionState(activity.id, state);
    setResult(r);
    return r;
  };

  const { index, entry, previous, next } = entryNeighbors(entries, current);
  const tabulators = judges.filter((j) => j.canMoveEntries);
  const scoredBy = new Set(scores.filter((s) => s.entryId === entry?.id).map((s) => s.judgeId));
  const allIn = entry !== null && judges.length > 0 && judges.every((j) => scoredBy.has(j.id));
  const live = activity.sessionState === "live";
  const scoreCount = (entryId: string) => scores.filter((s) => s.entryId === entryId).length;

  return (
    <div className="max-w-4xl space-y-10">
      <section className="flex flex-wrap items-start justify-between gap-6 rounded-2xl border border-line bg-white/60 p-6">
        <div className="max-w-xl">
          <p className="flex items-center gap-2.5 text-xl font-bold">
            <span
              aria-hidden
              className={`size-3 rounded-full ${live ? "bg-regal ring-4 ring-regal/20" : activity.sessionState === "ended" ? "bg-prussian/40" : "border-2 border-field"}`}
            />
            Session: {STATE_COPY[activity.sessionState].label}
          </p>
          <p className="hint mt-1.5">{STATE_COPY[activity.sessionState].body}</p>
        </div>
        {activity.sessionState === "draft" && (
          <ConfirmDialog
            triggerLabel="Start session"
            triggerClassName="btn btn-primary"
            title="Start judging?"
            confirmLabel="Start session"
            onConfirm={() => changeState("live")}
          >
            Judges&apos; screens open, and the judges and running order lock. You can still add and rename entries. Show the first entry when
            you&apos;re ready.
          </ConfirmDialog>
        )}
        {live && (
          <ConfirmDialog
            triggerLabel="End session"
            triggerClassName="btn btn-quiet"
            title="End the session?"
            tone="danger"
            confirmLabel="End session"
            onConfirm={() => changeState("ended")}
          >
            Judges won&apos;t be able to submit any more scores. You can reopen the session if you need to.
          </ConfirmDialog>
        )}
        {activity.sessionState === "ended" && (
          <button type="button" className="btn btn-quiet" disabled={pending} onClick={() => startTransition(async () => void (await changeState("live")))}>
            Reopen session
          </button>
        )}
      </section>

      {result && (
        <p role={result.ok ? "status" : "alert"} className={result.ok ? "text-regal" : "font-semibold text-danger"}>
          {result.ok ? result.message : result.error}
        </p>
      )}

      {live && (
        <section aria-labelledby="now-judging">
          <h2 id="now-judging" className="text-sm font-semibold text-prussian/70">
            On judges&apos; screens
          </h2>
          {entry ? (
            <div className="mt-2 rounded-2xl bg-prussian p-6 text-mint">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div className="min-w-0">
                  <p className="text-powder">Now judging: No. {index + 1}</p>
                  <p className="mt-0.5 text-3xl leading-tight font-bold text-balance">{entry.name}</p>
                </div>
                {activity.ledEntryId === entry.id ? (
                  <span className="rounded-md border border-oxford px-3 py-1.5 text-sm font-semibold text-powder">On the LED wall</span>
                ) : (
                  <button type="button" className="btn btn-sm border border-oxford text-mint hover:bg-oxford" onClick={() => toLed(entry.id)} disabled={pending}>
                    Put on LED wall
                  </button>
                )}
              </div>

              <ul className="mt-5 grid gap-2 sm:grid-cols-2">
                {judges.map((j) => {
                  const done = scoredBy.has(j.id);
                  return (
                    <li key={j.id} className="flex items-center gap-3 rounded-xl bg-oxford px-3 py-2.5">
                      <Avatar name={j.name} src={j.photoUrl} size={36} />
                      <span className="min-w-0 flex-1 truncate font-semibold">{j.name}</span>
                      {j.canMoveEntries && <span className="text-xs font-semibold text-powder">Moves entries</span>}
                      {done ? (
                        <span className="flex items-center gap-1.5 text-sm font-semibold text-mint">
                          <svg viewBox="0 0 16 16" className="size-4" aria-hidden>
                            <path d="M3 8.5l3 3 7-7" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                          </svg>
                          Scored
                        </span>
                      ) : (
                        <span className="text-sm text-powder">Waiting</span>
                      )}
                    </li>
                  );
                })}
              </ul>

              <p role="status" className="mt-5 font-semibold">
                {allIn
                  ? next
                    ? `Every judge has scored ${entry.name}.`
                    : `Every judge has scored ${entry.name}. That was the last entry: end the session when you're ready.`
                  : `${scoredBy.size} of ${judges.length} judges have scored.`}
              </p>
            </div>
          ) : (
            <div className="mt-2 rounded-2xl border border-dashed border-field px-6 py-8 text-center">
              <p className="font-semibold">Judges are waiting for an entry.</p>
              <p className="hint mt-1">Show the first one when the contestant is ready.</p>
            </div>
          )}

          {tabulators.length > 0 && (
            <p className="hint mt-3">
              {tabulators.map((j) => j.name).join(", ")} can also move entries from {tabulators.length === 1 ? "their" : "their own"} screen
              {tabulators.length === 1 ? "" : "s"}. Change who can in the Judges tab.
            </p>
          )}

          <div className="mt-4 flex flex-wrap gap-2">
            <button type="button" className="btn btn-quiet" onClick={() => previous && show(previous.id)} disabled={!previous || pending}>
              Previous entry
            </button>
            <button
              type="button"
              className={`btn ${allIn || !entry ? "btn-primary" : "btn-quiet"}`}
              onClick={() => next && show(next.id)}
              disabled={!next || pending}
            >
              {entry ? (next ? `Show next entry: ${next.name}` : "No more entries") : "Show first entry"}
            </button>
          </div>
        </section>
      )}

      {activity.sessionState !== "draft" && (
        <section aria-labelledby="running-order">
          <h2 id="running-order" className="font-bold">
            Running order
          </h2>
          <ol className="mt-3 divide-y divide-line border-y border-line">
            {entries.map((e, i) => {
              const now = e.id === current;
              return (
                <li key={e.id} className={`flex items-center gap-4 px-3 py-3 ${now ? "bg-white" : ""}`}>
                  <span className="tabular w-8 text-right font-semibold text-prussian/70">{i + 1}</span>
                  <span className="min-w-0 flex-1 truncate font-semibold">{e.name}</span>
                  <span className="tabular hint hidden sm:inline">
                    {scoreCount(e.id)} of {judges.length} scores
                  </span>
                  {now ? (
                    <span className="inline-flex h-9 items-center gap-2 rounded-md bg-regal px-3 text-sm font-semibold text-mint">Now judging</span>
                  ) : (
                    <button type="button" className="btn btn-quiet btn-sm" onClick={() => show(e.id)} disabled={!live || pending}>
                      Judge now
                    </button>
                  )}
                </li>
              );
            })}
          </ol>
        </section>
      )}
    </div>
  );
}
