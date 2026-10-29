import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { correctionView, correctionVoters, withoutValues } from "@/lib/corrections";
import { getBoard, getCorrections, getJudgeNotes, getJudgeSeat, getOwnBreakdown, getOwnBreakdowns, getSignatures } from "@/lib/data";
import { deliberationGap } from "@/lib/deliberation";
import { onPanel, showingBoard } from "@/lib/pageant";
import { judgeSession } from "@/lib/session";
import { averageText, rankEntries } from "@/lib/scoring";
import { applyTieBreaks, breakFor, tiesIn } from "@/lib/ties";
import { ScoringPanel, type CorrectionDecider, type DeviceGate } from "./scoring-panel";

export const metadata: Metadata = { title: "Scoring" };

export default async function ScorePage() {
  // Two trips to the database for the whole screen, not four in a row: every judge's screen in every activity running
  // at once reloads it after each change. First the judge, their activity and this device (and the judge's notes);
  // then the board, corrections, and (with criteria) the points behind the score on screen, all together. The notes
  // reach the screen only once the device is approved (see below).
  const session = await judgeSession();
  const [found, ownNotes] = session ? await Promise.all([getJudgeSeat(session.judgeId, session.deviceId), getJudgeNotes(session.judgeId)]) : [null, null];
  if (!session || !found) redirect("/judge");
  const context = { judge: found.judge, activityId: found.activity.id };
  const { device } = found;
  const onScreen = found.activity.currentEntryId;
  const deliberating = found.activity.sessionState === "deliberation";
  const [board, allCorrections, givenOnScreen, breakdowns, signatures] = await Promise.all([
    getBoard(context.activityId),
    getCorrections(context.activityId),
    onScreen ? getOwnBreakdown(context.judge.id, onScreen, found.activity.currentRoundId) : null,
    deliberating && found.activity.scoringMode === "criteria" ? getOwnBreakdowns(context.judge.id) : {},
    deliberating ? getSignatures(context.activityId) : null,
  ]);
  if (!board) redirect("/judge");
  // The device is gone, not just unapproved: the organizer reset the activity, which signs every device out. Back to
  // the sign-in, which says so.
  if (session.deviceId && !device) redirect("/judge");

  // Scoring opens only on the device the organizer approved for this judge.
  const gate: DeviceGate =
    device && device.judgeId === context.judge.id && device.status !== "revoked"
      ? device.status === "approved"
        ? { status: "approved" }
        : { status: "pending", pairingCode: device.pairingCode, label: device.label }
      : { status: "revoked" };

  // A pageant's judges see the sub-activity being judged: its rules, its candidates, and their scores in it.
  const { board: showing, round } = showingBoard(board);
  // The preliminary can have its own judges: a judge not on this sub-activity's panel waits for their part.
  const offPanel = round !== null && !onPanel(context.judge, round);

  // Judges only ever receive their own scores, and nothing at all until their device is approved.
  const mine =
    gate.status === "approved"
      ? showing.scores.filter((s) => s.judgeId === context.judge.id).map((s) => ({ entryId: s.entryId, value: s.value }))
      : [];

  // Their own notes on the entries, once the device is approved (null when notes aren't available: before migration 018).
  const notes = gate.status === "approved" && !offPanel ? ownNotes : null;

  // With criteria, the points this judge gave the entry on screen: listed under their score, and where a correction
  // of it starts.
  const breakdown =
    gate.status === "approved" &&
    showing.activity.scoringMode === "criteria" &&
    board.activity.currentEntryId === onScreen &&
    mine.some((s) => s.entryId === onScreen)
      ? givenOnScreen
      : null;

  // Score corrections (null before migration 019): the ones waiting for this judge's vote, and this judge's own latest
  // one on the entry on screen. An event with live scoring has none: a submitted score is final. Without it, the judges
  // who vote see only the reason, never the scores.
  const { activity } = board;
  const correctable = activity.kind === "pageant" || !activity.liveScoring;
  // Who decides this judge's corrections: the judge themself in an event (live scoring off: theirs to make, with a
  // reason); in a pageant the rest of their panel, or the organizer when they're alone on it.
  const decides: CorrectionDecider =
    activity.kind === "event" ? "self" : correctionVoters(board, { judgeId: context.judge.id, roundId: round?.id ?? null }).length > 0 ? "judges" : "organizer";
  const corrections =
    gate.status === "approved" && allCorrections && correctable
      ? {
          toVote: allCorrections
            .filter((c) => c.status === "open" && !c.votes.some((v) => v.judgeId === context.judge.id) && correctionVoters(board, c).some((j) => j.id === context.judge.id))
            .map((c) => (activity.liveScoring ? correctionView(board, c) : withoutValues(correctionView(board, c)))),
          mine:
            allCorrections
              .filter((c) => c.judgeId === context.judge.id && c.entryId === board.activity.currentEntryId && c.roundId === (round?.id ?? null) && c.status !== "withdrawn")
              .map((c) => correctionView(board, c))
              .at(-1) ?? null,
          decides,
        }
      : null;

  // The deliberation: every entry with this judge's score (and points per criterion), their latest correction on each,
  // whether any correction is still open (no one signs until it's settled), and who has signed.
  const deliberation =
    deliberating && gate.status === "approved"
      ? {
          breakdowns: breakdowns ?? {},
          mineByEntry: Object.fromEntries(
            (allCorrections ?? [])
              .filter((c) => c.judgeId === context.judge.id && c.status !== "withdrawn")
              .map((c) => [c.entryId, correctionView(board, c)] as const),
          ),
          anyOpen: (allCorrections ?? []).some((c) => c.status === "open"),
          signature: signatures?.find((s) => s.judgeId === context.judge.id) ?? null,
          signed: signatures?.length ?? 0,
          judgeCount: board.judges.length,
          // Before migration 021 there's nowhere to keep a signature.
          canSign: signatures !== null,
          // Ties in the ranking, for every judge to see before signing: which entries are level and how the chair broke
          // it. Only who's level: never the scores, which stay each judge's own.
          ties: (() => {
            const ranking = rankEntries(board.entries, board.judges, board.scores, board.activity);
            const row = new Map(ranking.map((r) => [r.entry.id, r]));
            return tiesIn(ranking).map((tie) => {
              const settled = breakFor(tie, board.tieBreaks ?? []);
              return {
                key: tie.key,
                place: tie.rank,
                entries: tie.entryIds.map((id) => ({ id, name: row.get(id)?.entry.name ?? "An entry", number: row.get(id)?.number ?? 0 })),
                broken: settled
                  ? { order: settled.entryIds, reason: settled.reason, by: board.judges.find((j) => j.id === settled.judgeId)?.name ?? null }
                  : null,
              };
            });
          })(),
          isChair: context.judge.isChair,
          chairName: board.judges.find((j) => j.isChair)?.name ?? null,
          // With the organizer's say-so, where each entry stands overall: rank and average, never another judge's score.
          ranking: activity.judgesSeeRanking
            ? applyTieBreaks(rankEntries(board.entries, board.judges, board.scores, activity), board.tieBreaks ?? []).map((row) => ({
                id: row.entry.id,
                rank: row.rank,
                number: row.number,
                name: row.entry.name,
                average: averageText(row.average, activity),
              }))
            : null,
        }
      : null;

  // The chair can open the deliberation once every judge has scored every entry (an event without live scoring).
  const deliberationReady = gate.status === "approved" && context.judge.isChair && deliberationGap(board) === null;

  // The chair of the board of judges sees who has scored the entry on screen (never the scores themselves), to know when to move on.
  const panel =
    gate.status === "approved" && context.judge.isChair && !offPanel
      ? showing.judges.map((j) => ({
          id: j.id,
          name: j.name,
          photoUrl: j.photoUrl,
          scored: showing.scores.some((s) => s.judgeId === j.id && s.entryId === showing.activity.currentEntryId),
        }))
      : null;

  return (
    <ScoringPanel
      // A fresh panel for each pageant sub-activity: the scores it remembers saving (until the refreshed page
      // has them) belong to the sub-activity they were given in, and must not mark a candidate scored in the next one.
      key={round?.id ?? "activity"}
      activity={showing.activity}
      judge={context.judge}
      entries={showing.entries}
      myScores={mine}
      notes={notes}
      breakdown={breakdown}
      corrections={corrections}
      deliberation={deliberation}
      deliberationReady={deliberationReady}
      gate={gate}
      panel={panel}
      round={round ? { name: round.name, timerSeconds: round.timerSeconds } : null}
      offPanel={offPanel}
      // The timer counts down on the server's clock. A Server Component renders once per request, so this is the request time.
      // eslint-disable-next-line react-hooks/purity
      serverNow={Date.now()}
    />
  );
}
