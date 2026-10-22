"use client";

import { showingBoard } from "@/lib/pageant";
import { rangeLabel, rulesSummary, scoreProgress } from "@/lib/scoring";
import type { Board } from "@/lib/types";
import { JUDGING_OVER, useLiveRefresh } from "@/lib/use-live-refresh";
import { useStage } from "@/lib/use-stage";
import { Scoreboard } from "./scoreboard";
import { ShowStatus } from "./show-status";

/**
 * The public live results: scoreboard plus its heading (with the organizer's logo, when they've added one), kept
 * current over realtime. Ranks follow the activity's setting. A pageant shows the sub-activity being judged, with only
 * the candidates still in the running. While the scores are held back, a tick shows each one that's in.
 *
 * On a projector or venue screen (a stage, see useStage) the page is exactly one screen: a shorter heading, the board
 * paging through long lists below it, and how the board works in its footer.
 */
export function LiveBoard({ board: full }: { board: Board }) {
  // The audience's page: one phone per person, so it checks for changes rather than holding a realtime connection
  // (with many activities at once, phones would be most of realtime's connections), at most one refresh every 2
  // seconds. A check reads one row; a refresh reads the shared server cache, cleared only by this activity's changes.
  // Between entries, when nothing changes, the checks stretch to every 12 seconds. Once judging has ended it checks
  // every half minute, and an archived activity's results are final: it doesn't check at all.
  const status = useLiveRefresh(
    full.activity.id,
    full.activity.sessionState === "ended"
      ? { ...JUDGING_OVER, enabled: !full.activity.archivedAt }
      : { pollMs: 4_000, minGapMs: 2_000, idleMaxMs: 12_000, realtime: false },
  );
  const stage = useStage();
  const { board, round } = showingBoard(full);
  const { activity } = board;
  const ranked = activity.showRank;
  const progress = scoreProgress(board);
  const waiting = activity.kind === "pageant" && !round;
  // Without live scoring the scores stay with the judges until they've deliberated and signed: the server sends only
  // which judge has scored which entry.
  const held = !activity.liveScoring && !activity.signedOffAt;
  const scored = held ? (full.scored ?? []) : undefined;
  const submitted = scored ? scored.length : progress.submitted;
  const { organizer } = full;

  // The audience needs the range, not the setup: decimal places are for the organizer and the judges' keypads.
  const rules = activity.scoringMode === "criteria" ? rulesSummary(activity) : `Judges score from ${rangeLabel(activity)}.`;
  const summary = held
    ? "A tick shows each score that's in. The scores themselves show here once the judges have deliberated and signed."
    : `${ranked ? "Ranked by the average of the scores submitted so far." : "Averages of the scores submitted so far."} ${rules}`;

  return (
    <section className={`bg-prussian text-mint ${stage ? "flex h-dvh flex-col overflow-hidden" : "min-h-dvh pb-10"}`}>
      <header
        className={`mx-auto flex w-full max-w-[120rem] flex-wrap items-end justify-between gap-x-10 gap-y-3 px-6 ${
          stage ? "shrink-0 pt-[4vh] pb-[3vh]" : "pt-8 pb-8 lg:pt-14 lg:pb-10"
        }`}
      >
        <div className="flex min-w-0 items-center gap-[clamp(1rem,2vw,2rem)]">
          {organizer && (
            // Already a small square from the upload, so the image optimizer adds nothing.
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={organizer.logoUrl}
              alt={organizer.name}
              className={`shrink-0 self-start rounded-2xl bg-white object-cover ${stage ? "" : "size-[clamp(3.5rem,7vw,8rem)]"}`}
              style={stage ? { width: "min(5.5vw, 9vh)", height: "min(5.5vw, 9vh)" } : undefined}
            />
          )}
          <div className="min-w-0">
            {round && (
              <p className="text-[clamp(1.1rem,1.6vw,1.75rem)] font-semibold text-powder" style={stage ? { fontSize: "min(1.6vw, 2.8vh)" } : undefined}>
                {round.name}
              </p>
            )}
            <h1
              className="text-[clamp(2rem,5vw,5rem)] leading-[1.02] font-bold tracking-tight text-balance"
              style={stage ? { fontSize: "min(3.6vw, 6.5vh)" } : undefined}
            >
              {activity.name}
            </h1>
            {!waiting && !stage && <p className="mt-3 max-w-[65ch] text-[clamp(0.95rem,1.1vw,1.25rem)] text-powder">{summary}</p>}
          </div>
        </div>
        <div className="flex items-center gap-6" style={stage ? { fontSize: "max(0.875rem, min(1.25vw, 2.3vh))" } : undefined}>
          {!waiting && (
            <p className={`tabular text-powder ${stage ? "" : "text-[clamp(0.95rem,1.1vw,1.25rem)]"}`}>
              <span className="text-[1.4em] font-bold text-mint">{submitted}</span> of {progress.possible} scores in
            </p>
          )}
          <ShowStatus activity={activity} connection={status} className={stage ? "text-mint text-[length:inherit]!" : "text-mint"} />
        </div>
      </header>
      {waiting ? (
        <p className="px-6 py-16 text-center text-[clamp(1.1rem,1.6vw,1.75rem)] text-powder">The next part of the pageant starts soon. Scores appear here as judges submit them.</p>
      ) : (
        <Scoreboard board={board} ranked={ranked && !held} scored={scored} stage={stage} footnote={summary} />
      )}
    </section>
  );
}
