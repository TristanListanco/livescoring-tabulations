"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState, useSyncExternalStore } from "react";
import { ShowStatus } from "@/components/show-status";
import { cutPlan, finalCutRound, judgingOrder, partsOf, programOrder, programProgress, roundBoard, roundLabel, roundPool, roundProgress, roundReleased, standings, type StandingRow } from "@/lib/pageant";
import { segmentLabel } from "@/lib/pageant-setup";
import { averageText, formatBound, formatScore, judgeSheet, rankEntries, scoreProgress, scoreText } from "@/lib/scoring";
import { PRELIMINARY, type Board, type Round } from "@/lib/types";
import { JUDGING_OVER, useLiveRefresh } from "@/lib/use-live-refresh";

const lockFormat = new Intl.DateTimeFormat("en", { hour: "numeric", minute: "2-digit" });
const stampFormat = new Intl.DateTimeFormat("en", { dateStyle: "medium", timeStyle: "short" });

// The page out of view (another tab, another app, the phone's app switcher): the tally blurs, so a snapshot of it
// shows nothing readable.
const onVisibility = (changed: () => void) => {
  document.addEventListener("visibilitychange", changed);
  return () => document.removeEventListener("visibilitychange", changed);
};
const isHidden = () => document.visibilityState === "hidden";

// The minute, for the watermark's time; null on the server, whose clock and time zone aren't the viewer's.
const onMinute = (changed: () => void) => {
  const timer = setInterval(changed, 15_000);
  return () => clearInterval(timer);
};
const thisMinute = () => Math.floor(Date.now() / 60_000);

/**
 * Who's looking and when, faintly across the tally: a screenshot or a photo of it says whose it was. A mask, filled in
 * the admin theme's ink (see the layer it's drawn on), so it shows in the light and the dark theme alike.
 */
function watermark(text: string): string {
  const escaped = text.replace(/[<>&"']/g, (c) => `&#${c.charCodeAt(0)};`);
  const svg =
    `<svg xmlns='http://www.w3.org/2000/svg' width='560' height='200'>` +
    `<text x='20' y='120' transform='rotate(-18 280 100)' font-family='sans-serif' font-size='17' font-weight='700' fill='#000'>${escaped}</text></svg>`;
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;
}

/**
 * The private tally, open: every score as submitted (by entry, and for criteria scoring each judge's points per
 * criterion), kept current, with where the show stands as on the live results (judging, the judges deliberating, or
 * ended). A pageant's, one sub-activity (or part) at a time, or its standings: the preliminary's, or a cut's (see
 * PageantTally). Partial and unofficial until every judge has signed and the session has ended (a pageant: until it has
 * ended); official from then on. Made hard to leak: it can't be selected, copied or printed, it blurs when the page is
 * out of view, and it carries the viewer's name and the time. A browser can't stop a screenshot outright; the watermark
 * makes one traceable. It locks itself when the unlock runs out.
 */
export function TallyView({ board, viewer, until }: { board: Board; viewer: string; until: number }) {
  const router = useRouter();
  const status = useLiveRefresh(board.activity.id, board.activity.sessionState === "ended" ? JUDGING_OVER : {});
  const hidden = useSyncExternalStore(onVisibility, isHidden, () => false);
  const minute = useSyncExternalStore(onMinute, thisMinute, () => null);
  useEffect(() => {
    const timer = setTimeout(() => router.refresh(), Math.max(0, until - Date.now()) + 500);
    return () => clearTimeout(timer);
  }, [until, router]);

  const { activity } = board;
  const pageant = activity.kind === "pageant";
  const { submitted, possible } = pageant ? programProgress(board) : scoreProgress(board);
  // Official once the judges have signed (which ends the session); a correction after that voids their signatures. A
  // pageant's once it has ended: by then every sub-activity that deliberates is signed off.
  const official = pageant ? activity.sessionState === "ended" : activity.signedOffAt !== null;
  const mark = watermark(`${official ? "Official" : "Unofficial"} · ${viewer}${minute === null ? "" : ` · ${stampFormat.format(new Date(minute * 60_000))}`}`);
  const refuse = (e: React.SyntheticEvent) => e.preventDefault();

  return (
    <>
      <p className="hidden print:block">The private tally can&apos;t be printed.</p>
      <div className="select-none print:hidden" onCopy={refuse} onCut={refuse} onContextMenu={refuse} onDragStart={refuse}>
        <header className="mt-2 flex flex-wrap items-end justify-between gap-x-8 gap-y-3">
          <div className="min-w-0">
            <p
              className={`inline-flex rounded-full px-3 py-1 text-sm font-bold ${official ? "bg-regal/10 text-regal" : "bg-danger/10 text-danger"}`}
            >
              {official ? "Official tally" : "Partial and unofficial tally"}
            </p>
            <h1 className="title mt-2">{activity.name}</h1>
          </div>
          <div className="space-y-1 text-sm sm:text-right">
            <p className="tabular">
              <span className="text-xl font-bold">{submitted}</span> of {possible} scores in
            </p>
            <ShowStatus activity={activity} connection={status} />
            {minute !== null && <p className="hint">Locks at {lockFormat.format(new Date(until))}</p>}
          </div>
        </header>

        {/* Its own layer, so the watermark can sit behind the scores (under every digit) yet above the page. */}
        <div className={`relative isolate mt-8 transition-[filter] duration-150 ${hidden ? "blur-xl" : ""}`}>
          {pageant ? <PageantTally board={board} official={official} /> : <EntryTally board={board} official={official} noun="Entry" />}

          <div
            aria-hidden
            className="pointer-events-none absolute inset-0 -z-10 bg-prussian opacity-[0.11]"
            style={{ maskImage: mark, WebkitMaskImage: mark }}
          />
        </div>
      </div>
    </>
  );
}

const empty = <span className="text-prussian/40">—</span>;

/**
 * Every score on a board, by entry (each judge's score, the average so far, how many are in), and for criteria scoring
 * each judge's points per criterion: an event's whole tally, or one pageant sub-activity's (`noun`: "Candidate").
 */
function EntryTally({ board, official, noun }: { board: Board; official: boolean; noun: "Entry" | "Candidate" }) {
  const { activity, judges } = board;
  const rows = [...rankEntries(board.entries, judges, board.scores, activity)].sort((a, b) => a.number - b.number);
  const criteria = activity.scoringMode === "criteria" ? activity.criteria : [];
  return (
    <>
    <section aria-labelledby="tally-by-entry">
      <h2 id="tally-by-entry" className="title-sm">
        By {noun.toLowerCase()}
      </h2>
      <div tabIndex={0} role="region" aria-label={`Scores by ${noun.toLowerCase()}`} className="mt-3 overflow-x-auto">
        <table className="w-full min-w-[36rem] text-left">
          <thead className="border-b border-line text-sm text-prussian/70">
            <tr>
              <th className="py-2 pr-3 font-semibold">No.</th>
              <th className="px-3 py-2 font-semibold">{noun}</th>
              {judges.map((j) => (
                <th key={j.id} className="px-3 py-2 text-right font-semibold">
                  {j.name}
                </th>
              ))}
              <th className="px-3 py-2 text-right font-semibold">{official ? "Average" : "Average so far"}</th>
              <th className="py-2 pl-3 text-right font-semibold">Scored</th>
            </tr>
          </thead>
          <tbody className="tabular">
            {rows.map((row) => (
              <tr key={row.entry.id} className="border-b border-line">
                <td className="py-2.5 pr-3 text-prussian/70">{row.number}</td>
                <td className="px-3 py-2.5 font-semibold">{row.entry.name}</td>
                {judges.map((j) => {
                  const value = row.scores.get(j.id);
                  return (
                    <td key={j.id} className="px-3 py-2.5 text-right">
                      {value === undefined ? empty : scoreText(value, activity)}
                    </td>
                  );
                })}
                <td className="px-3 py-2.5 text-right font-bold">{row.average === null ? empty : averageText(row.average, activity)}</td>
                <td className="py-2.5 pl-3 text-right text-prussian/70">
                  {row.count} of {judges.length}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>

    {criteria.length > 0 && (
      <section aria-labelledby="tally-by-criterion" className="mt-12">
        <h2 id="tally-by-criterion" className="title-sm">
          By judge and criterion
        </h2>
        {judges.map((j) => (
          <div key={j.id} className="mt-6">
            <h3 className="title-sm text-lg">{j.name}</h3>
            <div tabIndex={0} role="region" aria-label={`${j.name}'s points by criterion`} className="mt-2 overflow-x-auto">
              <table className="w-full min-w-[36rem] text-left">
                <thead className="border-b border-line text-sm text-prussian/70">
                  <tr>
                    <th className="py-2 pr-3 font-semibold">No.</th>
                    <th className="px-3 py-2 font-semibold">{noun}</th>
                    {criteria.map((c) => (
                      <th key={c.id} className="px-3 py-2 text-right font-semibold">
                        {c.name} <span className="font-normal">/ {formatBound(c.max)}</span>
                      </th>
                    ))}
                    <th className="py-2 pl-3 text-right font-semibold">Total</th>
                  </tr>
                </thead>
                <tbody className="tabular">
                  {judgeSheet(board, j.id).map((r) => (
                    <tr key={r.entry.id} className="border-b border-line">
                      <td className="py-2.5 pr-3 text-prussian/70">{r.number}</td>
                      <td className="px-3 py-2.5 font-semibold">{r.entry.name}</td>
                      {r.points.map((v, i) => (
                        <td key={criteria[i].id} className="px-3 py-2.5 text-right">
                          {v === null ? empty : formatScore(v, activity.decimals)}
                        </td>
                      ))}
                      <td className="py-2.5 pl-3 text-right font-bold">{r.value === null ? empty : scoreText(r.value, activity)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ))}
      </section>
    )}
    </>
  );
}

const percent = (n: number) => `${formatBound(Math.round(n * 100) / 100)}%`;

/**
 * Standings, as the cut dialog and the results PDFs rank them: each sub-activity counted (its average as a percentage
 * of its maximum, at its share), any deductions, and the total, with the cut's line when there is one.
 */
function StandingsTable({ weights, rows, places, line, label }: { weights: { round: Round; weight: number }[]; rows: StandingRow[]; places: number; line?: number; label: string }) {
  const deducting = rows.some((r) => r.deducted > 0);
  const pct = (v: number | null | undefined) => (v === null || v === undefined ? empty : `${v.toFixed(places)}%`);
  return (
    <div tabIndex={0} role="region" aria-label={label} className="mt-3 overflow-x-auto">
      <table className="w-full min-w-[36rem] text-left">
        <thead className="border-b border-line text-sm text-prussian/70">
          <tr>
            <th className="py-2 pr-3 font-semibold">Rank</th>
            <th className="px-3 py-2 font-semibold">No.</th>
            <th className="px-3 py-2 font-semibold">Candidate</th>
            {weights.map((w) => (
              <th key={w.round.id} className="px-3 py-2 text-right font-semibold">
                {w.round.name} <span className="font-normal">{percent(w.weight)}</span>
              </th>
            ))}
            {deducting && <th className="px-3 py-2 text-right font-semibold">Deductions</th>}
            <th className="py-2 pl-3 text-right font-semibold">Total</th>
          </tr>
        </thead>
        <tbody className="tabular">
          {rows.map((row, i) => (
            <tr key={row.entry.id} className={line !== undefined && i === line - 1 && i < rows.length - 1 ? "border-b-2 border-dashed border-regal" : "border-b border-line"}>
              <td className="py-2.5 pr-3 font-bold">{row.rank ?? empty}</td>
              <td className="px-3 py-2.5 text-prussian/70">{row.number}</td>
              <td className="px-3 py-2.5 font-semibold">{row.entry.name}</td>
              {weights.map((w) => (
                <td key={w.round.id} className="px-3 py-2.5 text-right">
                  {pct(row.parts.get(w.round.id))}
                </td>
              ))}
              {deducting && <td className="px-3 py-2.5 text-right">{row.deducted > 0 ? `−${row.deducted.toFixed(places)}` : empty}</td>}
              <td className="py-2.5 pl-3 text-right font-bold">{pct(row.total)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * A pageant's tally, one view at a time, chosen from "Tally of" (kept in the address, ?of=): each sub-activity (or part)
 * as an event's tally of its candidates and its own panel; the preliminary's standings, deductions taken off; and each
 * cut's standings, with its line. It starts on the sub-activity on judges' screens, else the first one with scores.
 */
function PageantTally({ board, official }: { board: Board; official: boolean }) {
  // The view chosen here at once, and kept in the address (without a trip to the server) for a reload or a shared link.
  const [asked, setAsked] = useState(useSearchParams().get("of"));
  const choose = (value: string) => {
    setAsked(value);
    const url = new URL(window.location.href);
    url.searchParams.set("of", value);
    window.history.replaceState(null, "", url);
  };
  const units = programOrder(board.rounds);
  const views: { value: string; label: string; segment: "preliminary" | "proper" }[] = [];
  for (const segment of ["preliminary", "proper"] as const) {
    const inSegment = units.filter((u) => u.segment === segment);
    if (segment === "preliminary" && inSegment.length) views.push({ value: PRELIMINARY, label: "Preliminary standings", segment });
    for (const unit of inSegment) {
      const parts = partsOf(board.rounds, unit.id);
      for (const r of parts.length ? parts : [unit]) views.push({ value: r.id, label: roundLabel(board.rounds, r), segment });
      if (unit.cutSize !== null) {
        const final = finalCutRound(board.rounds)?.id === unit.id;
        views.push({ value: `cut:${unit.id}`, label: `${final ? "Final cut" : "Cut"} after ${unit.name}: Top ${unit.cutSize}`, segment });
      }
    }
  }
  const scored = judgingOrder(board.rounds).find((r) => board.scores.some((s) => s.roundId === r.id));
  const start = views.find((v) => v.value === board.activity.currentRoundId)?.value ?? scored?.id ?? views[0]?.value;
  const chosen = views.find((v) => v.value === asked)?.value ?? start;
  const places = board.activity.resultDecimals;
  if (!chosen) return <p className="hint">This pageant has no program yet.</p>;

  let body: React.ReactNode;
  if (chosen === PRELIMINARY) {
    const prelim = units.filter((u) => u.segment === "preliminary");
    const { weights, rows, complete } = standings(board, roundPool(board, prelim[0].id).entries, [PRELIMINARY]);
    body = (
      <section aria-labelledby="tally-view">
        <h2 id="tally-view" className="title-sm">
          Preliminary standings
        </h2>
        <p className="hint mt-1">{complete ? "Every preliminary score is in." : "Ranked once a candidate has a score in every preliminary sub-activity."}</p>
        <StandingsTable weights={weights} rows={rows} places={places} label="Preliminary standings" />
      </section>
    );
  } else if (chosen.startsWith("cut:")) {
    const unit = board.rounds.find((r) => r.id === chosen.slice(4))!;
    const plan = cutPlan(board, unit);
    const missing = plan.rows.filter((r) => !r.complete).length;
    body = (
      <section aria-labelledby="tally-view">
        <h2 id="tally-view" className="title-sm">
          {plan.final ? "Final cut" : "Cut"} after {unit.name}: Top {plan.size}
        </h2>
        <p className="hint mt-1">
          {unit.cutEntryIds
            ? "Confirmed."
            : missing
              ? `${missing} ${missing === 1 ? "candidate is" : "candidates are"} still missing scores.`
              : "Every score is in; not confirmed yet."}{" "}
          Ranked by {plan.weights.map((w) => `${w.round.name} ${percent(w.weight)}`).join(", ")}.
        </p>
        <StandingsTable weights={plan.weights} rows={plan.rows} places={places} line={plan.size} label={`Standings for the cut after ${unit.name}`} />
      </section>
    );
  } else {
    const round = board.rounds.find((r) => r.id === chosen)!;
    const progress = roundProgress(board, round);
    body = (
      <>
        <p className="hint">
          <span className="tabular font-semibold text-prussian">
            {progress.submitted} of {progress.possible}
          </span>{" "}
          scores in {roundLabel(board.rounds, round)}.
          {progress.blockedBy
            ? ` Judged once the ${progress.blockedBy.name} cut is confirmed.`
            : !roundReleased(round)
              ? " Held back from the audience until it's signed off."
              : ""}
        </p>
        <div className="mt-6">
          <EntryTally board={roundBoard(board, round)} official={official} noun="Candidate" />
        </div>
      </>
    );
  }

  return (
    <>
      <div>
        <label htmlFor="tally-of" className="label">
          Tally of
        </label>
        <select
          id="tally-of"
          className="field max-w-sm"
          value={chosen}
          onChange={(e) => choose(e.target.value)}
        >
          {(["preliminary", "proper"] as const).map((segment) => (
            <optgroup key={segment} label={segmentLabel(segment)}>
              {views
                .filter((v) => v.segment === segment)
                .map((v) => (
                  <option key={v.value} value={v.value}>
                    {v.label}
                  </option>
                ))}
            </optgroup>
          ))}
        </select>
      </div>
      <div className="mt-8">{body}</div>
    </>
  );
}
