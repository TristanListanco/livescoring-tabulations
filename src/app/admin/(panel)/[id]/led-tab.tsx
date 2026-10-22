"use client";

import { useOptimistic, useState, useTransition } from "react";
import { LedOutput } from "@/components/led/led-graphic";
import { LED_FONT_VARIABLES } from "@/components/led/led-fonts";
import { LED_FONTS, LED_SHAPES, LED_THEMES, ledFontFamily, type LedFont, type LedShape, type LedTheme } from "@/lib/led-style";
import { entryNeighbors } from "@/lib/judging";
import { reach } from "@/lib/reach";
import type { Board } from "@/lib/types";
import { JUDGING_OVER, useLiveRefresh } from "@/lib/use-live-refresh";
import { setLedOptions } from "../../actions";
import { FormMessage } from "../form-message";
import { LinkField } from "../link-field";
import { Switch } from "../switch";

type LedOptions = {
  fullscreen: boolean;
  holdScores: boolean;
  anonymous: boolean;
  font: LedFont;
  theme: LedTheme;
  shape: LedShape;
};

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
          <p className="hint">
            On the wall each judge&apos;s name and photo becomes a ?, and on the live results page they&apos;re Judge 1, Judge 2 and so on.
          </p>
        </div>
      </div>
    </div>
  );
}

/** Corner radius for the small shape on each corner choice, in pixels. */
const SHAPE_SAMPLE: Record<LedShape, number> = { square: 0, soft: 6, round: 14 };

/** The wall's look: font, colour theme and corners. Each choice shows what it looks like, and the preview follows. */
function LookSettings({ options, onChange, disabled }: { options: LedOptions; onChange: (next: Partial<LedOptions>) => void; disabled: boolean }) {
  return (
    <div className="space-y-5">
      <fieldset>
        <legend className="label">Font</legend>
        <div className={`flex flex-wrap gap-2 ${LED_FONT_VARIABLES}`}>
          {LED_FONTS.map((f) => (
            <label key={f.value} className="choice items-center">
              <input type="radio" name="led-font" checked={options.font === f.value} onChange={() => onChange({ font: f.value })} disabled={disabled} />
              <span className="flex flex-col">
                <span aria-hidden className="text-xl leading-tight font-bold" style={{ fontFamily: ledFontFamily(f.value), fontFeatureSettings: '"lnum" 1' }}>
                  Aa 9.75
                </span>
                <span className="text-sm font-semibold">{f.label}</span>
              </span>
            </label>
          ))}
        </div>
      </fieldset>
      <fieldset>
        <legend className="label">Colour theme</legend>
        <div className="flex flex-wrap gap-2">
          {LED_THEMES.map((t) => (
            <label key={t.value} className="choice items-center font-semibold">
              <input type="radio" name="led-theme" checked={options.theme === t.value} onChange={() => onChange({ theme: t.value })} disabled={disabled} />
              <span aria-hidden className="flex overflow-hidden rounded-md ring-1 ring-line">
                {[t.colors.base, t.colors.tile, t.colors.accent, t.colors.ink].map((color, i) => (
                  <span key={i} className="block size-5" style={{ backgroundColor: color }} />
                ))}
              </span>
              {t.label}
            </label>
          ))}
        </div>
        <p className="hint mt-2">The green screen stays chroma green with every theme, so it still keys out.</p>
      </fieldset>
      <fieldset>
        <legend className="label">Corners</legend>
        <div className="flex flex-wrap gap-2">
          {LED_SHAPES.map((shape) => (
            <label key={shape.value} className="choice items-center font-semibold">
              <input type="radio" name="led-shape" checked={options.shape === shape.value} onChange={() => onChange({ shape: shape.value })} disabled={disabled} />
              <span aria-hidden className="block h-5 w-8 border-2 border-current" style={{ borderRadius: SHAPE_SAMPLE[shape.value] }} />
              {shape.label}
            </label>
          ))}
        </div>
      </fieldset>
    </div>
  );
}

export function LedTab({ board, ledUrl }: { board: Board; ledUrl: string }) {
  useLiveRefresh(board.activity.id, board.activity.sessionState === "ended" ? JUDGING_OVER : {});
  const { activity, entries } = board;
  const [options, setOptions] = useOptimistic<LedOptions, Partial<LedOptions>>(
    {
      fullscreen: activity.ledFullscreen,
      holdScores: activity.ledHoldScores,
      anonymous: activity.ledAnonymous,
      font: activity.ledFont,
      theme: activity.ledTheme,
      shape: activity.ledShape,
    },
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
      ledAnonymous: options.anonymous,
      ledFont: options.font,
      ledTheme: options.theme,
      ledShape: options.shape,
    },
  };

  // An event without live scoring has no LED wall: its scores stay with the judges until they've signed.
  if (activity.kind === "event" && !activity.liveScoring) {
    return (
      <div className="max-w-2xl">
        <h2 className="text-xl font-bold">LED wall</h2>
        <p role="note" className="note mt-3">
          The LED wall is off for this event. Without live scoring, the scores stay with the judges until they&apos;ve deliberated and signed, so
          there&apos;s nothing to put on the wall. The live results page shows them once they&apos;re signed.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <div>
        <h2 className="text-xl font-bold">LED wall</h2>
        <LinkField url={ledUrl} openLabel="LED wall" className="mt-4" />
      </div>

      {/* Wide enough, the preview stands beside the settings (and stays in view) so each change shows next to its control. */}
      <div className="grid gap-8 lg:grid-cols-[minmax(0,24rem)_minmax(0,1fr)] lg:items-start lg:gap-10">
        <div className="space-y-8">
          <DisplaySettings options={options} onChange={changeOptions} disabled={pending} />
          {/* Set once for a show, so it's folded away. The preview shows what's chosen and follows any change. */}
          <details className="group border-t border-line pt-6">
            <summary className="tap-target flex cursor-pointer list-none flex-wrap items-baseline gap-x-3 gap-y-1 select-none [&::-webkit-details-marker]:hidden">
              <span className="flex items-center gap-2">
                <svg viewBox="0 0 16 16" className="size-4 shrink-0 transition-transform group-open:rotate-90" aria-hidden>
                  <path d="M6 3.5l4.5 4.5L6 12.5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
                <span className="text-lg font-bold">Look</span>
              </span>
            </summary>
            <div className="mt-4 space-y-4">
              <p className="hint">For the green screen and the full screen alike.</p>
              <LookSettings options={options} onChange={changeOptions} disabled={pending} />
            </div>
          </details>
          <FormMessage state={error ? { ok: false, error } : null} small />
        </div>

        <figure className="max-w-4xl lg:sticky lg:top-6">
          {/*
            The preview keeps the wall's own colours in dark mode. It's a picture of the wall, so screen readers hear the
            caption rather than every name and score on it again.
          */}
          <div aria-hidden>
            <LedOutput board={preview} className="keep-light aspect-video w-full rounded-lg ring-1 ring-line" />
          </div>
          <figcaption className="hint mt-2">
            <span className="sr-only">Preview of the LED wall: </span>
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
    </div>
  );
}
