import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getBoard, getJudgeContext } from "@/lib/data";
import { sessionJudgeId } from "@/lib/session";
import { ScoringPanel } from "./scoring-panel";

export const metadata: Metadata = { title: "Scoring" };

export default async function ScorePage() {
  const judgeId = await sessionJudgeId();
  const context = judgeId ? await getJudgeContext(judgeId) : null;
  if (!context) redirect("/judge");

  const board = await getBoard(context.activityId);
  if (!board) redirect("/judge");

  // Judges only ever receive their own scores.
  const mine = board.scores.filter((s) => s.judgeId === context.judge.id).map((s) => ({ entryId: s.entryId, value: s.value }));

  return <ScoringPanel activity={board.activity} judge={context.judge} entries={board.entries} myScores={mine} />;
}
