"use client";

import { useLayoutEffect, useRef } from "react";
import { firstNames } from "@/lib/names";
import { averageText, rankEntries, scoreText, type RankedRow } from "@/lib/scoring";
import type { Board, ScoredMark } from "@/lib/types";
import { Avatar } from "./avatar";

type Place = "first" | "podium" | "rest";

function placeOf(row: RankedRow, ranked: boolean): Place {
  if (!ranked || row.rank === null || row.rank > 3) return "rest";
  return row.rank === 1 ? "first" : "podium";
}

const ROW_BG: Record<Place, string> = { first: "bg-regal", podium: "bg-oxford", rest: "bg-prussian" };

/** A score that's in while the values are held back: that it's there, not what it is. */
function Tick() {
  return (
    <>
      <svg aria-hidden viewBox="0 0 20 20" className="mx-auto inline-block size-[1.15em] align-[-0.15em]">
        <path d="M4.5 10.5l3.5 3.5 7.5-8" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      <span className="sr-only">scored</span>
    </>
  );
}

/**
 * Live results. With `ranked`, rows are sorted by average, show their rank, and the top three
 * stand apart as a podium. Without it, rows keep entry order and placements stay hidden.
 * With `scored` (the scores held back until the judges sign), each judge's cell shows only whether they've scored, and
 * the last column how many have.
 */
export function Scoreboard({ board, ranked, scored }: { board: Board; ranked: boolean; scored?: ScoredMark[] }) {
  const { activity, judges } = board;
  const ranking = rankEntries(board.entries, judges, board.scores, activity);
  const held = scored !== undefined;
  const marks = new Set((scored ?? []).map((m) => `${m.entryId}:${m.judgeId}`));
  const rows = ranked ? ranking : [...ranking].sort((a, b) => a.number - b.number);
  // Judges go by their first names here, as on the LED wall.
  const names = firstNames(judges);
  const nameOf = (judgeId: string) => names.get(judgeId) ?? "";
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

    // A newly arrived score glows briefly so the room can see what changed, in the board's own colours.
    const styles = getComputedStyle(list);
    const glow = { backgroundColor: styles.getPropertyValue("--color-powder").trim(), color: styles.getPropertyValue("--color-prussian").trim() };
    const seen = new Set<string>();
    for (const el of list.querySelectorAll<HTMLElement>("[data-score]")) {
      const key = el.dataset.score!;
      seen.add(key);
      if (knownScores.current && !knownScores.current.has(key)) {
        el.animate([{ ...glow, offset: 0 }], { duration: 1800, easing: "ease-out" });
      }
    }
    knownScores.current = seen;
  });

  if (rows.length === 0) {
    return <p className="px-6 py-16 text-center text-lg text-powder">No entries yet. Add them from the admin panel and they appear here.</p>;
  }

  const judgeCols = `repeat(${judges.length}, minmax(6rem, 1fr))`;
  const columns = ranked
    ? `minmax(3.5rem, 6rem) minmax(12rem, 1.6fr) ${judgeCols} minmax(7rem, 1fr)`
    : `minmax(12rem, 1.6fr) ${judgeCols} minmax(7rem, 1fr)`;
  const mobileCols = ranked ? "grid-cols-[3rem_1fr_auto]" : "grid-cols-[1fr_auto]";
  const cell = (value: number | undefined) => (value === undefined ? "—" : scoreText(value, activity));
  // Columns are sized for about five characters ("87.33"). Longer values (percentages, extra decimal
  // places) get proportionally smaller type so they stay inside their column.
  const fit = (text: string, chars = 5) => (text.length > chars ? { fontSize: `${chars / text.length}em` } : undefined);
  const firstRestIndex = rows.findIndex((r) => placeOf(r, ranked) === "rest");

  return (
    <div className="mx-auto max-w-[120rem]" style={{ "--cols": columns } as React.CSSProperties}>
      <div aria-hidden className="hidden items-end gap-4 px-6 pb-4 text-sm font-semibold text-powder lg:grid lg:grid-cols-(--cols)">
        {ranked && <span>Rank</span>}
        <span>Entry</span>
        {judges.map((j) => (
          <span key={j.id} className="flex min-w-0 flex-col items-center gap-2 text-center">
            <Avatar name={j.name} src={j.photoUrl} size={88} />
            <span className="w-full truncate text-[clamp(0.95rem,1vw,1.2rem)]">{nameOf(j.id)}</span>
          </span>
        ))}
        <span className="text-right">{held ? "Scored" : "Average"}</span>
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
                >
                  <span className="sr-only">{row.rank ? "Rank " : "Not ranked yet"}</span>
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
                      const done = held ? marks.has(`${row.entry.id}:${j.id}`) : v !== undefined;
                      return (
                        <li
                          key={j.id}
                          data-score={done ? `${row.entry.id}:${j.id}` : undefined}
                          className={`tabular inline-flex items-center gap-1.5 rounded-full py-0.5 pr-2.5 pl-0.5 text-sm text-mint ${
                            top ? "bg-prussian/60" : "bg-oxford"
                          }`}
                        >
                          <Avatar name={j.name} src={j.photoUrl} size={30} />
                          <span className="sr-only">{nameOf(j.id)}:</span>
                          <span className={done ? "" : "text-powder"}>{held && done ? <Tick /> : cell(v)}</span>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>

              {judges.map((j) => {
                const v = row.scores.get(j.id);
                const done = held ? marks.has(`${row.entry.id}:${j.id}`) : v !== undefined;
                return (
                  <span
                    key={j.id}
                    data-score={done ? `${row.entry.id}:${j.id}` : undefined}
                    className={`tabular hidden rounded-md py-1 text-center lg:block ${
                      done ? "text-[clamp(1.05rem,1.8vw,2.25rem)] text-mint" : "text-[clamp(1rem,1.4vw,1.75rem)] text-powder"
                    }`}
                  >
                    <span className="sr-only">{nameOf(j.id)}: </span>
                    {held && done ? <Tick /> : <span style={fit(cell(v))}>{cell(v)}</span>}
                  </span>
                );
              })}

              <div className="text-right">
                {held ? (
                  <HeldCount count={judges.filter((j) => marks.has(`${row.entry.id}:${j.id}`)).length} of={judges.length} top={top} />
                ) : row.average === null ? (
                  <p className="text-[clamp(1.25rem,2vw,2.25rem)] leading-none text-powder">
                    <span aria-hidden>—</span>
                    <span className="sr-only">No scores yet</span>
                  </p>
                ) : (
                  <p
                    className={`tabular leading-none font-bold text-mint ${
                      top ? "text-[clamp(1.9rem,3.6vw,4.5rem)]" : "text-[clamp(1.5rem,2.7vw,3.25rem)]"
                    }`}
                  >
                    <span style={fit(averageText(row.average, activity))}>{averageText(row.average, activity)}</span>
                  </p>
                )}
                {partial && !held && (
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

/** How many judges have scored an entry while the scores are held back: "2 of 3", or all of them marked. */
function HeldCount({ count, of, top }: { count: number; of: number; top: boolean }) {
  const all = count === of && of > 0;
  return (
    <p className={`tabular leading-none font-bold ${all ? "text-mint" : "text-powder"} ${top ? "text-[clamp(1.5rem,2.7vw,3.25rem)]" : "text-[clamp(1.25rem,2vw,2.25rem)]"}`}>
      {all && <Tick />} {count}
      <span className="text-[0.55em] font-semibold"> of {of}</span>
      <span className="sr-only"> judges have scored</span>
    </p>
  );
}
