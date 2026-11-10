"use client";

import { useEffect, useOptimistic, useState, useTransition } from "react";
import { LedOutput } from "@/components/led/led-graphic";
import { LED_FONT_VARIABLES } from "@/components/led/led-fonts";
import { LED_FONTS, LED_LAYOUTS, LED_SHAPES, LED_THEMES, ledFontFamily, type LedFont, type LedLayout, type LedShape, type LedTheme } from "@/lib/led-style";
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
  layout: LedLayout;
};

/** A choice's radio, unseen over its whole label: the label is drawn as the control, and a tap anywhere on it is the radio's. */
const COVER = "absolute inset-0 size-full cursor-pointer appearance-none opacity-0 disabled:cursor-not-allowed";

/** One of a few choices, side by side in a pill, the chosen one filled: Display, Layout and Corners. */
function Segmented<T extends string | boolean>({
  legend,
  name,
  options,
  value,
  onChange,
  disabled,
}: {
  legend: string;
  name: string;
  options: { value: T; label: string; icon?: React.ReactNode }[];
  value: T;
  onChange: (value: T) => void;
  disabled: boolean;
}) {
  return (
    <fieldset className="min-w-0">
      <legend className="label">{legend}</legend>
      <div className="flex rounded-full border border-line bg-white p-1">
        {options.map((o) => (
          <label
            key={String(o.value)}
            className="relative flex h-9 min-w-0 flex-1 cursor-pointer items-center justify-center gap-1.5 rounded-full px-2.5 text-sm font-semibold whitespace-nowrap text-prussian/80 transition-colors hover:text-prussian has-checked:bg-regal has-checked:text-mint has-focus-visible:outline-3 has-focus-visible:outline-offset-2 has-focus-visible:outline-regal has-disabled:cursor-not-allowed pointer-coarse:h-11"
          >
            <input type="radio" name={name} className={COVER} checked={value === o.value} onChange={() => onChange(o.value)} disabled={disabled} />
            {o.icon}
            {o.label}
          </label>
        ))}
      </div>
    </fieldset>
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

/** A font drawn as a tile, its sample over its name: the tile is the target, filled when chosen (see .choice). */
const TILE = "choice relative flex-col items-stretch gap-1.5 px-1.5 pt-1.5 pb-2 text-center";

/**
 * Everything the wall can be set to, in one compact panel beside the preview: how it's shown (and, as a green screen,
 * which layout), then its colours, font and corners, each choice drawn as what it looks like. Saves on change; the wall
 * follows within seconds. Whether scores wait for every judge, and whether judges stay anonymous, are with the
 * activity's other settings (they change the live results too).
 */
function WallSettings({ options, onChange, disabled }: { options: LedOptions; onChange: (next: Partial<LedOptions>) => void; disabled: boolean }) {
  return (
    <div className="space-y-6">
      <div className="grid gap-x-4 gap-y-5 sm:grid-cols-2">
        <Segmented
          legend="Display"
          name="led-display"
          options={[
            { value: false, label: "Green screen" },
            { value: true, label: "Full screen" },
          ]}
          value={options.fullscreen}
          onChange={(fullscreen) => onChange({ fullscreen })}
          disabled={disabled}
        />
        {/* The full screen has one layout of its own. */}
        {!options.fullscreen && (
          <Segmented legend="Layout" name="led-layout" options={LED_LAYOUTS} value={options.layout} onChange={(layout) => onChange({ layout })} disabled={disabled} />
        )}
      </div>
      <fieldset>
        {/* Swatches alone, so all thirteen fit in two rows: the chosen one is named beside the legend, every one on hover. */}
        <legend className="label">
          Colour{" "}
          <span aria-hidden className="font-normal text-prussian/75">
            · {LED_THEMES.find((t) => t.value === options.theme)?.label}
          </span>
        </legend>
        <div className="grid grid-cols-7 gap-1.5">
          {LED_THEMES.map((t) => (
            <label key={t.value} title={t.label} className="choice relative p-1">
              <input type="radio" name="led-theme" className={COVER} checked={options.theme === t.value} onChange={() => onChange({ theme: t.value })} disabled={disabled} />
              <span className="sr-only">{t.label}</span>
              {/* The bar in the theme: its text on its base, and its highlight. */}
              <span aria-hidden className="flex h-9 w-full items-center justify-center gap-1 rounded-lg ring-1 ring-line" style={{ backgroundColor: t.colors.base }}>
                <span className="text-[13px] font-bold" style={{ color: t.colors.ink }}>
                  9.5
                </span>
                <span className="size-2 rounded-full" style={{ backgroundColor: t.colors.muted }} />
              </span>
            </label>
          ))}
        </div>
      </fieldset>
      <fieldset>
        <legend className="label">Font</legend>
        <div className={`grid grid-cols-3 gap-1.5 ${LED_FONT_VARIABLES}`}>
          {LED_FONTS.map((f) => (
            <label key={f.value} className={TILE}>
              <input type="radio" name="led-font" className={COVER} checked={options.font === f.value} onChange={() => onChange({ font: f.value })} disabled={disabled} />
              <span aria-hidden className="text-lg leading-tight font-bold" style={{ fontFamily: ledFontFamily(f.value), fontFeatureSettings: '"lnum" 1' }}>
                Aa 9.75
              </span>
              <span className="text-xs leading-tight font-semibold">{f.label}</span>
            </label>
          ))}
        </div>
      </fieldset>
      <Segmented
        legend="Corners"
        name="led-shape"
        options={LED_SHAPES.map((shape) => ({
          value: shape.value,
          label: shape.label,
          icon: <span aria-hidden className="block h-3.5 w-5 shrink-0 border-2 border-current" style={{ borderRadius: SHAPE_SAMPLE[shape.value] / 2 }} />,
        }))}
        value={options.shape}
        onChange={(shape) => onChange({ shape })}
        disabled={disabled}
      />
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
      layout: activity.ledLayout,
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
      ledLayout: options.layout,
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
      <div className="grid gap-8 xl:grid-cols-[minmax(0,28rem)_minmax(0,1fr)] xl:items-start xl:gap-10">
        <div className="space-y-4">
          <WallSettings options={options} onChange={changeOptions} disabled={pending} />
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
