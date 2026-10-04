"use client";

import { useOptimistic, useState, useTransition } from "react";
import { CopyButton } from "@/components/copy-button";
import { LedOutput } from "@/components/led/led-graphic";
import type { Board } from "@/lib/types";
import { useLiveRefresh } from "@/lib/use-live-refresh";
import { setLedEntry, setLedOptions } from "../../actions";

type LedOptions = { fullscreen: boolean; holdScores: boolean };

/** Full screen or green overlay, and whether scores wait for every judge. Saves on change; the wall follows within seconds. */
function DisplaySettings({ options, onChange, disabled }: { options: LedOptions; onChange: (next: Partial<LedOptions>) => void; disabled: boolean }) {
  const modes = [
    { fullscreen: false, label: "Green screen overlay", hint: "Scores along the bottom; key out the green to lay them over the camera shot." },
    { fullscreen: true, label: "Full screen", hint: "The scoresheet fills the whole screen. No keying needed." },
  ];
  return (
    <div className="space-y-5">
      <fieldset>
        <legend className="label">Display</legend>
        <div className="grid gap-2 sm:grid-cols-2">
          {modes.map((m) => (
            <label
              key={m.label}
              className="flex cursor-pointer gap-3 rounded-lg border border-line bg-white px-4 py-3 has-checked:border-regal has-checked:bg-regal has-checked:text-mint has-disabled:cursor-not-allowed"
            >
              <input
                type="radio"
                name="led-display"
                className="mt-1 accent-mint"
                checked={options.fullscreen === m.fullscreen}
                onChange={() => onChange({ fullscreen: m.fullscreen })}
                disabled={disabled}
              />
              <span>
                <span className="block font-semibold">{m.label}</span>
                <span className="block text-sm opacity-80">{m.hint}</span>
              </span>
            </label>
          ))}
        </div>
      </fieldset>
      <div className="flex items-start gap-4">
        <button
          type="button"
          role="switch"
          aria-checked={options.holdScores}
          aria-labelledby="hold-label"
          aria-describedby="hold-hint"
          onClick={() => onChange({ holdScores: !options.holdScores })}
          disabled={disabled}
          className={`relative mt-0.5 inline-flex h-7 w-12 shrink-0 items-center rounded-full border-2 transition-colors disabled:opacity-60 ${
            options.holdScores ? "border-regal bg-regal" : "border-field bg-white"
          }`}
        >
          <span className={`inline-block size-5 rounded-full shadow transition-transform ${options.holdScores ? "translate-x-5.5 bg-mint" : "translate-x-0.5 bg-field"}`} />
        </button>
        <div>
          <p id="hold-label" className="font-semibold">
            Show scores only when every judge has scored
          </p>
          <p id="hold-hint" className="hint mt-0.5 max-w-xl">
            Until then each judge&apos;s tile shows that they&apos;ve scored, without the number. All scores and the average appear together once the last
            judge submits.
          </p>
        </div>
      </div>
    </div>
  );
}

export function LedTab({ board, ledUrl }: { board: Board; ledUrl: string }) {
  useLiveRefresh(board.activity.id);
  const { activity, entries, judges, scores } = board;
  const [onAir, setOnAir] = useOptimistic(activity.ledEntryId);
  const [options, setOptions] = useOptimistic<LedOptions, Partial<LedOptions>>(
    { fullscreen: activity.ledFullscreen, holdScores: activity.ledHoldScores },
    (current, change) => ({ ...current, ...change }),
  );
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const changeOptions = (change: Partial<LedOptions>) =>
    startTransition(async () => {
      setOptions(change);
      const result = await setLedOptions(activity.id, change);
      setError(result.ok ? null : result.error);
    });

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
  const preview: Board = {
    ...board,
    activity: { ...activity, ledEntryId: onAir, ledFullscreen: options.fullscreen, ledHoldScores: options.holdScores },
  };

  return (
    <div className="space-y-8">
      <div>
        <h2 className="text-xl font-bold">LED wall</h2>
        <p className="hint mt-1 max-w-2xl">
          Open this link full screen on the computer that feeds the LED wall or video switcher. You choose which entry it shows here.
        </p>
        <div className="mt-4 flex max-w-2xl items-center gap-2">
          <code className="tabular min-w-0 flex-1 truncate rounded-lg border border-line bg-white px-3 py-2.5 text-[15px]">{ledUrl}</code>
          <CopyButton value={ledUrl} />
          <a href={ledUrl} target="_blank" rel="noreferrer" className="btn btn-quiet btn-sm">
            Open
          </a>
        </div>
      </div>

      <DisplaySettings options={options} onChange={changeOptions} disabled={pending} />

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_18rem]">
        <figure>
          <LedOutput board={preview} className="aspect-video w-full rounded-lg ring-1 ring-line" />
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
              <p className="mt-1 font-semibold">{options.fullscreen ? "Nothing. The wall shows the activity name." : "Nothing. The wall shows only green."}</p>
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
