import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getBoard, getDevice, getJudgeContext } from "@/lib/data";
import { showingBoard } from "@/lib/pageant";
import { judgeSession } from "@/lib/session";
import { ScoringPanel, type DeviceGate } from "./scoring-panel";

export const metadata: Metadata = { title: "Scoring" };

export default async function ScorePage() {
  const session = await judgeSession();
  const context = session ? await getJudgeContext(session.judgeId) : null;
  if (!session || !context) redirect("/judge");

  const board = await getBoard(context.activityId);
  if (!board) redirect("/judge");

  // Scoring opens only on the device the organizer approved for this judge.
  const device = session.deviceId ? await getDevice(session.deviceId) : null;
  const gate: DeviceGate =
    device && device.judgeId === context.judge.id && device.status !== "revoked"
      ? device.status === "approved"
        ? { status: "approved" }
        : { status: "pending", pairingCode: device.pairingCode, label: device.label }
      : { status: "revoked" };

  // A pageant's judges see the sub-activity being judged: its rules, its candidates, and their scores in it.
  const { board: showing, round } = showingBoard(board);

  // Judges only ever receive their own scores, and nothing at all until their device is approved.
  const mine =
    gate.status === "approved"
      ? showing.scores.filter((s) => s.judgeId === context.judge.id).map((s) => ({ entryId: s.entryId, value: s.value }))
      : [];

  // The chair of the board of judges sees who has scored the entry on screen (never the scores themselves), to know when to move on.
  const panel =
    gate.status === "approved" && context.judge.isChair
      ? showing.judges.map((j) => ({
          id: j.id,
          name: j.name,
          photoUrl: j.photoUrl,
          scored: showing.scores.some((s) => s.judgeId === j.id && s.entryId === showing.activity.currentEntryId),
        }))
      : null;

  return (
    <ScoringPanel
      activity={showing.activity}
      judge={context.judge}
      entries={showing.entries}
      myScores={mine}
      gate={gate}
      panel={panel}
      round={round ? { name: round.name, timerSeconds: round.timerSeconds } : null}
      // The timer counts down on the server's clock. A Server Component renders once per request, so this is the request time.
      // eslint-disable-next-line react-hooks/purity
      serverNow={Date.now()}
    />
  );
}
