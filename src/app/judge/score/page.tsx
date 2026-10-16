import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { correctionView, correctionVoters } from "@/lib/corrections";
import { getBoard, getCorrections, getDevice, getJudgeContext, getJudgeNotes, getOwnBreakdown } from "@/lib/data";
import { onPanel, showingBoard } from "@/lib/pageant";
import { judgeSession } from "@/lib/session";
import { ScoringPanel, type DeviceGate } from "./scoring-panel";

export const metadata: Metadata = { title: "Scoring" };

export default async function ScorePage() {
  const session = await judgeSession();
  const context = session ? await getJudgeContext(session.judgeId) : null;
  if (!session || !context) redirect("/judge");

  // The activity, this device and the judge's notes, read together. The notes reach the screen only once the device
  // is approved (see below).
  const [board, device, ownNotes, allCorrections] = await Promise.all([
    getBoard(context.activityId),
    session.deviceId ? getDevice(session.deviceId) : null,
    getJudgeNotes(context.judge.id),
    getCorrections(context.activityId),
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
    board.activity.currentEntryId &&
    mine.some((s) => s.entryId === board.activity.currentEntryId)
      ? await getOwnBreakdown(context.judge.id, board.activity.currentEntryId, round?.id ?? null)
      : null;

  // Score corrections (null before migration 019): the ones waiting for this judge's vote, which shows them the score
  // being changed, and this judge's own latest one on the entry on screen.
  const corrections =
    gate.status === "approved" && allCorrections
      ? {
          toVote: allCorrections
            .filter((c) => c.status === "open" && !c.votes.some((v) => v.judgeId === context.judge.id) && correctionVoters(board, c).some((j) => j.id === context.judge.id))
            .map((c) => correctionView(board, c)),
          mine:
            allCorrections
              .filter((c) => c.judgeId === context.judge.id && c.entryId === board.activity.currentEntryId && c.roundId === (round?.id ?? null) && c.status !== "withdrawn")
              .map((c) => correctionView(board, c))
              .at(-1) ?? null,
          // Who decides this judge's corrections: the rest of their panel, or the organizer when they're alone on it.
          othersVote: correctionVoters(board, { judgeId: context.judge.id, roundId: round?.id ?? null }).length > 0,
        }
      : null;

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
