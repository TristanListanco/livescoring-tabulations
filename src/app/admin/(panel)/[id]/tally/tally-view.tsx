"use client";

import { useRouter } from "next/navigation";
import { useEffect, useSyncExternalStore } from "react";
import { ShowStatus } from "@/components/show-status";
import { averageText, formatBound, formatScore, judgeSheet, rankEntries, scoreProgress, scoreText } from "@/lib/scoring";
import type { Board } from "@/lib/types";
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
 * ended). Partial and unofficial until every judge has signed and the session has ended; official from then on. Made
 * hard to leak: it can't be selected, copied or printed, it blurs when the page is out of view, and it carries the
 * viewer's name and the time. A browser can't stop a screenshot outright; the watermark makes one traceable. It locks
 * itself when the unlock runs out.
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

  const { activity, judges } = board;
  const rows = [...rankEntries(board.entries, judges, board.scores, activity)].sort((a, b) => a.number - b.number);
  const { submitted, possible } = scoreProgress(board);
  const criteria = activity.scoringMode === "criteria" ? activity.criteria : [];
  // Official once the judges have signed (which ends the session); a correction after that voids their signatures.
  const official = activity.signedOffAt !== null;
  const mark = watermark(`${official ? "Official" : "Unofficial"} · ${viewer}${minute === null ? "" : ` · ${stampFormat.format(new Date(minute * 60_000))}`}`);
  const about = official
    ? "Every score as the judges signed it, after deliberating: the official results, the same as on the results PDF."
    : activity.sessionState === "deliberation"
      ? "Every score so far. The judges are deliberating: a score can still be corrected, and these become the official results only once every judge has signed."
      : "Every score as the judges submitted it, before they've deliberated and signed: for tabulating by hand if something fails during judging. A score can still be corrected, and only the results the judges sign are official.";
  const refuse = (e: React.SyntheticEvent) => e.preventDefault();
  const empty = <span className="text-prussian/40">—</span>;

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
            <h1 className="mt-2 text-3xl font-bold tracking-tight wrap-anywhere">{activity.name}</h1>
            <p className="hint mt-1 max-w-2xl">{about}</p>
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
          <section aria-labelledby="tally-by-entry">
            <h2 id="tally-by-entry" className="text-xl font-bold">
              By entry
            </h2>
            <div tabIndex={0} role="region" aria-label="Scores by entry" className="mt-3 overflow-x-auto">
              <table className="w-full min-w-[36rem] text-left">
                <thead className="border-b border-line text-sm text-prussian/70">
                  <tr>
                    <th className="py-2 pr-3 font-semibold">No.</th>
                    <th className="px-3 py-2 font-semibold">Entry</th>
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
              <h2 id="tally-by-criterion" className="text-xl font-bold">
                By judge and criterion
              </h2>
              <p className="hint mt-1">Each judge&apos;s points for each criterion, as they entered them.</p>
              {judges.map((j) => (
                <div key={j.id} className="mt-6">
                  <h3 className="text-lg font-bold">{j.name}</h3>
                  <div tabIndex={0} role="region" aria-label={`${j.name}'s points by criterion`} className="mt-2 overflow-x-auto">
                    <table className="w-full min-w-[36rem] text-left">
                      <thead className="border-b border-line text-sm text-prussian/70">
                        <tr>
                          <th className="py-2 pr-3 font-semibold">No.</th>
                          <th className="px-3 py-2 font-semibold">Entry</th>
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
