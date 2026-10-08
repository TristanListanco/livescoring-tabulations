"use client";

import { useOptimistic, useState, useTransition } from "react";
import { LedOutput } from "@/components/led/led-graphic";
import { entryNeighbors } from "@/lib/judging";
import { reach } from "@/lib/reach";
import type { Board, LedTransition } from "@/lib/types";
import { useLiveRefresh } from "@/lib/use-live-refresh";
import { setLedOptions } from "../../actions";
import { FormMessage } from "../form-message";
import { LinkField } from "../link-field";
import { Switch } from "../switch";

type LedOptions = { fullscreen: boolean; holdScores: boolean; transition: LedTransition; anonymous: boolean };

/** Display mode, animation, whether scores wait for every judge, and whether judges stay anonymous. Saves on change; the wall follows within seconds. */
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
            <label key={m.label} className="choice items-center font-semibold">
              <input
                type="radio"
                name="led-display"
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
            <label key={a.transition} className="choice items-center font-semibold">
              <input
                type="radio"
                name="led-transition"
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
        <Switch checked={options.holdScores} onChange={(holdScores) => onChange({ holdScores })} labelledBy="hold-label" disabled={disabled} />
        <p id="hold-label" className="font-semibold">
          Show scores only when every judge has scored
        </p>
      </div>
      <div className="flex items-start gap-4">
        <Switch checked={options.anonymous} onChange={(anonymous) => onChange({ anonymous })} labelledBy="anonymous-label" disabled={disabled} />
        <div>
          <p id="anonymous-label" className="font-semibold">
            Keep judges anonymous
          </p>
          <p className="hint">Each judge&apos;s name and photo on the wall becomes a ?.</p>
        </div>
      </div>
    </div>
  );
}

export function LedTab({ board, ledUrl }: { board: Board; ledUrl: string }) {
  useLiveRefresh(board.activity.id, undefined, board.activity.kind === "pageant");
  const { activity, entries } = board;
  const [options, setOptions] = useOptimistic<LedOptions, Partial<LedOptions>>(
    { fullscreen: activity.ledFullscreen, holdScores: activity.ledHoldScores, transition: activity.ledTransition, anonymous: activity.ledAnonymous },
    (current, change) => ({ ...current, ...change }),
  );
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const changeOptions = (change: Partial<LedOptions>) =>
    startTransition(async () => {
      setOptions(change);
      const result = await reach(() => setLedOptions(activity.id, change));
      setError(result.ok ? null : result.error);
    });

  const { index, entry: current } = entryNeighbors(entries, activity.ledEntryId);
  const preview: Board = {
    ...board,
    activity: {
      ...activity,
      ledFullscreen: options.fullscreen,
      ledHoldScores: options.holdScores,
      ledTransition: options.transition,
      ledAnonymous: options.anonymous,
    },
  };

  return (
    <div className="space-y-8">
      <div>
        <h2 className="text-xl font-bold">LED wall</h2>
        <LinkField url={ledUrl} openLabel="LED wall" className="mt-4" />
      </div>

      <DisplaySettings options={options} onChange={changeOptions} disabled={pending} />
      <FormMessage state={error ? { ok: false, error } : null} small />

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
