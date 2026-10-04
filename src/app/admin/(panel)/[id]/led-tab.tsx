"use client";

import { useOptimistic, useState, useTransition } from "react";
import { CopyButton } from "@/components/copy-button";
import { FitStage } from "@/components/led/fit-stage";
import { LedGraphic } from "@/components/led/led-graphic";
import type { Board } from "@/lib/types";
import { useLiveRefresh } from "@/lib/use-live-refresh";
import { setLedEntry } from "../../actions";

export function LedTab({ board, ledUrl }: { board: Board; ledUrl: string }) {
  useLiveRefresh(board.activity.id);
  const { activity, entries, judges, scores } = board;
  const [onAir, setOnAir] = useOptimistic(activity.ledEntryId);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const take = (entryId: string | null) =>
    startTransition(async () => {
      setOnAir(entryId);
      const result = await setLedEntry(activity.id, entryId);
      setError(result.ok ? null : result.error);
    });

  const index = entries.findIndex((e) => e.id === onAir);
  const current = index >= 0 ? entries[index] : null;
  const previous = index > 0 ? entries[index - 1] : null;
  const next = index < 0 ? entries[0] : entries[index + 1];
  const scoredFor = (entryId: string) => scores.filter((s) => s.entryId === entryId).length;
  const preview: Board = { ...board, activity: { ...activity, ledEntryId: onAir } };

  return (
    <div className="space-y-8">
      <div>
        <h2 className="text-xl font-bold">LED wall</h2>
        <p className="hint mt-1 max-w-2xl">
          Open this link full screen on the computer that feeds the LED wall or video switcher. Key out the green (#00FF00) to lay the
          scores over the camera shot. You choose which entry it shows here.
        </p>
        <div className="mt-4 flex max-w-2xl items-center gap-2">
          <code className="tabular min-w-0 flex-1 truncate rounded-lg border border-line bg-white px-3 py-2.5 text-[15px]">{ledUrl}</code>
          <CopyButton value={ledUrl} />
          <a href={ledUrl} target="_blank" rel="noreferrer" className="btn btn-quiet btn-sm">
            Open
          </a>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_18rem]">
        <figure>
          <FitStage className="aspect-video w-full rounded-lg ring-1 ring-line">
            <LedGraphic board={preview} ranked={activity.showRank} />
          </FitStage>
          <figcaption className="hint mt-2">Preview of the LED wall, updating live.</figcaption>
        </figure>

        <div className="space-y-4">
          <div className={`rounded-xl px-4 py-4 ${current ? "bg-regal text-mint" : "border border-dashed border-field"}`}>
            <p className={`text-sm font-semibold ${current ? "text-mint/80" : "text-prussian/70"}`}>On the LED wall</p>
            {current ? (
              <p className="mt-1 text-lg leading-snug font-bold">
                <span className="tabular">No. {index + 1}</span> {current.name}
              </p>
            ) : (
              <p className="mt-1 font-semibold">Nothing. The wall shows only green.</p>
            )}
          </div>
          <div className="grid grid-cols-2 gap-2">
            <button type="button" className="btn btn-quiet" onClick={() => previous && take(previous.id)} disabled={!previous || pending}>
              Previous
            </button>
            <button type="button" className="btn btn-primary" onClick={() => next && take(next.id)} disabled={!next || pending}>
              {current ? "Next" : "Show first"}
            </button>
          </div>
          <button type="button" className="btn btn-quiet w-full" onClick={() => take(null)} disabled={!current || pending}>
            Clear screen
          </button>
          {error && (
            <p role="alert" className="text-sm font-semibold text-danger">
              {error}
            </p>
          )}
        </div>
      </div>

      <div>
        <h3 className="font-bold">Running order</h3>
        {entries.length === 0 ? (
          <p className="hint mt-2">Add entries in the Entries tab first.</p>
        ) : (
          <ol className="mt-3 divide-y divide-line border-y border-line">
            {entries.map((e, i) => {
              const live = e.id === onAir;
              return (
                <li key={e.id} className={`flex items-center gap-4 px-3 py-3 ${live ? "bg-white" : ""}`}>
                  <span className="tabular w-8 text-right font-semibold text-prussian/70">{i + 1}</span>
                  <span className="min-w-0 flex-1 truncate font-semibold">{e.name}</span>
                  <span className="tabular hint hidden sm:inline">
                    {scoredFor(e.id)} of {judges.length} scores
                  </span>
                  {live ? (
                    <span className="inline-flex h-9 items-center gap-2 rounded-md bg-regal px-3 text-sm font-semibold text-mint">
                      <span className="size-2 rounded-full bg-mint" aria-hidden />
                      On air
                    </span>
                  ) : (
                    <button type="button" className="btn btn-quiet btn-sm" onClick={() => take(e.id)} disabled={pending}>
                      Show
                    </button>
                  )}
                </li>
              );
            })}
          </ol>
        )}
      </div>
    </div>
  );
}
