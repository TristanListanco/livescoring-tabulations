"use client";

import { useEffect, useOptimistic, useState, useTransition } from "react";
import { LedOutput } from "@/components/led/led-graphic";
import { LED_FONT_VARIABLES } from "@/components/led/led-fonts";
import { LED_FONTS, LED_SHAPES, LED_THEMES, ledFontFamily, type LedFont, type LedShape, type LedTheme } from "@/lib/led-style";
import { entryNeighbors } from "@/lib/judging";
import { reach } from "@/lib/reach";
import type { Board, Entry, Judge, Score } from "@/lib/types";
import { useMediaQuery } from "@/lib/use-media-query";
import { JUDGING_OVER, useLiveRefresh } from "@/lib/use-live-refresh";
import { setLedOptions } from "../../actions";
import { FormMessage } from "../form-message";
import { LinkField } from "../link-field";

type LedOptions = {
  fullscreen: boolean;
  holdScores: boolean;
  anonymous: boolean;
  font: LedFont;
  theme: LedTheme;
  shape: LedShape;
};

/**
 * Display mode. Saves on change; the wall follows within seconds. Whether scores wait for every judge, and whether judges
 * stay anonymous, are with the activity's other settings (they change the live results too).
 */
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
    </div>
  );
}

/** How long each beat of the sample lasts: nothing yet, then each judge's score, then the average held a moment. */
const SAMPLE_BEAT_MS = 1400;
/** Sample scores, as a share of the way from the lowest score to the highest, judge by judge. */
const SAMPLE_SHARES = [0.86, 0.92, 0.81, 0.95, 0.88, 0.84, 0.9];

/**
 * Before the show, the preview plays what the wall does once judging starts: the first entry comes up, each judge's
 * score arrives in turn (or "Scored", when scores wait for every judge), then the average, and it starts again. With the
 * activity's own entries and judges where it has them, and the look chosen; the scores are made up. With reduced motion,
 * it stays on the finished entry.
 */
function useSample(board: Board, playing: boolean): Board {
  const { activity } = board;
  const still = useMediaQuery("(prefers-reduced-motion: reduce)");
  const judges: Judge[] = board.judges.length
    ? board.judges
    : ["Judge 1", "Judge 2", "Judge 3"].map((name, position) => ({ id: `sample-${position}`, name, firstName: name, lastName: null, photoUrl: null, position, isChair: false, panel: "all" }));
  const entry: Entry = board.entries[0] ?? { id: "sample-entry", name: "Your first entry", photoUrl: null, position: 0 };
  const beats = judges.length + 3;
  const [beat, setBeat] = useState(0);
  useEffect(() => {
    if (!playing || still) return;
    const timer = setInterval(() => setBeat((b) => (b + 1) % beats), SAMPLE_BEAT_MS);
    return () => clearInterval(timer);
  }, [playing, still, beats]);
  if (!playing) return board;

  const criteria = activity.scoringMode === "criteria";
  const [low, high] = criteria ? [0, 100] : [activity.min, activity.max];
  const round = (n: number) => Number(n.toFixed(activity.decimals));
  const scored = still ? judges.length : Math.min(beat, judges.length);
  const scores: Score[] = judges
    .slice(0, scored)
    .map((j, i) => ({ entryId: entry.id, judgeId: j.id, value: round(low + (high - low) * SAMPLE_SHARES[i % SAMPLE_SHARES.length]) }));
  return { ...board, judges, entries: board.entries.length ? board.entries : [entry], scores, activity: { ...activity, ledEntryId: entry.id } };
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
  // Before the session starts, an event's preview plays a sample of the wall at work (a pageant's shows its program).
  const sampling = activity.sessionState === "draft" && activity.kind === "event";
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

  const shown = useSample(preview, sampling);

  return (
    <div className="space-y-8">
      <div>
        <h2 className="sr-only">LED wall</h2>
        <LinkField url={ledUrl} openLabel="LED wall" className="mt-4" />
      </div>

      {/* Wide enough, the preview stands beside the settings (and stays in view) so each change shows next to its control. */}
      <div className="grid gap-8 xl:grid-cols-[minmax(0,24rem)_minmax(0,1fr)] xl:items-start xl:gap-10">
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
              <LookSettings options={options} onChange={changeOptions} disabled={pending} />
            </div>
          </details>
          <FormMessage state={error ? { ok: false, error } : null} small />
        </div>

        <figure className="max-w-4xl xl:sticky xl:top-6">
          {/*
            The preview keeps the wall's own colours in dark mode. It's a picture of the wall, so screen readers hear the
            caption rather than every name and score on it again.
          */}
          <div aria-hidden>
            <LedOutput board={shown} className="keep-light aspect-video w-full rounded-lg ring-1 ring-line" />
          </div>
          <figcaption className="hint mt-2">
            <span className="sr-only">Preview of the LED wall: </span>
            {sampling ? (
              <>
                <span className="font-semibold text-prussian">A sample, with made-up scores:</span> once the session starts, the wall follows the entry
                you show and fills in as the judges score.
              </>
            ) : current ? (
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
