import "server-only";
import { toSessionState } from "./data";
import { activityInUse, type InUse } from "./in-use";
import { db } from "./supabase/server";

/**
 * The first of an account's activities judges are on (see activityInUse): `ownerId` null for the super admin's own.
 * Archived activities don't count.
 */
export async function accountInUse(ownerId: string | null): Promise<InUse | null> {
  const query = db().from("activities").select("id, name, session_state").is("archived_at", null).in("session_state", ["draft", "live", "deliberation"]);
  const { data } = await (ownerId ? query.eq("owner_id", ownerId) : query.is("owner_id", null));
  const activities = ((data ?? []) as { id: string; name: string; session_state: string }[]).map((a) => ({ id: a.id, name: a.name, sessionState: toSessionState(a.session_state) }));
  const drafts = activities.filter((a) => a.sessionState === "draft").map((a) => a.id);
  let waiting = new Set<string>();
  if (drafts.length) {
    const { data: judges } = await db().from("judges").select("id, activity_id").in("activity_id", drafts);
    const byJudge = new Map(((judges ?? []) as { id: string; activity_id: string }[]).map((j) => [j.id, j.activity_id]));
    if (byJudge.size) {
      const { data: devices } = await db().from("judge_devices").select("judge_id").in("judge_id", [...byJudge.keys()]).in("status", ["approved", "pending"]);
      waiting = new Set(((devices ?? []) as { judge_id: string }[]).map((d) => byJudge.get(d.judge_id)!));
    }
  }
  return activityInUse(activities, waiting);
}

