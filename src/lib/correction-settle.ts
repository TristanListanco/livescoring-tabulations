import "server-only";
import { correctionOutcome, correctionVoters, type Correction } from "./corrections";
import { db } from "./supabase/server";
import type { Board } from "./types";

/**
 * Settles an open correction once its votes decide it (see correctionOutcome), as the organizer decides for a judge
 * alone on their panel, or as the judge decides their own (an event without live scoring). Approving changes the score
 * in the same database transaction (settle_score_correction), so a correction is never approved without its score
 * changing. "open": the votes don't decide it yet.
 */
export async function settleCorrection(
  board: Board,
  correction: Correction,
  decision?: { outcome: "approved" | "rejected"; by: "organizer" | "judge" },
): Promise<"approved" | "rejected" | "open" | "settled already"> {
  const outcome = decision?.outcome ?? correctionOutcome(correctionVoters(board, correction), correction.votes);
  if (outcome === "open") return "open";
  const { data, error } = await db().rpc("settle_score_correction", { correction: correction.id, outcome, decider: decision?.by ?? "judges" });
  if (error) throw new Error(error.message);
  return data === true ? outcome : "settled already";
}

/**
 * A judge's own correction, in an event without live scoring: approved by the judge as it's made, the score changing in
 * the same transaction. If it can't be applied (a database without migration 025, say), it's withdrawn rather than left
 * open, where it would hold up signing; the error says why.
 */
export async function applyOwnCorrection(correctionId: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const { data, error } = await db().rpc("settle_score_correction", { correction: correctionId, outcome: "approved", decider: "judge" });
  if (!error && data === true) return { ok: true };
  await db().from("score_corrections").update({ status: "withdrawn", decided_at: new Date().toISOString() }).eq("id", correctionId).eq("status", "open");
  return { ok: false, error: error?.message ?? "The correction was settled already." };
}
