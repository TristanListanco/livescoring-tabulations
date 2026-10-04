"use client";

import { useOptimistic, useState, useTransition } from "react";
import { CopyButton } from "@/components/copy-button";
import { LedOutput } from "@/components/led/led-graphic";
import { entryNeighbors } from "@/lib/judging";
import type { Board, LedTransition } from "@/lib/types";
import { useLiveRefresh } from "@/lib/use-live-refresh";
import { setLedOptions } from "../../actions";

type LedOptions = { fullscreen: boolean; holdScores: boolean; transition: LedTransition };

const choice =
  "flex cursor-pointer items-center gap-2.5 rounded-lg border border-line bg-white px-3.5 py-2.5 font-semibold has-checked:border-regal has-checked:bg-regal has-checked:text-mint has-disabled:cursor-not-allowed";

/** Display mode, animation, and whether scores wait for every judge. Saves on change; the wall follows within seconds. */
function DisplaySettings({ options, onChange, disabled }: { options: LedOptions; onChange: (next: Partial<LedOptions>) => void; disabled: boolean }) {
  return (
    <div className="space-y-5">
      <fieldset>
        <legend className="label">Display</legend>
        <div className="flex flex-wrap gap-2">
          {[
            { fullscreen: false, label: "Green screen overlay" },
            { fullscreen: true, label: "Full screen" },
          ].map((m) => (
            <label key={m.label} className={choice}>
              <input
                type="radio"
                name="led-display"
                className="accent-mint"
                checked={options.fullscreen === m.fullscreen}
                onChange={() => onChange({ fullscreen: m.fullscreen })}
                disabled={disabled}
              />
              {m.label}
            </label>
          ))}
        </div>
      </fieldset>
      <fieldset>
        <legend className="label">Animation</legend>
        <div className="flex flex-wrap gap-2">
          {(
            [
              { transition: "fade", label: "Fade" },
              { transition: "wipe", label: "Wipe" },
            ] as const
          ).map((a) => (
            <label key={a.transition} className={choice}>
              <input
                type="radio"
                name="led-transition"
                className="accent-mint"
                checked={options.transition === a.transition}
                onChange={() => onChange({ transition: a.transition })}
                disabled={disabled}
              />
              {a.label}
            </label>
          ))}
        </div>
      </fieldset>
      <div className="flex items-center gap-4">
        <button
          type="button"
          role="switch"
          aria-checked={options.holdScores}
          aria-labelledby="hold-label"
          onClick={() => onChange({ holdScores: !options.holdScores })}
          disabled={disabled}
          className={`relative inline-flex h-7 w-12 shrink-0 items-center rounded-full border-2 transition-colors disabled:opacity-60 ${
            options.holdScores ? "border-regal bg-regal" : "border-field bg-white"
          }`}
        >
          <span
            className={`inline-block size-5 rounded-full shadow transition-transform ${options.holdScores ? "translate-x-5.5 bg-mint" : "translate-x-0.5 bg-field"}`}
          />
        </button>
        <p id="hold-label" className="font-semibold">
          Show scores only when every judge has scored
        </p>
      </div>
    </div>
  );
}

export function LedTab({ board, ledUrl }: { board: Board; ledUrl: string }) {
  useLiveRefresh(board.activity.id);
  const { activity, entries } = board;
  const [options, setOptions] = useOptimistic<LedOptions, Partial<LedOptions>>(
    { fullscreen: activity.ledFullscreen, holdScores: activity.ledHoldScores, transition: activity.ledTransition },
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

  const { index, entry: current } = entryNeighbors(entries, activity.ledEntryId);
  const preview: Board = {
    ...board,
    activity: { ...activity, ledFullscreen: options.fullscreen, ledHoldScores: options.holdScores, ledTransition: options.transition },
  };

  return (
    <div className="space-y-8">
      <div>
        <h2 className="text-xl font-bold">LED wall</h2>
        <div className="mt-4 flex max-w-2xl items-center gap-2">
          <code className="tabular min-w-0 flex-1 truncate rounded-lg border border-line bg-white px-3 py-2.5 text-[15px]">{ledUrl}</code>
          <CopyButton value={ledUrl} />
          <a href={ledUrl} target="_blank" rel="noreferrer" className="btn btn-quiet btn-sm">
            Open
          </a>
        </div>
      </div>

      <DisplaySettings options={options} onChange={changeOptions} disabled={pending} />
      {error && (
        <p role="alert" className="text-sm font-semibold text-danger">
          {error}
        </p>
      )}

      <figure className="max-w-4xl">
        {/* The preview keeps the wall's own colours in dark mode. */}
        <LedOutput board={preview} className="keep-light aspect-video w-full rounded-lg ring-1 ring-line" />
        <figcaption className="hint mt-2">
          {current ? (
            <>
              Showing <span className="tabular">No. {index + 1}</span> {current.name}
            </>
          ) : (
            "No entry yet"
          )}
        </figcaption>
      </figure>
    </div>
  );
}
