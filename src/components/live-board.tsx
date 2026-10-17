"use client";

import { useSyncExternalStore } from "react";
import { showingBoard } from "@/lib/pageant";
import { rulesSummary, scoreProgress } from "@/lib/scoring";
import type { Board } from "@/lib/types";
import { useLiveRefresh } from "@/lib/use-live-refresh";
import { LiveStatusBadge } from "./live-status";
import { Scoreboard } from "./scoreboard";

/**
 * The public live results: scoreboard plus its heading, kept current over realtime. Ranks follow the activity's
 * setting. A pageant shows the sub-activity being judged, with only the candidates still in the running.
 */
export function LiveBoard({ board: full }: { board: Board }) {
  // The audience's page: one phone per person, so it checks for changes rather than holding a realtime connection
  // (with many activities at once, phones would be most of realtime's connections), at most one refresh every 2
  // seconds. A check reads one row; a refresh reads the shared server cache, cleared only by this activity's changes.
  const status = useLiveRefresh(full.activity.id, { pollMs: 4_000, minGapMs: 2_000, realtime: false });
  const { board, round } = showingBoard(full);
  const { activity } = board;
  const ranked = activity.showRank;
  const { submitted, possible } = scoreProgress(board);
  const waiting = activity.kind === "pageant" && !round;
  // Without live scoring the scores stay with the judges (the server sends none) until they've deliberated and signed.
  const held = !activity.liveScoring && !activity.signedOffAt;

  const summary = held
    ? "The results show here once the judges have deliberated and signed."
    : `${ranked ? "Ranked by the average of the scores submitted so far." : "Averages of the scores submitted so far."} ${rulesSummary(activity)}`;

  return (
    <section className="min-h-dvh bg-prussian pb-10 text-mint">
      <header className="mx-auto flex max-w-[120rem] flex-wrap items-end justify-between gap-x-10 gap-y-3 px-6 pt-8 pb-8 lg:pt-14 lg:pb-10">
        <div className="min-w-0">
          {round && <p className="text-[clamp(1.1rem,1.6vw,1.75rem)] font-semibold text-powder">{round.name}</p>}
          <h1 className="text-[clamp(2rem,5vw,5rem)] leading-[1.02] font-bold tracking-tight text-balance">{activity.name}</h1>
          {!waiting && <p className="mt-3 max-w-[65ch] text-[clamp(0.95rem,1.1vw,1.25rem)] text-powder">{summary}</p>}
        </div>
        <div className="flex items-center gap-6">
          {!waiting && !held && (
            <p className="tabular text-[clamp(0.95rem,1.1vw,1.25rem)] text-powder">
              <span className="text-[1.4em] font-bold text-mint">{submitted}</span> of {possible} scores in
            </p>
          )}
          {activity.sessionState === "ended" ? (
            <EndedBadge endedAt={activity.sessionEndedAt} />
          ) : activity.sessionState === "deliberation" ? (
            <p className="inline-flex items-center gap-2 text-sm font-semibold text-mint">
              <span aria-hidden className="size-2.5 rounded-full bg-powder" />
              Judges deliberating
            </p>
          ) : (
            <LiveStatusBadge status={status} className="text-mint" />
          )}
        </div>
      </header>
      {waiting ? (
        <p className="px-6 py-16 text-center text-[clamp(1.1rem,1.6vw,1.75rem)] text-powder">The next part of the pageant starts soon. Scores appear here as judges submit them.</p>
      ) : (
        <Scoreboard board={board} ranked={ranked} />
      )}
    </section>
  );
}

const endedFormat = new Intl.DateTimeFormat("en", { dateStyle: "medium", timeStyle: "short" });
const noSubscription = () => () => {};

/**
 * Once judging has ended, the results are final: "Ended", with when, in place of the connection's "Live". The time is
 * written on the viewer's device, in their time zone (the server's could differ), so the server render says "Ended".
 */
function EndedBadge({ endedAt }: { endedAt: string | null }) {
  const onDevice = useSyncExternalStore(
    noSubscription,
    () => true,
    () => false,
  );
  return (
    <p className="inline-flex items-center gap-2 text-sm font-semibold text-mint">
      <span aria-hidden className="size-2.5 rounded-full bg-powder/60" />
      <span>
        Ended
        {endedAt && onDevice && (
          <>
            {" "}
            · <time dateTime={endedAt}>{endedFormat.format(new Date(endedAt))}</time>
          </>
        )}
      </span>
    </p>
  );
}
