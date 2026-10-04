"use client";

import { useLayoutEffect, useRef } from "react";
import { formatAverage, formatScore, rankEntries, type RankedRow } from "@/lib/scoring";
import type { Board } from "@/lib/types";
import { Avatar } from "./avatar";

const POWDER = "#8da9c4";
const PRUSSIAN = "#0b2545";

type Place = "first" | "podium" | "rest";

function placeOf(row: RankedRow, ranked: boolean): Place {
  if (!ranked || row.rank === null || row.rank > 3) return "rest";
  return row.rank === 1 ? "first" : "podium";
}

const ROW_BG: Record<Place, string> = { first: "bg-regal", podium: "bg-oxford", rest: "bg-prussian" };

/**
 * Live results. With `ranked`, rows are sorted by average, show their rank, and the top three
 * stand apart as a podium. Without it, rows keep entry order and placements stay hidden.
 */
export function Scoreboard({ board, ranked }: { board: Board; ranked: boolean }) {
  const { activity, judges } = board;
  const ranking = rankEntries(board.entries, judges, board.scores);
  const rows = ranked ? ranking : [...ranking].sort((a, b) => a.number - b.number);
  const listRef = useRef<HTMLOListElement>(null);
  const tops = useRef(new Map<string, number>());
  const knownScores = useRef<Set<string> | null>(null);

  useLayoutEffect(() => {
    const list = listRef.current;
    if (!list) return;
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    // Rows glide from their old place to the new one when the order changes.
    const nextTops = new Map<string, number>();
    for (const el of list.querySelectorAll<HTMLElement>("[data-entry]")) {
      const id = el.dataset.entry!;
      const before = tops.current.get(id);
      const now = el.offsetTop;
      if (!reduceMotion && before !== undefined && before !== now) {
        el.animate([{ transform: `translateY(${before - now}px)` }, { transform: "none" }], {
          duration: 700,
          easing: "cubic-bezier(.2,.8,.2,1)",
        });
      }
      nextTops.set(id, now);
    }
    tops.current = nextTops;

    // A newly arrived score glows briefly so the room can see what changed.
    const seen = new Set<string>();
    for (const el of list.querySelectorAll<HTMLElement>("[data-score]")) {
      const key = el.dataset.score!;
      seen.add(key);
      if (knownScores.current && !knownScores.current.has(key)) {
        el.animate([{ backgroundColor: POWDER, color: PRUSSIAN, offset: 0 }], { duration: 1800, easing: "ease-out" });
      }
    }
    knownScores.current = seen;
  });

  if (rows.length === 0) {
    return <p className="px-6 py-16 text-center text-lg text-powder">No entries yet. Add them from the admin panel and they appear here.</p>;
  }

  const judgeCols = `repeat(${judges.length}, minmax(4.5rem, 1fr))`;
  const columns = ranked
    ? `minmax(3.5rem, 6rem) minmax(12rem, 1.6fr) ${judgeCols} minmax(7rem, 1fr)`
    : `minmax(12rem, 1.6fr) ${judgeCols} minmax(7rem, 1fr)`;
  const mobileCols = ranked ? "grid-cols-[3rem_1fr_auto]" : "grid-cols-[1fr_auto]";
  const cell = (value: number | undefined) => (value === undefined ? "—" : formatScore(value, activity.decimals));
  const firstRestIndex = rows.findIndex((r) => placeOf(r, ranked) === "rest");

  return (
    <div className="mx-auto max-w-[120rem]" style={{ "--cols": columns } as React.CSSProperties}>
      <div aria-hidden className="hidden items-end gap-4 px-6 pb-4 text-sm font-semibold text-powder lg:grid lg:grid-cols-(--cols)">
        {ranked && <span>Rank</span>}
        <span>Entry</span>
        {judges.map((j) => (
          <span key={j.id} className="flex min-w-0 flex-col items-center gap-2 text-center">
            <Avatar name={j.name} src={j.photoUrl} size={52} />
            <span className="w-full truncate text-[clamp(0.85rem,0.9vw,1.05rem)]">{j.name}</span>
          </span>
        ))}
        <span className="text-right">Average</span>
      </div>

      <ol ref={listRef} className="relative border-t border-oxford">
        {rows.map((row, i) => {
          const place = placeOf(row, ranked);
          const top = place !== "rest";
          const partial = row.count > 0 && row.count < judges.length;
          const secondary = top ? "text-mint/80" : "text-powder";
          return (
            <li
              key={row.entry.id}
              data-entry={row.entry.id}
              className={`relative grid items-center gap-4 border-b px-6 lg:grid-cols-(--cols) ${mobileCols} ${ROW_BG[place]} ${
                top ? "border-prussian" : "border-oxford"
              } ${
                top ? "py-5 lg:py-7" : "py-4 lg:py-5"
              } ${i === firstRestIndex && firstRestIndex > 0 ? "mt-3 border-t border-t-oxford" : ""}`}
            >
              {top && <span aria-hidden className={`absolute inset-y-0 left-0 w-1.5 ${place === "first" ? "bg-mint" : "bg-powder"}`} />}

              {ranked && (
                <span
                  className={`tabular leading-none font-bold ${
                    top ? "text-[clamp(1.9rem,3.4vw,4.25rem)] text-mint" : "text-[clamp(1.5rem,2.4vw,2.75rem)] text-powder"
                  }`}
                  aria-label={row.rank ? `Rank ${row.rank}` : "Not ranked yet"}
                >
                  {row.rank ?? ""}
                </span>
              )}

              <div className="min-w-0">
                <p
                  className={`truncate leading-tight font-semibold text-mint ${
                    top ? "text-[clamp(1.3rem,2.5vw,3rem)]" : "text-[clamp(1.1rem,1.9vw,2.25rem)]"
                  }`}
                >
                  {row.entry.name}
                </p>
                <p className={`tabular mt-0.5 text-[clamp(0.85rem,0.95vw,1.1rem)] ${secondary}`}>No. {row.number}</p>
                {judges.length > 0 && (
                  <ul className="mt-2 flex flex-wrap gap-1.5 lg:hidden">
                    {judges.map((j) => {
                      const v = row.scores.get(j.id);
                      return (
                        <li
                          key={j.id}
                          data-score={v === undefined ? undefined : `${row.entry.id}:${j.id}`}
                          className={`tabular inline-flex items-center gap-1.5 rounded-full py-0.5 pr-2.5 pl-0.5 text-sm text-mint ${
                            top ? "bg-prussian/60" : "bg-oxford"
                          }`}
                        >
                          <Avatar name={j.name} src={j.photoUrl} size={22} />
                          <span className="sr-only">{j.name}:</span>
                          <span className={v === undefined ? "text-powder" : ""}>{cell(v)}</span>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>

              {judges.map((j) => {
                const v = row.scores.get(j.id);
                return (
                  <span
                    key={j.id}
                    data-score={v === undefined ? undefined : `${row.entry.id}:${j.id}`}
                    className={`tabular hidden rounded-md py-1 text-center lg:block ${
                      v === undefined ? "text-[clamp(1rem,1.4vw,1.75rem)] text-powder/60" : "text-[clamp(1.05rem,1.8vw,2.25rem)] text-mint"
                    }`}
                  >
                    <span className="sr-only">{j.name}: </span>
                    {cell(v)}
                  </span>
                );
              })}

              <div className="text-right">
                {row.averageHundredths === null ? (
                  <p className="text-[clamp(1.25rem,2vw,2.25rem)] leading-none text-powder/60">
                    <span aria-hidden>—</span>
                    <span className="sr-only">No scores yet</span>
                  </p>
                ) : (
                  <p
                    className={`tabular leading-none font-bold text-mint ${
                      top ? "text-[clamp(1.9rem,3.6vw,4.5rem)]" : "text-[clamp(1.5rem,2.7vw,3.25rem)]"
                    }`}
                  >
                    {formatAverage(row.averageHundredths)}
                  </p>
                )}
                {partial && (
                  <p className={`tabular mt-1.5 text-[clamp(0.8rem,0.9vw,1.05rem)] ${secondary}`}>
                    {row.count} of {judges.length} judges
                  </p>
                )}
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
