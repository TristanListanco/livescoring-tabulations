"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { firstNames } from "@/lib/names";
import { averageText, rankEntries, scoreText, type RankedRow } from "@/lib/scoring";
import { applyTieBreaks } from "@/lib/ties";
import type { Board, ScoredMark } from "@/lib/types";
import { Avatar } from "./avatar";

type Place = "first" | "podium" | "rest";

/**
 * The top three stand out as a podium, but only once every judge has scored them: an average on two of three scores
 * can still fall, so a part-scored entry keeps its rank without being crowned.
 */
function placeOf(row: RankedRow, ranked: boolean, judgeCount: number): Place {
  if (!ranked || row.rank === null || row.rank > 3 || row.count < judgeCount) return "rest";
  return row.rank === 1 ? "first" : "podium";
}

const ROW_BG: Record<Place, string> = { first: "bg-regal", podium: "bg-oxford", rest: "bg-prussian" };

// On a stage (a projector or venue screen), rows share the screen's height. Past the point where they'd be shorter
// than a tenth of the screen (60px at least), the list pages instead. They're never taller than 16% of it. A podium
// row is a quarter taller than the rest, and the first row after the podium has the list's 12px gap (mt-3) above it.
const MIN_ROW = 0.1;
const MIN_ROW_PX = 60;
const MAX_ROW = 0.16;
const PODIUM_WEIGHT = 1.25;
const PODIUM_GAP = 12;
// How long each page stays up before the next; the leaders' page longer.
const PAGE_MS = 9_000;
const LEADERS_PAGE_MS = 14_000;
// Past this many pages, the footer says where the list is without a dot for each page.
const MAX_DOTS = 10;

type Page = { start: number; end: number };

/**
 * Splits rows into the fewest pages, as even as they go, on which every row is at least `minRow` tall, and works out
 * the height of a row that they all share (at most `maxRow`, and times its weight for a podium row). `breakAt` is the
 * first row after the podium: a page with rows on both sides of it loses the gap above it.
 */
function paginate(weights: number[], breakAt: number, height: number, minRow: number, maxRow: number) {
  const n = weights.length;
  let pages: Page[] = [];
  let unit = 0;
  for (let count = 1; count <= n; count++) {
    const size = Math.ceil(n / count);
    if (pages.length > 0 && size === pages[0].end) continue;
    pages = [];
    for (let start = 0; start < n; start += size) pages.push({ start, end: Math.min(n, start + size) });
    unit = Math.min(
      ...pages.map(({ start, end }) => {
        const weight = weights.slice(start, end).reduce((sum, w) => sum + w, 0);
        return (height - (breakAt > start && breakAt < end ? PODIUM_GAP : 0)) / weight;
      }),
    );
    if (unit >= minRow) break;
  }
  return { pages, unit: Math.max(24, Math.min(unit, maxRow)) };
}

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
 * stand apart as a podium once every judge has scored them. Without it, rows keep entry order and placements stay
 * hidden. An average that's still waiting on judges is quieter than a finished one, and the entry being judged is marked.
 * With `scored` (the scores held back until the judges sign), each judge's cell shows only whether they've scored, and
 * the last column how many have.
 *
 * With `stage` (see useStage), the board fills the height its parent gives it and never scrolls: rows grow or shrink
 * to the space, their type with them, and a list too long for one screen turns its own pages. A footer carries
 * `footnote` (how the board works) and which entries are showing. Screen readers have every row on every page.
 */
export function Scoreboard({
  board,
  ranked,
  scored,
  stage = false,
  footnote,
}: {
  board: Board;
  ranked: boolean;
  scored?: ScoredMark[];
  stage?: boolean;
  footnote?: string;
}) {
  const { activity, judges } = board;
  const held = scored !== undefined;
  // Worked out again only when the board changes, so the effects below run when there's something new to show.
  const { rows, done, firstRestIndex } = useMemo(() => {
    // Ties the judges broke in the deliberation place in the chair's order (the public board has them once the results are out).
    const ranking = applyTieBreaks(rankEntries(board.entries, board.judges, board.scores, board.activity), board.tieBreaks ?? []);
    const sorted = ranked ? ranking : [...ranking].sort((a, b) => a.number - b.number);
    const marks = new Set((scored ?? []).map((m) => `${m.entryId}:${m.judgeId}`));
    // Every score that's in (while they're held back, every one marked as in), as "entry:judge".
    const inSet = new Set<string>();
    for (const row of sorted) {
      for (const j of board.judges) {
        const key = `${row.entry.id}:${j.id}`;
        if (scored ? marks.has(key) : row.scores.has(j.id)) inSet.add(key);
      }
    }
    return { rows: sorted, done: inSet, firstRestIndex: sorted.findIndex((r) => placeOf(r, ranked, board.judges.length) === "rest") };
  }, [board, ranked, scored]);
  // The entry being judged, marked for the audience while the session is on.
  const judging = activity.sessionState === "live" ? activity.currentEntryId : null;
  // Judges go by their first names here, as on the LED wall. Kept anonymous (the server sends no names), they're
  // numbered in panel order instead.
  const names = firstNames(judges);
  const nameOf = (judgeId: string) => names.get(judgeId) || `Judge ${judges.findIndex((j) => j.id === judgeId) + 1}`;
  const listRef = useRef<HTMLOListElement>(null);
  const areaRef = useRef<HTMLDivElement>(null);
  const tops = useRef(new Map<string, number>());
  const knownScores = useRef<Set<string> | null>(null);
  // New scores on a row of another page, to glow once the board has turned to it.
  const glowNext = useRef<Set<string>>(new Set());
  const shown = useRef<{ page: number; unit: number | undefined } | null>(null);
  const [area, setArea] = useState<{ height: number; screen: number } | null>(null);
  const [page, setPage] = useState(0);
  const [paused, setPaused] = useState(false);
  const hasRows = rows.length > 0;

  // On a stage, the list has whatever height the headings leave, measured to size and page the rows.
  useLayoutEffect(() => {
    const el = areaRef.current;
    if (!stage || !el) return;
    const measure = () => {
      const height = el.clientHeight;
      const screen = window.innerHeight;
      setArea((was) => (was?.height === height && was.screen === screen ? was : { height, screen }));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [stage, hasRows]);

  const paging = useMemo(
    () =>
      stage && area && rows.length > 0
        ? paginate(
            rows.map((r) => (placeOf(r, ranked, board.judges.length) === "rest" ? 1 : PODIUM_WEIGHT)),
            firstRestIndex,
            area.height,
            Math.max(MIN_ROW_PX, MIN_ROW * area.screen),
            MAX_ROW * area.screen,
          )
        : null,
    [stage, area, rows, ranked, board.judges.length, firstRestIndex],
  );
  const pageCount = paging?.pages.length ?? 1;
  const current = Math.min(page, pageCount - 1);
  const onScreen = paging?.pages[current];

  // A list on more than one page turns them on its own, unless someone has asked it to stay.
  useEffect(() => {
    if (pageCount < 2 || paused) return;
    const timer = setTimeout(() => setPage((current + 1) % pageCount), current === 0 && ranked ? LEADERS_PAGE_MS : PAGE_MS);
    return () => clearTimeout(timer);
  }, [current, pageCount, paused, ranked]);

  useLayoutEffect(() => {
    const list = listRef.current;
    if (!list) return;
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    // A new page, or the screen changing size, moves rows without their order changing: those don't glide.
    const unit = paging?.unit;
    const turned = shown.current !== null && shown.current.page !== current;
    const moved = turned || shown.current?.unit !== unit;
    shown.current = { page: current, unit };
    if (turned && !reduceMotion) list.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 450, easing: "ease-out" });

    // Rows glide from their old place to the new one when the order changes.
    const nextTops = new Map<string, number>();
    for (const el of list.querySelectorAll<HTMLElement>("[data-entry]:not([data-off])")) {
      const id = el.dataset.entry!;
      const before = tops.current.get(id);
      const now = el.offsetTop;
      if (!reduceMotion && !moved && before !== undefined && before !== now) {
        el.animate([{ transform: `translateY(${before - now}px)` }, { transform: "none" }], {
          duration: 700,
          easing: "cubic-bezier(.2,.8,.2,1)",
        });
      }
      nextTops.set(id, now);
    }
    tops.current = nextTops;

    // A newly arrived score glows briefly so the room can see what changed, in the board's own colours. Scores
    // already in that come into view on a new page aren't new.
    const known = knownScores.current;
    knownScores.current = done;
    if (!known) return;
    const fresh = [...done].filter((key) => !known.has(key));
    const glowing = new Set([...glowNext.current, ...fresh]);
    glowNext.current = new Set();
    // A score for a row on another page turns the board to it (the entry being judged first), unless someone asked it
    // to stay where it is: what just changed is what the room is waiting to see. It glows once it's in view.
    if (paging && !paused && fresh.length) {
      const entries = fresh.map((key) => key.slice(0, key.indexOf(":")));
      const entryId = entries.find((id) => id === judging) ?? entries[0];
      const index = rows.findIndex((r) => r.entry.id === entryId);
      const target = paging.pages.findIndex((p) => index >= p.start && index < p.end);
      if (target !== -1 && target !== current) {
        glowNext.current = glowing;
        setPage(target);
        return;
      }
    }
    if (!glowing.size) return;
    const styles = getComputedStyle(list);
    const glow = { backgroundColor: styles.getPropertyValue("--color-powder").trim(), color: styles.getPropertyValue("--color-prussian").trim() };
    for (const el of list.querySelectorAll<HTMLElement>("[data-score]")) {
      if (glowing.has(el.dataset.score!)) el.animate([{ ...glow, offset: 0 }], { duration: 1800, easing: "ease-out" });
    }
  }, [stage, paging, current, done, paused, rows, judging]);

  if (!hasRows) {
    return <p className="px-6 py-16 text-center text-lg text-powder">No entries yet. They appear here once the organizer adds them.</p>;
  }

  // On a stage the columns share the screen's width however many judges there are (nobody can scroll a projector
  // sideways), and the values in them are sized to fit. Names get the larger share: a score needs only five characters.
  // No judges yet (the link shared while the activity is being set up): no judge columns, as repeat(0, …) isn't valid.
  const judgeCols = judges.length ? `repeat(${judges.length}, ${stage ? "minmax(0, 1fr)" : "minmax(6rem, 1fr)"})` : "";
  const entryCol = stage ? "minmax(0, 2.2fr)" : "minmax(12rem, 1.6fr)";
  const averageCol = stage ? "minmax(0, 1.2fr)" : "minmax(7rem, 1fr)";
  const columns = ranked ? `minmax(3.5rem, 6rem) ${entryCol} ${judgeCols} ${averageCol}` : `${entryCol} ${judgeCols} ${averageCol}`;
  const mobileCols = ranked ? "grid-cols-[3rem_1fr_auto]" : "grid-cols-[1fr_auto]";
  const cell = (value: number | undefined) => (value === undefined ? "—" : scoreText(value, activity));
  // Columns are sized for about five characters ("87.33"). Longer values (percentages, extra decimal
  // places) get proportionally smaller type so they stay inside their column. On a stage, five characters are also
  // never wider than the column (its cells are size containers).
  const fit = (text: string, chars = 5) => {
    const share = Math.min(1, chars / text.length);
    if (stage) return { fontSize: `min(${share}em, ${(share * 30).toFixed(1)}cqi)` };
    return share < 1 ? { fontSize: `${share}em` } : undefined;
  };
  const container = stage ? "[container-type:inline-size]" : "";

  return (
    <div
      className={`mx-auto w-full max-w-[120rem] ${stage ? "flex min-h-0 flex-1 flex-col" : ""}`}
      style={{ "--cols": columns } as React.CSSProperties}
    >
      {/* On a stage, the judges' heading is one line: a small photo beside each name, or the name alone in a narrow column. */}
      <div
        aria-hidden
        className={`hidden gap-4 px-6 font-semibold text-powder lg:grid lg:grid-cols-(--cols) ${stage ? "items-center pb-[1.4vh]" : "items-end pb-4 text-sm"}`}
        style={stage ? { fontSize: "max(0.875rem, min(1.25vw, 2.3vh))" } : undefined}
      >
        {ranked && <span>Rank</span>}
        <span>Entry</span>
        {judges.map((j) => (
          <span key={j.id} className={`flex min-w-0 items-center text-center ${stage ? "@container justify-center gap-[0.5em]" : "flex-col gap-2"}`}>
            <Avatar name={j.name || nameOf(j.id)} src={j.photoUrl} size={stage ? "min(2.6vw, 4.6vh)" : 88} className={stage ? "@max-[7.5rem]:hidden" : ""} />
            <span className={stage ? "min-w-0 truncate" : "w-full truncate text-[clamp(0.95rem,1vw,1.2rem)]"}>{nameOf(j.id)}</span>
          </span>
        ))}
        <span className="text-right">{held ? "Scored" : "Average"}</span>
      </div>

      <div ref={areaRef} className={stage ? "min-h-0 flex-1 overflow-hidden" : undefined}>
        <ol ref={listRef} className="relative border-t border-oxford">
          {rows.map((row, i) => {
            const place = placeOf(row, ranked, judges.length);
            const top = place !== "rest";
            const partial = row.count > 0 && row.count < judges.length;
            const secondary = top ? "text-mint/80" : "text-powder";
            // On a stage, a row on another page is there for screen readers only. One on this page has a set height,
            // and its type is a share of that height (never wider than its column allows).
            const off = onScreen !== undefined && (i < onScreen.start || i >= onScreen.end);
            const height = paging && !off ? paging.unit * (top ? PODIUM_WEIGHT : 1) : undefined;
            const size = (share: number, maxVw: number, maxCqi?: number) =>
              height === undefined
                ? undefined
                : { fontSize: `min(${(height * share).toFixed(1)}px, ${maxVw}vw${maxCqi ? `, ${maxCqi}cqi` : ""})` };
            const separated = i === firstRestIndex && firstRestIndex > 0 && (onScreen === undefined || i > onScreen.start);
            return (
              <li
                key={row.entry.id}
                data-entry={row.entry.id}
                data-off={off || undefined}
                className={
                  off
                    ? "sr-only"
                    : `relative grid items-center gap-x-4 gap-y-2.5 border-b px-6 lg:grid-cols-(--cols) ${mobileCols} ${ROW_BG[place]} ${
                        top ? "border-prussian" : "border-oxford"
                      } ${height !== undefined ? "" : top ? "py-5 lg:py-7" : "py-4 lg:py-5"} ${separated ? "mt-3 border-t border-t-oxford" : ""}`
                }
                style={height === undefined ? undefined : { height }}
              >
                {top && <span aria-hidden className={`absolute inset-y-0 left-0 w-1.5 ${place === "first" ? "bg-mint" : "bg-powder"}`} />}

                {ranked && (
                  <span
                    className={`tabular leading-none font-bold ${
                      top ? "text-[clamp(1.9rem,3.4vw,4.25rem)] text-mint" : "text-[clamp(1.5rem,2.4vw,2.75rem)] text-powder"
                    }`}
                    style={size(0.5, 4.2)}
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
                    style={size(0.3, 2.6)}
                  >
                    {row.entry.name}
                  </p>
                  <p className={`tabular mt-0.5 text-[clamp(0.85rem,0.95vw,1.1rem)] ${secondary}`} style={size(0.19, 1.5)}>
                    No. {row.number}
                    {row.entry.id === judging && (
                      <span className="ml-[0.6em] inline-block rounded-full bg-mint px-[0.6em] align-[0.05em] text-[0.9em] leading-[1.5] font-semibold text-prussian">
                        Now judging
                      </span>
                    )}
                  </p>
                </div>

                {judges.map((j) => {
                  const v = row.scores.get(j.id);
                  const key = `${row.entry.id}:${j.id}`;
                  const isDone = done.has(key);
                  return (
                    <span
                      key={j.id}
                      data-score={isDone ? key : undefined}
                      className={`tabular hidden rounded-md py-1 text-center lg:block ${container} ${
                        isDone ? "text-[clamp(1.05rem,1.8vw,2.25rem)] text-mint" : "text-[clamp(1rem,1.4vw,1.75rem)] text-powder"
                      }`}
                      style={isDone ? size(0.3, 2.2) : size(0.24, 1.7)}
                    >
                      <span className="sr-only">{nameOf(j.id)}: </span>
                      {held && isDone ? <Tick /> : <span style={fit(cell(v))}>{cell(v)}</span>}
                    </span>
                  );
                })}

                <div className={`text-right ${container}`}>
                  {held ? (
                    <HeldCount
                      count={judges.filter((j) => done.has(`${row.entry.id}:${j.id}`)).length}
                      of={judges.length}
                      top={top}
                      style={size(0.4, 3.2, 26)}
                    />
                  ) : row.average === null ? (
                    <p className="text-[clamp(1.25rem,2vw,2.25rem)] leading-none text-powder" style={size(0.3, 2.4)}>
                      <span aria-hidden>—</span>
                      <span className="sr-only">No scores yet</span>
                    </p>
                  ) : (
                    <p
                      className={`tabular leading-none font-bold ${partial ? "text-powder" : "text-mint"} ${
                        top ? "text-[clamp(1.9rem,3.6vw,4.5rem)]" : "text-[clamp(1.5rem,2.7vw,3.25rem)]"
                      }`}
                      style={size(0.44, 4.2)}
                    >
                      <span style={fit(averageText(row.average, activity))}>{averageText(row.average, activity)}</span>
                    </p>
                  )}
                  {partial && !held && (
                    <p className={`tabular mt-1.5 text-[clamp(0.8rem,0.9vw,1.05rem)] ${secondary}`} style={size(0.19, 1.5, 12)}>
                      {row.count} of {judges.length} judges
                    </p>
                  )}
                </div>
                {/* On a phone, each judge's score is a chip, in a line of their own under the name and the average. */}
                {judges.length > 0 && (
                  <ul className={`flex flex-wrap gap-1.5 lg:hidden ${ranked ? "col-span-2 col-start-2" : "col-span-full"}`}>
                    {judges.map((j) => {
                      const v = row.scores.get(j.id);
                      const key = `${row.entry.id}:${j.id}`;
                      const isDone = done.has(key);
                      return (
                        <li
                          key={j.id}
                          data-score={isDone ? key : undefined}
                          className={`tabular inline-flex items-center gap-1.5 rounded-full py-0.5 pr-2.5 pl-0.5 text-sm text-mint ${
                            top ? "bg-prussian/60" : "bg-oxford"
                          }`}
                        >
                          <Avatar name={j.name || nameOf(j.id)} src={j.photoUrl} size={30} />
                          <span className="sr-only">{nameOf(j.id)}:</span>
                          <span className={isDone ? "" : "text-powder"}>{held && isDone ? <Tick /> : cell(v)}</span>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </li>
            );
          })}
        </ol>
      </div>

      {stage && (footnote || (paging && onScreen && pageCount > 1)) && (
        <footer
          className="flex shrink-0 flex-wrap items-center justify-between gap-x-10 gap-y-2 px-6 py-[2.2vh] text-powder"
          style={{ fontSize: "max(0.875rem, min(1.2vw, 2.2vh))" }}
        >
          {footnote && <p className="max-w-[75ch] text-pretty">{footnote}</p>}
          {paging && onScreen && pageCount > 1 && (
            <Pager
              pages={paging.pages}
              current={current}
              total={rows.length}
              paused={paused}
              onPause={() => setPaused((was) => !was)}
              onPage={setPage}
            />
          )}
        </footer>
      )}
    </div>
  );
}

/**
 * Where a paged board is: "Entries 9–14 of 14", a dot for each page (each one a button to go to it), and a button that
 * keeps the board on the page it's on.
 */
function Pager({
  pages,
  current,
  total,
  paused,
  onPause,
  onPage,
}: {
  pages: Page[];
  current: number;
  total: number;
  paused: boolean;
  onPause: () => void;
  onPage: (page: number) => void;
}) {
  const { start, end } = pages[current];
  const control = "grid size-[max(1.6em,24px)] shrink-0 place-items-center rounded-full focus-visible:outline-mint";
  return (
    <div className="ml-auto flex shrink-0 items-center gap-[0.6em]">
      <button type="button" onClick={onPause} aria-pressed={paused} aria-label="Stay on this page" className={`${control} text-mint`}>
        <svg aria-hidden viewBox="0 0 20 20" className="size-[0.9em]" fill="currentColor">
          {paused ? <path d="M6 3.5v13l10.5-6.5z" /> : <path d="M5 3.5h3.5v13H5zM11.5 3.5H15v13h-3.5z" />}
        </svg>
      </button>
      <p className="tabular whitespace-nowrap">
        Entries{" "}
        <span className="font-semibold text-mint">
          {start + 1}–{end}
        </span>{" "}
        of {total}
      </p>
      {pages.length <= MAX_DOTS && (
        <ol className="flex items-center">
          {pages.map((p, i) => (
            <li key={p.start}>
              <button
                type="button"
                onClick={() => onPage(i)}
                aria-label={`Entries ${p.start + 1} to ${p.end}`}
                aria-current={i === current || undefined}
                className={control}
              >
                <span aria-hidden className={`rounded-full ${i === current ? "size-[0.7em] bg-mint" : "size-[0.4em] bg-powder"}`} />
              </button>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

/** How many judges have scored an entry while the scores are held back: "2 of 3", or all of them marked. */
function HeldCount({ count, of, top, style }: { count: number; of: number; top: boolean; style?: React.CSSProperties }) {
  const all = count === of && of > 0;
  return (
    <p
      className={`tabular leading-none font-bold ${all ? "text-mint" : "text-powder"} ${top ? "text-[clamp(1.5rem,2.7vw,3.25rem)]" : "text-[clamp(1.25rem,2vw,2.25rem)]"}`}
      style={style}
    >
      {all && <Tick />} {count}
      <span className="text-[0.55em] font-semibold"> of {of}</span>
      <span className="sr-only"> judges have scored</span>
    </p>
  );
}
