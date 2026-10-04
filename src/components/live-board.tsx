"use client";

import { rulesSummary, scoreProgress } from "@/lib/scoring";
import type { Board } from "@/lib/types";
import { useLiveRefresh } from "@/lib/use-live-refresh";
import { LiveStatusBadge } from "./live-status";
import { Scoreboard } from "./scoreboard";

/** The public live results: scoreboard plus its heading, kept current over realtime. Ranks follow the activity's setting. */
export function LiveBoard({ board }: { board: Board }) {
  const status = useLiveRefresh(board.activity.id);
  const { activity } = board;
  const ranked = activity.showRank;
  const { submitted, possible } = scoreProgress(board);

  const summary = `${ranked ? "Ranked by the average of the scores submitted so far." : "Averages of the scores submitted so far."} ${rulesSummary(activity)}`;

  return (
    <section className="min-h-dvh bg-prussian pb-10 text-mint">
      <header className="mx-auto flex max-w-[120rem] flex-wrap items-end justify-between gap-x-10 gap-y-3 px-6 pt-8 pb-8 lg:pt-14 lg:pb-10">
        <div className="min-w-0">
          <h1 className="text-[clamp(2rem,5vw,5rem)] leading-[1.02] font-bold tracking-tight text-balance">{activity.name}</h1>
          <p className="mt-3 max-w-[65ch] text-[clamp(0.95rem,1.1vw,1.25rem)] text-powder">{summary}</p>
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
