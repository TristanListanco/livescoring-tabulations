"use client";

import { KEY_GREEN, ledScene, type LedScene, type TileState } from "@/lib/led";
import { ledStyle } from "@/lib/led-style";
import { showingBoard } from "@/lib/pageant";
import { averageText, scoreText } from "@/lib/scoring";
import type { Activity, Board, Judge } from "@/lib/types";
import { Avatar } from "../avatar";
import { FitText } from "../fit-text";
import { FitStage } from "./fit-stage";
import { LED_FONT_VARIABLES } from "./led-fonts";

function WaitingDots({ label }: { label: string }) {
  return (
    <span className="inline-flex h-[1em] items-center gap-[0.18em] text-powder">
      <span className="sr-only">{label}</span>
      <span className="led-dot size-[0.16em] rounded-full bg-current" />
      <span className="led-dot size-[0.16em] rounded-full bg-current [animation-delay:.2s]" />
      <span className="led-dot size-[0.16em] rounded-full bg-current [animation-delay:.4s]" />
    </span>
  );
}

/**
 * A judge kept anonymous: a "?" in the same circle a photo or initials would fill, drawn (not typed) so it
 * matches the wall's other marks and scales with any tile.
 */
function AnonymousJudge({ size, radius }: { size: number | string; radius?: string }) {
  return (
    <span aria-hidden style={{ width: size, height: size, borderRadius: radius }} className="inline-flex shrink-0 items-center justify-center rounded-full bg-regal text-mint">
      <svg viewBox="0 0 24 24" className="size-[58%]">
        <path d="M8.6 9a3.4 3.4 0 1 1 5.3 2.8c-1.1.75-1.9 1.4-1.9 2.9v.4" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
        <circle cx="12" cy="19" r="1.5" fill="currentColor" />
      </svg>
    </span>
  );
}

/** The entry's photo beside its name, with the wall's corners. */
function EntryPhoto({ src, style, className = "" }: { src: string; style?: React.CSSProperties; className?: string }) {
  // Photos are already resized to small squares on upload, so the optimizer adds nothing here.
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={src} alt="" data-entry-photo style={{ borderRadius: ROUNDED, ...style }} className={`shrink-0 object-cover ${className}`} />;
}

/** The corner radius chosen on the LED tab (--led-radius, set on the wall's root). */
const ROUNDED = "var(--led-radius, 0px)";

/**
 * A judge's score, a "scored" mark while scores are held back, or dots while they're still deciding. Each state
 * fades in. Scores shrink to fit their tile, so long percentages and extra decimal places never overflow it.
 */
function TileValue({
  judge,
  state,
  value,
  activity,
  align = "start",
}: {
  judge: Judge;
  state: TileState;
  value: number | null;
  activity: Activity;
  align?: "start" | "center";
}) {
  if (state === "waiting") return <WaitingDots key={`${judge.id}-waiting`} label="Waiting for score" />;
  if (state === "submitted") {
    return (
      <span key={`${judge.id}-submitted`} className="led-fade inline-flex h-[1em] items-center gap-[0.15em] text-powder">
        <svg viewBox="0 0 16 16" className="size-[0.55em]" aria-hidden>
          <path d="M3 8.5l3 3 7-7" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        <span className="text-[0.42em] font-semibold">Scored</span>
      </span>
    );
  }
  return (
    <FitText key={`${judge.id}-shown`} className="led-fade tabular leading-none font-bold" align={align}>
      {scoreText(value ?? 0, activity)}
    </FitText>
  );
}

// Green screen ------------------------------------------------------------------

/**
 * Sizes for the photos layout: the judges' photos and type shrink as the panel grows, so every judge keeps a column.
 * `photo` is a judge's square photo; the entry's round one stays the same.
 */
function photoSizes(judgeCount: number) {
  if (judgeCount <= 5) return { photo: 104, name: 20, score: 60, nameBlock: 520, average: 240 };
  if (judgeCount <= 8) return { photo: 88, name: 18, score: 54, nameBlock: 440, average: 220 };
  if (judgeCount <= 12) return { photo: 70, name: 16, score: 46, nameBlock: 360, average: 200 };
  return { photo: 54, name: 14, score: 40, nameBlock: 300, average: 180 };
}

/** The bar's height, and the entry's round photo above its left end, on the 1920×1080 stage. */
const PHOTO_BAR = 128;
const ENTRY_CIRCLE = 208;
/** How far the entry's circle comes down into the bar. */
const CIRCLE_DIP = 26;
/** The bar's corners: on a bar this tall, the "Rounded" choice makes a capsule. */
const BAR_ROUNDED = "calc(var(--led-radius, 0px) * 2.3)";
/** A judge's photo corners: a little rounded at most, as a photo frame. */
const PHOTO_ROUNDED = "calc(var(--led-radius, 0px) / 3)";

/**
 * A bar chart, the average's mark, standing on the bar's top edge. Solid, like everything over the green: anything
 * see-through would take some of the green with it, and key out in patches.
 */
function AverageMark() {
  return (
    <svg viewBox="0 0 52 40" className="absolute left-1/2 h-[40px] w-[52px] -translate-x-1/2 text-powder" style={{ top: -30 }} aria-hidden>
      <rect x="4" y="22" width="9" height="18" rx="1.5" fill="currentColor" />
      <rect x="16" y="8" width="9" height="32" rx="1.5" fill="currentColor" />
      <rect x="28" y="16" width="9" height="24" rx="1.5" fill="currentColor" />
      <rect x="40" y="2" width="9" height="38" rx="1.5" fill="currentColor" />
    </svg>
  );
}

/**
 * The photos lower third, on a 1920×1080 stage, as a broadcast pageant's: a dark bar along the bottom with the entry's
 * round photo rising above its left end (or its number, without a photo), its name in capitals under it; each judge's
 * photo sitting on the bar's top edge with their first name and score under it; the average at the right, in the
 * theme's highlight. Every shape is solid, in the theme's colours and the corners chosen on the LED tab, so the green
 * around it keys out cleanly.
 */
function PhotoBar({ board, scene, subtitle }: { board: Board; scene: LedScene; subtitle: string }) {
  if (scene.kind === "empty") return null;
  const { activity, judges } = board;
  const size = photoSizes(judges.length);
  const dip = Math.round(size.photo * 0.2);
  const final = scene.average.state === "final";
  const photo = scene.entry.photoUrl;

  return (
    <div
      key={scene.entry.id}
      className="led-fade absolute inset-x-12 bottom-12 flex bg-prussian text-mint"
      style={{ height: PHOTO_BAR, borderRadius: BAR_ROUNDED }}
    >
      {/* The entry: its photo in a ring above the bar (its number in it, without one), its name in the bar below. */}
      <div className="relative flex shrink-0 flex-col justify-end pr-6 pb-4 pl-10" style={{ width: size.nameBlock }}>
        <div className="absolute left-9" style={{ top: CIRCLE_DIP - ENTRY_CIRCLE, width: ENTRY_CIRCLE, height: ENTRY_CIRCLE }}>
          {photo ? (
            <EntryPhoto src={photo} style={{ width: ENTRY_CIRCLE, height: ENTRY_CIRCLE, borderRadius: "50%" }} className="border-[5px] border-powder bg-prussian" />
          ) : (
            <span className="flex size-full flex-col items-center justify-center rounded-full border-[5px] border-powder bg-prussian">
              <span className="text-[26px] leading-none font-semibold text-powder">No.</span>
              <span className="tabular text-[92px] leading-none font-bold">{scene.number}</span>
            </span>
          )}
          {photo && (
            <span className="tabular absolute right-0 bottom-6 flex size-[60px] items-center justify-center rounded-full bg-mint text-[30px] font-bold text-prussian ring-[5px] ring-prussian">
              <span className="sr-only">No. </span>
              {scene.number}
            </span>
          )}
        </div>
        <FitText className="text-[36px] leading-[1.1] font-bold tracking-[0.01em] uppercase" minScale={0.5}>
          {scene.entry.name}
        </FitText>
        {/* What's known about the entry (a school, a town), as the organizer typed it; without it, what's being judged. */}
        <FitText className="mt-0.5 text-[20px] font-semibold tracking-[0.06em] text-powder uppercase" minScale={0.7}>
          {scene.entry.details || subtitle}
        </FitText>
      </div>

      {/* A column per judge: the photo on the bar's edge, then the first name and the score. */}
      <div className="flex min-w-0 flex-1">
        {scene.tiles.map((t) => (
          <div key={t.judge.id} className="relative flex min-w-0 flex-1 flex-col items-center px-1.5 text-center" style={{ paddingTop: dip + 10 }}>
            <div className="absolute left-1/2 -translate-x-1/2" style={{ top: dip - size.photo }}>
              {t.label === null ? (
                <AnonymousJudge size={size.photo} radius={PHOTO_ROUNDED} />
              ) : (
                <Avatar
                  name={t.judge.name}
                  src={t.judge.photoUrl}
                  size={size.photo}
                  radius={PHOTO_ROUNDED}
                  className="border-[3px] border-powder bg-oxford"
                />
              )}
            </div>
            {/*
              The name's row keeps its height whether the name is long (and shrinks), short, or not shown at all, so every
              judge's score sits on the same line. Long names shrink rather than lose their end.
            */}
            <div className="flex w-full items-end" style={{ height: Math.round(size.name * 1.3) }}>
              {t.label !== null && (
                <FitText className="w-full leading-tight font-semibold tracking-[0.06em] text-mint/85 uppercase" style={{ fontSize: size.name }} align="center" minScale={0.4}>
                  {t.label}
                </FitText>
              )}
            </div>
            <div className="mt-1 flex w-full flex-1 items-start justify-center leading-none" style={{ fontSize: size.score }}>
              <div className="w-full">
                <TileValue judge={t.judge} state={t.state} value={t.value} activity={activity} align="center" />
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* The average: its mark on the bar's edge, the word, and the number in the theme's highlight once it's final. */}
      <div className="relative flex shrink-0 flex-col items-center justify-center px-5 pt-3 text-center" style={{ width: size.average }}>
        <AverageMark />
        <span className="text-[17px] leading-none font-semibold tracking-[0.12em] text-mint/85 uppercase">Average</span>
        {scene.average.state === "hidden" ? (
          <p className="mt-2 text-[52px] leading-[0.9]">
            <WaitingDots label="Average appears when every judge has scored" />
          </p>
        ) : (
          <FitText
            key={final ? "final" : "running"}
            className={`tabular mt-1.5 w-full text-[64px] leading-[0.95] font-bold ${final ? "led-fade text-powder" : ""}`}
            align="center"
          >
            {averageText(scene.average.value, activity)}
          </FitText>
        )}
      </div>
    </div>
  );
}

// Full screen -------------------------------------------------------------------

/** The height of the "No." box: its two lines of text and padding. The entry photo beside it matches. */
const NUMBER_BOX = "calc(min(1.8cqw, 3.4cqh) + min(6cqw, 11cqh) + 3cqh)";

/**
 * The scoresheet filling the whole screen. Sizes use container units, so it fills any LED wall
 * shape (16:9, ultra-wide, portrait) and the admin preview alike.
 */
function FullScreen({ board, scene, heading }: { board: Board; scene: LedScene; heading: string }) {
  const { activity } = board;

  if (scene.kind === "empty") {
    return (
      <div key="empty" className="led-fade h-full px-[6cqw] py-[8cqh] text-center">
        <FitText wrap className="h-full text-[length:min(7cqw,13cqh)] leading-tight font-bold tracking-tight text-balance">
          {activity.name}
        </FitText>
      </div>
    );
  }

  const final = scene.average.state === "final";
  const columns = `${scene.tiles.length ? `repeat(${scene.tiles.length}, minmax(0, 1fr)) ` : ""}minmax(0, 1.35fr)`;

  return (
    <div key={scene.entry.id} className="led-fade flex h-full flex-col gap-[3cqh] px-[4cqw] py-[5cqh]">
      <FitText className="text-[length:min(2.2cqw,4cqh)] text-powder" minScale={0.6}>
        {heading}
      </FitText>
      <div className="flex min-w-0 items-stretch gap-[2cqw]">
        <div className="flex shrink-0 flex-col items-center justify-center bg-mint px-[2.2cqw] py-[1.5cqh] text-prussian" style={{ borderRadius: ROUNDED }}>
          <span className="text-[length:min(1.8cqw,3.4cqh)] leading-none font-semibold">No.</span>
          <span className="tabular text-[length:min(6cqw,11cqh)] leading-none font-bold">{scene.number}</span>
        </div>
        {scene.entry.photoUrl && <EntryPhoto src={scene.entry.photoUrl} style={{ width: NUMBER_BOX, height: NUMBER_BOX }} />}
        <div className="flex min-w-0 flex-1 flex-col justify-center">
          <FitText className="text-[length:min(8cqw,15cqh)] leading-[1.05] font-bold tracking-tight" minScale={0.4}>
            {scene.entry.name}
          </FitText>
          {scene.entry.details && (
            <FitText className="mt-[0.6cqh] text-[length:min(2.8cqw,5cqh)] font-semibold text-powder" minScale={0.6}>
              {scene.entry.details}
            </FitText>
          )}
        </div>
      </div>
      <div className="h-[0.6cqh] rounded-full bg-powder" />

      <div className="grid min-h-0 flex-1 gap-[0.4cqw]" style={{ gridTemplateColumns: columns }}>
        {scene.tiles.map((t) => (
          <div
            key={t.judge.id}
            className="flex min-w-0 flex-col items-center justify-center gap-[2cqh] bg-oxford px-[1.2cqw]"
            style={{ containerType: "inline-size", borderRadius: ROUNDED }}
          >
            {t.label === null ? (
              <AnonymousJudge size="min(40cqi, 24cqh)" />
            ) : (
              <>
                <Avatar name={t.judge.name} src={t.judge.photoUrl} size="min(40cqi, 24cqh)" />
                <FitText className="w-full text-[length:min(11cqi,3.6cqh)] font-semibold" align="center" minScale={0.4}>
                  {t.label}
                </FitText>
              </>
            )}
            <div className="w-full text-center text-[length:min(30cqi,14cqh)]">
              <TileValue judge={t.judge} state={t.state} value={t.value} activity={activity} align="center" />
            </div>
          </div>
        ))}

        <div
          key={final ? "final" : "running"}
          className={`flex min-w-0 flex-col items-center justify-center gap-[1.5cqh] px-[1.2cqw] text-center ${final ? "led-fade bg-mint text-prussian" : "bg-regal"}`}
          style={{ containerType: "inline-size", borderRadius: ROUNDED }}
        >
          <span className={`text-[length:min(9cqi,3.6cqh)] font-semibold ${final ? "text-regal" : "text-mint/80"}`}>Average</span>
          {scene.average.state === "hidden" ? (
            <span className="text-[length:min(32cqi,20cqh)] leading-none">
              <WaitingDots label="Average appears when every judge has scored" />
            </span>
          ) : (
            <FitText className="tabular w-full text-[length:min(32cqi,20cqh)] leading-none font-bold" align="center">
              {averageText(scene.average.value, activity)}
            </FitText>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * The LED wall output in the mode chosen in the admin panel, sized to its container, in the look chosen there:
 * its font, colour theme and corners. A pageant shows the sub-activity being judged: its candidates, its scores,
 * and its name under the candidate's.
 */
export function LedOutput({ board: full, className = "" }: { board: Board; className?: string }) {
  const { board, round } = showingBoard(full);
  const scene = ledScene(board);
  const { activity } = board;
  const look = { font: activity.ledFont, theme: activity.ledTheme, shape: activity.ledShape };
  if (activity.ledFullscreen) {
    return (
      <div
        data-led-theme={activity.ledTheme}
        className={`relative overflow-hidden bg-prussian text-mint ${LED_FONT_VARIABLES} ${className}`}
        style={{ containerType: "size", ...ledStyle(look, true) }}
      >
        <FullScreen board={board} scene={scene} heading={round ? `${activity.name} · ${round.name}` : activity.name} />
      </div>
    );
  }
  return (
    <FitStage className={className} background={KEY_GREEN}>
      {/* The look goes on this wrapper: it lays out as its children, but they still take its colours and font. */}
      <div data-led-theme={activity.ledTheme} className={`contents ${LED_FONT_VARIABLES}`} style={ledStyle(look, false)}>
        <PhotoBar board={board} scene={scene} subtitle={round?.name ?? activity.name} />
      </div>
    </FitStage>
  );
}
