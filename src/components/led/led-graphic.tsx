"use client";

import { useLayoutEffect, useRef } from "react";
import { formatAverage, formatScore, rankEntries } from "@/lib/scoring";
import type { Board } from "@/lib/types";
import { Avatar } from "../avatar";

const POWDER = "#8da9c4";

/** Type sizes shrink as the judge panel grows so every score still fits its tile. */
function sizesFor(judgeCount: number) {
  if (judgeCount <= 5) return { score: 92, name: 30, photo: 64 };
  if (judgeCount <= 8) return { score: 68, name: 24, photo: 52 };
  return { score: 50, name: 20, photo: 40 };
}

/**
 * Broadcast lower third for the entry the admin put on air, drawn on a 1920×1080 stage.
 * Every shape is a solid, square-cornered panel so the green around it keys out cleanly.
 */
export function LedGraphic({ board, ranked }: { board: Board; ranked: boolean }) {
  const { activity, judges } = board;
  const rows = rankEntries(board.entries, judges, board.scores);
  const row = rows.find((r) => r.entry.id === activity.ledEntryId);
  const rootRef = useRef<HTMLDivElement>(null);
  const known = useRef<{ entry: string; keys: Set<string> } | null>(null);

  // Each score that arrives while the entry is on air pops into its tile.
  useLayoutEffect(() => {
    const root = rootRef.current;
    if (!root || !row) {
      known.current = null;
      return;
    }
    const keys = new Set<string>();
    for (const el of root.querySelectorAll<HTMLElement>("[data-score]")) {
      const key = el.dataset.score!;
      keys.add(key);
      if (known.current?.entry === row.entry.id && !known.current.keys.has(key)) {
        el.animate(
          [
            { transform: "translateY(45%)", opacity: 0 },
            { transform: "none", opacity: 1 },
          ],
          { duration: 450, easing: "cubic-bezier(.2,.9,.25,1)" },
        );
        el.parentElement?.animate([{ backgroundColor: POWDER, offset: 0 }], { duration: 900, easing: "ease-out" });
      }
    }
    known.current = { entry: row.entry.id, keys };
  });

  if (!row) return null;

  const complete = judges.length > 0 && row.count === judges.length;
  const size = sizesFor(judges.length);

  return (
    <div ref={rootRef} key={row.entry.id} className="led-wipe absolute inset-x-16 bottom-16 text-mint">
      <div className="flex h-[150px] bg-prussian">
        <div className="flex w-[190px] shrink-0 flex-col items-center justify-center bg-mint text-prussian">
          <span className="text-[28px] leading-none font-semibold">No.</span>
          <span className="tabular mt-1 text-[76px] leading-none font-bold">{row.number}</span>
        </div>
        <div className="flex min-w-0 flex-1 flex-col justify-center px-12">
          <p className="truncate text-[84px] leading-[1.05] font-bold tracking-tight">{row.entry.name}</p>
          <p className="mt-1 truncate text-[28px] text-powder">{activity.name}</p>
        </div>
      </div>

      <div className="h-1.5 bg-powder" />

      <div className="flex h-[230px] gap-[3px] bg-prussian">
        {judges.map((j) => {
          const v = row.scores.get(j.id);
          return (
            <div key={j.id} className="flex min-w-0 flex-1 flex-col justify-between bg-oxford px-7 py-6">
              <div className="flex min-w-0 items-center gap-4">
                <Avatar name={j.name} src={j.photoUrl} size={size.photo} />
                <span className="truncate font-semibold" style={{ fontSize: size.name }}>
                  {j.name}
                </span>
              </div>
              {v === undefined ? (
                <span className="flex h-[1em] items-center gap-[0.18em] text-powder" style={{ fontSize: size.score }} aria-label="Waiting for score">
                  <span className="led-dot size-[0.16em] rounded-full bg-current" />
                  <span className="led-dot size-[0.16em] rounded-full bg-current [animation-delay:.2s]" />
                  <span className="led-dot size-[0.16em] rounded-full bg-current [animation-delay:.4s]" />
                </span>
              ) : (
                <span data-score={`${row.entry.id}:${j.id}`} className="tabular leading-none font-bold" style={{ fontSize: size.score }}>
                  {formatScore(v, activity.decimals)}
                </span>
              )}
            </div>
          );
        })}

        <div
          key={complete ? "final" : "running"}
          className={`flex w-[400px] shrink-0 flex-col justify-between px-10 py-6 ${complete ? "led-reveal bg-mint text-prussian" : "bg-regal"}`}
        >
          <div className="flex items-baseline justify-between gap-4">
            <span className={`text-[30px] font-semibold ${complete ? "text-regal" : "text-mint/80"}`}>Average</span>
            {complete && ranked && row.rank !== null && (
              <span className="tabular bg-prussian px-3 py-1 text-[26px] font-bold text-mint">Rank {row.rank}</span>
            )}
          </div>
          <div>
            <p className="tabular text-[120px] leading-[0.9] font-bold">{formatAverage(row.averageHundredths)}</p>
            {!complete && (
              <p className="tabular mt-2 text-[24px] text-mint/80">
                {row.count} of {judges.length} judges
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
