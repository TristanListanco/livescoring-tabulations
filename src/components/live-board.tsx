"use client";

import { rulesSummary, scoreProgress } from "@/lib/scoring";
import type { Board } from "@/lib/types";
import { useLiveRefresh } from "@/lib/use-live-refresh";
import { LiveStatusBadge } from "./live-status";
import { Scoreboard } from "./scoreboard";

/**
 * Scoreboard plus its heading, kept current over realtime.
 * The public page follows the activity's ranking setting; the admin view (`embedded`) always ranks.
 */
export function LiveBoard({ board, embedded = false }: { board: Board; embedded?: boolean }) {
  const status = useLiveRefresh(board.activity.id);
  const { activity } = board;
  const ranked = embedded || activity.showRank;
  const { submitted, possible } = scoreProgress(board);

  const summary = `${ranked ? "Ranked by the average of the scores submitted so far." : "Averages of the scores submitted so far."} ${rulesSummary(activity)}`;

  return (
    <section className={`bg-prussian text-mint ${embedded ? "overflow-hidden rounded-2xl pb-2" : "min-h-dvh pb-10"}`}>
      <header
        className={`mx-auto flex max-w-[120rem] flex-wrap items-end justify-between gap-x-10 gap-y-3 px-6 ${
          embedded ? "pt-6 pb-5" : "pt-8 pb-8 lg:pt-14 lg:pb-10"
        }`}
      >
        <div className="min-w-0">
          {embedded ? (
            <h2 className="text-2xl font-bold">Live results</h2>
          ) : (
            <h1 className="text-[clamp(2rem,5vw,5rem)] leading-[1.02] font-bold tracking-tight text-balance">{activity.name}</h1>
          )}
          <p className="mt-3 max-w-[65ch] text-[clamp(0.95rem,1.1vw,1.25rem)] text-powder">{summary}</p>
          {embedded && !activity.showRank && (
            <p className="mt-2 text-sm font-semibold text-mint">Ranks are hidden on the public page. Change this in Settings.</p>
          )}
        </div>
        <div className="flex items-center gap-6">
          <p className="tabular text-[clamp(0.95rem,1.1vw,1.25rem)] text-powder">
            <span className="text-[1.4em] font-bold text-mint">{submitted}</span> of {possible} scores in
          </p>
          <LiveStatusBadge status={status} className="text-mint" />
        </div>
      </header>
      <Scoreboard board={board} ranked={ranked} />
    </section>
  );
}
