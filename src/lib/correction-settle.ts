import "server-only";
import { correctionOutcome, correctionVoters, type Correction } from "./corrections";
import { db } from "./supabase/server";
import type { Board } from "./types";

/**
 * Settles an open correction once its votes decide it (see correctionOutcome), or as the organizer decides for a judge
 * alone on their panel. Approving changes the score in the same database transaction (settle_score_correction), so a
 * correction is never approved without its score changing. "open": the votes don't decide it yet.
 */
export async function settleCorrection(
  board: Board,
  correction: Correction,
  decision?: { outcome: "approved" | "rejected"; by: "organizer" },
): Promise<"approved" | "rejected" | "open" | "settled already"> {
  const outcome = decision?.outcome ?? correctionOutcome(correctionVoters(board, correction), correction.votes);
  if (outcome === "open") return "open";
  const { data, error } = await db().rpc("settle_score_correction", { correction: correction.id, outcome, decider: decision?.by ?? "judges" });
  if (error) throw new Error(error.message);
  return data === true ? outcome : "settled already";
}
