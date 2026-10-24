import "server-only";
import { deliberationGap } from "./deliberation";
import { getBoard } from "./data";
import { changed } from "./live-cache";
import { db } from "./supabase/server";
import type { ActionResult } from "./types";

export const DELIBERATION_HINT = "Deliberation needs a database update. Run supabase/migrations/021_deliberation.sql in the Supabase SQL editor.";

/**
 * Opens the deliberation, from the organizer's desk or the chair's screen: an event without live scoring, live, with
 * every entry scored by every judge. Judges' screens go from the keypad to reviewing their scores, so nothing is left on
 * their screens or the LED wall.
 */
export async function beginDeliberation(activityId: string): Promise<ActionResult> {
  const board = await getBoard(activityId);
  if (!board) return { ok: false, error: "This activity no longer exists." };
  const gap = deliberationGap(board);
  if (gap) return { ok: false, error: gap };
  const { error } = await db()
    .from("activities")
    .update({ session_state: "deliberation", current_entry_id: null })
    .eq("id", activityId)
    .eq("session_state", "live");
  if (error?.code === "55000") return { ok: false, error: "An entry was just added, so the judges score it before the deliberation." };
  if (error) return { ok: false, error: /session_state|deliberation/.test(error.message) ? DELIBERATION_HINT : "That didn't go through. Try again." };
  changed(board.activity.publicId);
  return { ok: true, message: "The judges are deliberating. Each one reviews their scores, then signs." };
}
