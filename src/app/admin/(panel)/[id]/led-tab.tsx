"use client";

import { useOptimistic, useState, useTransition } from "react";
import { CopyButton } from "@/components/copy-button";
import { entryNeighbors } from "@/lib/judging";
import { LedOutput } from "@/components/led/led-graphic";
import type { Board } from "@/lib/types";
import { useLiveRefresh } from "@/lib/use-live-refresh";
import { setLedOptions } from "../../actions";

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
          <span
            className={`inline-block size-5 rounded-full shadow transition-transform ${options.holdScores ? "translate-x-5.5 bg-mint" : "translate-x-0.5 bg-field"}`}
          />
        </button>
        <div>
          <p id="hold-label" className="font-semibold">
            Show scores only when every judge has scored
          </p>
          <p id="hold-hint" className="hint mt-0.5 max-w-xl">
            Until then each judge&apos;s tile shows that they&apos;ve scored, without the number. All scores and the average appear together once the
            last judge submits.
          </p>
        </div>
      </div>
    </div>
  );
}

export function LedTab({ board, ledUrl }: { board: Board; ledUrl: string }) {
  useLiveRefresh(board.activity.id);
  const { activity, entries } = board;
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

  const { index, entry: current } = entryNeighbors(entries, activity.ledEntryId);
  const preview: Board = { ...board, activity: { ...activity, ledFullscreen: options.fullscreen, ledHoldScores: options.holdScores } };

  return (
    <div className="space-y-8">
      <div>
        <h2 className="text-xl font-bold">LED wall</h2>
        <p className="hint mt-1 max-w-2xl">
          Open this link full screen on the computer that feeds the LED wall or video switcher. It shows each entry as you, or the chair of the board
          of judges, show it to the judges in the Session tab.
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
      {error && (
        <p role="alert" className="text-sm font-semibold text-danger">
          {error}
        </p>
      )}

      <figure className="max-w-4xl">
        {/* The preview keeps the wall's own colours in dark mode. */}
        <LedOutput board={preview} className="keep-light aspect-video w-full rounded-lg ring-1 ring-line" />
        <figcaption className="hint mt-2">
          Preview of the LED wall, updating live.{" "}
          {current ? (
            <>
              Showing <span className="tabular">No. {index + 1}</span> {current.name}.
            </>
          ) : options.fullscreen ? (
            "No entry yet: the wall shows the activity name."
          ) : (
            "No entry yet: the wall shows only green."
          )}
        </figcaption>
      </figure>
    </div>
  );
}
