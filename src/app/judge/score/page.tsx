import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getBoard, getDevice, getJudgeContext } from "@/lib/data";
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

  // Judges only ever receive their own scores, and nothing at all until their device is approved.
  const mine =
    gate.status === "approved"
      ? board.scores.filter((s) => s.judgeId === context.judge.id).map((s) => ({ entryId: s.entryId, value: s.value }))
      : [];

  // The chair of the board of judges sees who has scored the entry on screen (never the scores themselves), to know when to move on.
  const panel =
    gate.status === "approved" && context.judge.isChair
      ? board.judges.map((j) => ({
          id: j.id,
          name: j.name,
          photoUrl: j.photoUrl,
          scored: board.scores.some((s) => s.judgeId === j.id && s.entryId === board.activity.currentEntryId),
        }))
      : null;

  return <ScoringPanel activity={board.activity} judge={context.judge} entries={board.entries} myScores={mine} gate={gate} panel={panel} />;
}
