"use client";

import { useOptimistic, useState, useTransition } from "react";
import { Avatar } from "@/components/avatar";
import { CopyButton } from "@/components/copy-button";
import { Qr } from "@/components/qr";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { entryNeighbors } from "@/lib/judging";
import type { ActionResult, Board, SessionState } from "@/lib/types";
import { useLiveRefresh } from "@/lib/use-live-refresh";
import { setCurrentEntry, setSessionState } from "../../actions";

const STATE_LABEL: Record<SessionState, string> = { draft: "Not started", live: "Live", ended: "Ended" };

export function SessionTab({ board, liveUrl, liveQr }: { board: Board; liveUrl: string; liveQr: string }) {
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
  const changeState = async (state: "live" | "ended", password?: string) => {
    const r = await setSessionState(activity.id, state, password);
    // A wrong password shows in the dialog, which stays open.
    if (r.ok || state !== "ended") setResult(r);
    return r;
  };

  const { index, entry, previous, next } = entryNeighbors(entries, current);
  const scoredBy = new Set(scores.filter((s) => s.entryId === entry?.id).map((s) => s.judgeId));
  const allIn = entry !== null && judges.length > 0 && judges.every((j) => scoredBy.has(j.id));
  const live = activity.sessionState === "live";
  const scoreCount = (entryId: string) => scores.filter((s) => s.entryId === entryId).length;

  return (
    <div className="max-w-4xl space-y-8">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <p className="flex items-center gap-2.5 text-lg font-bold">
          <span
            aria-hidden
            className={`size-3 rounded-full ${live ? "bg-regal ring-4 ring-regal/20" : activity.sessionState === "ended" ? "bg-prussian/40" : "border-2 border-field"}`}
          />
          Session: {STATE_LABEL[activity.sessionState]}
        </p>
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
            passwordLabel="Your password"
            onConfirm={(password) => changeState("ended", password)}
          >
            Judges won&apos;t be able to submit any more scores, and entries can&apos;t be changed. Enter your admin password to confirm. You can
            reopen the session if you need to.
          </ConfirmDialog>
        )}
        {activity.sessionState === "ended" && (
          <button
            type="button"
            className="btn btn-quiet"
            disabled={pending}
            onClick={() => startTransition(async () => void (await changeState("live")))}
          >
            Reopen session
          </button>
        )}
      </div>

      {result && (
        <p role={result.ok ? "status" : "alert"} className={result.ok ? "text-regal" : "font-semibold text-danger"}>
          {result.ok ? result.message : result.error}
        </p>
      )}

      {live && (
        // The control desk: what judges see now, who has scored, and where to go next. It looks like the judges'
        // screens, so it keeps their colours in dark mode.
        <section aria-labelledby="now-judging" className="keep-light overflow-hidden rounded-2xl bg-prussian text-mint">
          <div className="px-6 pt-6 pb-5">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div className="min-w-0">
                <h2 id="now-judging" className="text-powder">
                  {entry ? `Now judging: No. ${index + 1} of ${entries.length}` : "On judges' screens"}
                </h2>
                <p className="mt-1 text-[clamp(1.6rem,3vw,2.25rem)] leading-tight font-bold text-balance">
                  {entry ? entry.name : "Judges are waiting for an entry"}
                </p>
              </div>
              {entry && activity.ledEntryId === entry.id && (
                <span className="rounded-md border border-oxford px-3 py-1.5 text-sm font-semibold text-powder">On the LED wall</span>
              )}
            </div>

            {entry && (
              <ul className="mt-5 grid gap-2 sm:grid-cols-2">
                {judges.map((j) => {
                  const done = scoredBy.has(j.id);
                  return (
                    <li key={j.id} className="flex items-center gap-3 rounded-xl bg-oxford px-3 py-2.5">
                      <Avatar name={j.name} src={j.photoUrl} size={36} />
                      <span className="min-w-0 flex-1 truncate font-semibold">{j.name}</span>
                      {j.isChair && <span className="text-xs font-semibold text-powder">Chair</span>}
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
            )}
          </div>

          <div className="flex flex-wrap items-center gap-3 border-t border-oxford px-6 py-4">
            <p role="status" className="min-w-48 flex-1 font-semibold">
              {entry &&
                (allIn
                  ? next
                    ? `Every judge has scored ${entry.name}.`
                    : `Every judge has scored ${entry.name}. That was the last entry: end the session when you're ready.`
                  : `${scoredBy.size} of ${judges.length} judges have scored.`)}
            </p>
            <button
              type="button"
              className="btn border border-oxford text-mint hover:bg-oxford"
              onClick={() => previous && show(previous.id)}
              disabled={!previous || pending}
            >
              Previous entry
            </button>
            <button
              type="button"
              className={`btn min-w-0 ${allIn || !entry ? "bg-mint text-prussian hover:bg-white" : "border border-powder/60 text-mint hover:bg-oxford"}`}
              onClick={() => next && show(next.id)}
              disabled={!next || pending}
            >
              <span className="truncate">{entry ? (next ? `Show next entry: ${next.name}` : "No more entries") : "Show first entry"}</span>
            </button>
          </div>
        </section>
      )}

      {entries.length > 0 && (
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
                  {activity.sessionState === "draft" ? null : activity.sessionState === "ended" ? (
                    // Judging is over: no "now judging" or "judge now" to suggest otherwise.
                    <span className="inline-flex h-9 items-center px-3 text-sm font-semibold text-prussian/80">
                      {scoreCount(e.id) > 0 ? "Judged" : "Not judged"}
                    </span>
                  ) : now ? (
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

      <section aria-labelledby="live-results">
        <h2 id="live-results" className="font-bold">
          Public live results
        </h2>
        <div className="mt-3 flex max-w-2xl items-center gap-2">
          <code className="tabular min-w-0 flex-1 truncate rounded-lg border border-line bg-white px-3 py-2.5 text-[15px]">{liveUrl}</code>
          <CopyButton value={liveUrl} />
        </div>
        <div className="mt-4">
          <Qr svg={liveQr} label="QR code for the live results page" />
        </div>
      </section>
    </div>
  );
}
