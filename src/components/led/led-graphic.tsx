"use client";

import { KEY_GREEN, ledScene, type LedScene, type TileState } from "@/lib/led";
import { averageText, scoreText } from "@/lib/scoring";
import type { Activity, Board, Judge } from "@/lib/types";
import { Avatar } from "../avatar";
import { FitText } from "../fit-text";
import { FitStage } from "./fit-stage";

type EntryScene = Extract<LedScene, { kind: "entry" }>;

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

/** The entry's photo beside its name. Square-cornered so the green screen keys cleanly around it. */
function EntryPhoto({ src, style, className = "" }: { src: string; style?: React.CSSProperties; className?: string }) {
  // Photos are already resized to small squares on upload, so the optimizer adds nothing here.
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={src} alt="" data-entry-photo style={style} className={`shrink-0 object-cover ${className}`} />;
}

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

function averageNote(scene: EntryScene) {
  const { count, total } = scene.average;
  return `${count} of ${total} judges`;
}

// Green screen overlay ------------------------------------------------------------

/** Type sizes shrink as the judge panel grows so every score still fits its tile. */
function sizesFor(judgeCount: number) {
  if (judgeCount <= 5) return { score: 92, name: 30, photo: 64 };
  if (judgeCount <= 8) return { score: 68, name: 24, photo: 52 };
  return { score: 50, name: 20, photo: 40 };
}

/**
 * Broadcast lower third on a 1920×1080 stage. Every shape is a solid, square-cornered panel so the
 * green around it keys out cleanly.
 */
function Overlay({ board, scene }: { board: Board; scene: LedScene }) {
  if (scene.kind === "empty") return null;
  const { activity, judges } = board;
  const size = sizesFor(judges.length);
  const final = scene.average.state === "final";

  return (
    <div key={scene.entry.id} className="led-fade absolute inset-x-16 bottom-16 text-mint">
      <div className="flex h-[150px] bg-prussian">
        <div className="flex w-[190px] shrink-0 flex-col items-center justify-center bg-mint text-prussian">
          <span className="text-[28px] leading-none font-semibold">No.</span>
          <span className="tabular mt-1 text-[76px] leading-none font-bold">{scene.number}</span>
        </div>
        {scene.entry.photoUrl && <EntryPhoto src={scene.entry.photoUrl} className="h-full w-[150px]" />}
        <div className="flex min-w-0 flex-1 flex-col justify-center px-12">
          <FitText className="text-[84px] leading-[1.05] font-bold tracking-tight" minScale={0.45}>
            {scene.entry.name}
          </FitText>
          <FitText className="mt-1 text-[28px] text-powder" minScale={0.7}>
            {activity.name}
          </FitText>
        </div>
      </div>

      <div className="h-1.5 bg-powder" />

      <div className="flex h-[230px] gap-[3px] bg-prussian">
        {scene.tiles.map((t) => (
          <div key={t.judge.id} className="flex min-w-0 flex-1 flex-col justify-between bg-oxford px-7 py-6">
            <div className="flex min-w-0 items-center gap-4">
              <Avatar name={t.judge.name} src={t.judge.photoUrl} size={size.photo} />
              <FitText className="flex-1 font-semibold" style={{ fontSize: size.name }} minScale={0.6}>
                {t.label}
              </FitText>
            </div>
            <div style={{ fontSize: size.score }}>
              <TileValue judge={t.judge} state={t.state} value={t.value} activity={activity} />
            </div>
          </div>
        ))}

        <div
          key={final ? "final" : "running"}
          className={`flex w-[400px] shrink-0 flex-col justify-between px-10 py-6 ${final ? "led-fade bg-mint text-prussian" : "bg-regal"}`}
        >
          <span className={`text-[30px] leading-none font-semibold ${final ? "text-regal" : "text-mint/80"}`}>Average</span>
          <div>
            {scene.average.state === "hidden" ? (
              // Smaller than the number it stands in for, so the note below stays inside the tile.
              <p className="text-[64px] leading-[0.9]">
                <WaitingDots label="Average appears when every judge has scored" />
              </p>
            ) : (
              // Shrinks to fit: "87.50%" or four decimal places are wider than the tile at full size.
              <FitText className="tabular text-[120px] leading-[0.9] font-bold">{averageText(scene.average.value, activity)}</FitText>
            )}
            {!final && <p className="tabular mt-2 text-[24px] leading-tight text-mint/80">{averageNote(scene)}</p>}
          </div>
        </div>
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
function FullScreen({ board, scene }: { board: Board; scene: LedScene }) {
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
        {activity.name}
      </FitText>
      <div className="flex min-w-0 items-stretch gap-[2cqw]">
        <div className="flex shrink-0 flex-col items-center justify-center bg-mint px-[2.2cqw] py-[1.5cqh] text-prussian">
          <span className="text-[length:min(1.8cqw,3.4cqh)] leading-none font-semibold">No.</span>
          <span className="tabular text-[length:min(6cqw,11cqh)] leading-none font-bold">{scene.number}</span>
        </div>
        {scene.entry.photoUrl && <EntryPhoto src={scene.entry.photoUrl} style={{ width: NUMBER_BOX, height: NUMBER_BOX }} />}
        <div className="flex min-w-0 flex-1 flex-col justify-center">
          <FitText className="text-[length:min(8cqw,15cqh)] leading-[1.05] font-bold tracking-tight" minScale={0.4}>
            {scene.entry.name}
          </FitText>
        </div>
      </div>
      <div className="h-[0.6cqh] bg-powder" />

      <div className="grid min-h-0 flex-1 gap-[0.4cqw]" style={{ gridTemplateColumns: columns }}>
        {scene.tiles.map((t) => (
          <div
            key={t.judge.id}
            className="flex min-w-0 flex-col items-center justify-center gap-[2cqh] bg-oxford px-[1.2cqw]"
            style={{ containerType: "inline-size" }}
          >
            <Avatar name={t.judge.name} src={t.judge.photoUrl} size="min(40cqi, 24cqh)" />
            <FitText className="w-full text-[length:min(11cqi,3.6cqh)] font-semibold" align="center" minScale={0.6}>
              {t.label}
            </FitText>
            <div className="w-full text-center text-[length:min(30cqi,14cqh)]">
              <TileValue judge={t.judge} state={t.state} value={t.value} activity={activity} align="center" />
            </div>
          </div>
        ))}

        <div
          key={final ? "final" : "running"}
          className={`flex min-w-0 flex-col items-center justify-center gap-[1.5cqh] px-[1.2cqw] text-center ${final ? "led-fade bg-mint text-prussian" : "bg-regal"}`}
          style={{ containerType: "inline-size" }}
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
          {!final && <span className="tabular text-[length:min(7cqi,3cqh)] text-mint/80">{averageNote(scene)}</span>}
        </div>
      </div>
    </div>
  );
}

/** The LED wall output in the mode chosen in the admin panel, sized to its container. */
export function LedOutput({ board, className = "" }: { board: Board; className?: string }) {
  const scene = ledScene(board);
  if (board.activity.ledFullscreen) {
    return (
      <div className={`relative overflow-hidden bg-prussian text-mint ${className}`} style={{ containerType: "size" }}>
        <FullScreen board={board} scene={scene} />
      </div>
    );
  }
  return (
    <FitStage className={className} background={KEY_GREEN}>
      <Overlay board={board} scene={scene} />
    </FitStage>
  );
}
