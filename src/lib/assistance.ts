import "server-only";
import type { AdminSession } from "./session";
import { db, photoUrl } from "./supabase/server";

/**
 * Judges' calls for help (migration 032): a judge taps Assist me, and the organizer is alerted wherever they are in the
 * admin panel (see AssistanceAlerts) until they answer "On my way", or the judge no longer needs it.
 */

/** A judge's call, as the organizer's alert lists it. */
export type AssistanceRequest = {
  id: string;
  activityId: string;
  activityName: string;
  judgeName: string;
  judgePhotoUrl: string | null;
  /** When the judge asked (ISO time). */
  askedAt: string;
};

/** A judge's own last call, as their screen shows it: still waiting, or the organizer's on the way (for a while after). */
export type JudgeAssistance = { status: "open" | "answered"; at: string };

/** How long "The organizer is on the way" stays on the judge's screen after the organizer answers. */
const ANSWERED_SHOWS_MS = 10 * 60_000;

/** The most calls an alert lists at once: far more than any room has judges. */
const MAX_LISTED = 50;

/** A judge's last call: `current` null when there's nothing to show. Null before migration 032, when judges can't ask. */
export async function getJudgeAssistance(judgeId: string): Promise<{ current: JudgeAssistance | null } | null> {
  const { data, error } = await db()
    .from("assistance_requests")
    .select("created_at, answered_at")
    .eq("judge_id", judgeId)
    .is("cancelled_at", null)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) return null;
  const row = data as { created_at: string; answered_at: string | null } | null;
  if (!row) return { current: null };
  if (!row.answered_at) return { current: { status: "open", at: row.created_at } };
  return { current: Date.now() - Date.parse(row.answered_at) < ANSWERED_SHOWS_MS ? { status: "answered", at: row.answered_at } : null };
}

/** The calls still waiting in the activities this admin manages (not archived ones), oldest first. Null before migration 032. */
export async function getOpenAssistance(session: AdminSession): Promise<AssistanceRequest[] | null> {
  const query = db()
    .from("assistance_requests")
    .select("id, created_at, activity_id, judges(name, photo_path), activities!inner(name, owner_id, archived_at)")
    .is("answered_at", null)
    .is("cancelled_at", null)
    .is("activities.archived_at", null)
    .order("created_at", { ascending: true })
    .limit(MAX_LISTED);
  const { data, error } = await (session.kind === "super" ? query.is("activities.owner_id", null) : query.eq("activities.owner_id", session.admin.id));
  if (error) return null;
  type Row = { id: string; created_at: string; activity_id: string; judges: { name: string; photo_path: string | null } | null; activities: { name: string } | null };
  return (data as unknown as Row[]).map((r) => ({
    id: r.id,
    activityId: r.activity_id,
    activityName: r.activities?.name ?? "An activity",
    judgeName: r.judges?.name ?? "A judge",
    judgePhotoUrl: photoUrl(r.judges?.photo_path ?? null),
    askedAt: r.created_at,
  }));
}

/** The activities whose changes the alert listens for: this admin's, not archived, newest first (realtime takes up to 100). */
export async function getAlertActivityIds(session: AdminSession): Promise<string[]> {
  const query = db().from("activities").select("id").is("archived_at", null).order("created_at", { ascending: false }).limit(100);
  const { data, error } = await (session.kind === "super" ? query.is("owner_id", null) : query.eq("owner_id", session.admin.id));
  return error ? [] : (data as { id: string }[]).map((r) => r.id);
}
