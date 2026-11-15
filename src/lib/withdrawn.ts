import { deliberatingRound, finalCutRound, judgesFor, judgingOrder, roundLabel, roundPool } from "./pageant";
import type { Board, Entry, Round } from "./types";

/**
 * An entry the organizer marks withdrawn (Entry.withdrawnAt): it can't go on, having withdrawn, fallen ill or been
 * disqualified. From then on it isn't ranked anywhere, isn't waited for (by a cut, the end of a segment, a deliberation
 * or the results) and can't be scored; the scores it had stay on record. Reinstating it puts it back, while that can't
 * undo anything already decided without it.
 */

/** The longest reason the organizer can give. */
export const MAX_WITHDRAWN_REASON = 120;

const noun = (board: Pick<Board, "activity">) => (board.activity.kind === "pageant" ? "candidate" : "entry");

/** Why an entry can't be withdrawn now, or null when it can. */
export function withdrawGap(board: Board, entry: Entry): string | null {
  const { activity } = board;
  if (activity.sessionState === "draft") return `Judging hasn't started, so remove the ${noun(board)} instead.`;
  if (activity.sessionState === "deliberation") return `The judges are deliberating, so the ${noun(board)}s can't change now.`;
  if (activity.sessionState === "ended") return "Judging has ended.";
  if (activity.currentEntryId === entry.id) return `${entry.name} is on the judges' screens. Show another ${noun(board)} first.`;
  if (activity.kind === "pageant") {
    // Its judges are signing what they reviewed: the candidates it ranks can't change under them.
    const deliberating = deliberatingRound(board);
    if (deliberating) return `The judges are deliberating ${roundLabel(board.rounds, deliberating)}. Sign it off first.`;
    if (finalCutRound(board.rounds)?.cutEntryIds) return "The final placements are confirmed.";
  }
  return null;
}

/** Whether every judge of a sub-activity (or part) has scored this candidate in it. */
const scoredIn = (board: Board, round: Round, entryId: string) =>
  judgesFor(board, round).every((j) => board.scores.some((s) => s.roundId === round.id && s.entryId === entryId && s.judgeId === j.id));

/**
 * Why a withdrawn entry can't be reinstated now, or null when it can: judging is still live, and in a pageant nothing
 * already decided went ahead without them (a confirmed cut they were up for, a sub-activity signed off or being
 * deliberated without their scores, or the end of the preliminary without them).
 */
export function reinstateGap(board: Board, entry: Entry): string | null {
  const { activity } = board;
  if (activity.sessionState !== "live") return activity.sessionState === "deliberation" ? "The judges are deliberating, so it can't change now." : "Judging isn't live.";
  if (activity.kind !== "pageant") return null;
  const inPool = (round: Round) => roundPool(board, round.id).entries.some((e) => e.id === entry.id);
  for (const round of board.rounds) {
    if (round.cutEntryIds && inPool(round) && !round.cutEntryIds.includes(entry.id)) return `The ${round.name} cut was confirmed without ${entry.name}.`;
  }
  for (const round of judgingOrder(board.rounds)) {
    if (!inPool(round) || scoredIn(board, round, entry.id)) continue;
    const name = roundLabel(board.rounds, round);
    if (round.signedOffAt || round.deliberationStartedAt) return `${name} went ahead without ${entry.name}'s scores.`;
    if (round.segment === "preliminary" && activity.preliminaryEndedAt) return `The preliminary ended without ${entry.name}'s scores in ${name}.`;
  }
  return null;
}
