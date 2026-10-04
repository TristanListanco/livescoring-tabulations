"use server";

import { refresh } from "next/cache";
import { redirect } from "next/navigation";
import { findJudgeIdByCode, getActivity, getJudgeContext } from "@/lib/data";
import { isUuid } from "@/lib/codes";
import { approvedDevice, signInJudgeDevice, touchJudge } from "@/lib/devices";
import { showEntryColumns } from "@/lib/judging";
import { parseBreakdown, parseScore } from "@/lib/scoring";
import { endJudgeSession, judgeSession } from "@/lib/session";
import { db } from "@/lib/supabase/server";
import type { ActionResult } from "@/lib/types";

export type CodeState = { error?: string; code?: string };

export async function enterCode(_prev: CodeState, formData: FormData): Promise<CodeState> {
  const code = String(formData.get("code") ?? "");
  const judgeId = await findJudgeIdByCode(code);
  if (!judgeId) return { error: "That code doesn't match any judge. Check it with the organizer.", code };
  const failed = await signInJudgeDevice(judgeId);
  if (failed) return { error: failed.error, code };
  redirect("/judge/score");
}

/** Signing out also signs this device out for good: signing in again asks the organizer for approval again. */
export async function leavePortal() {
  const session = await judgeSession();
  if (session?.deviceId && isUuid(session.deviceId)) {
    await db().from("judge_devices").update({ status: "revoked", decided_at: new Date().toISOString() }).eq("id", session.deviceId).eq("judge_id", session.judgeId);
    await touchJudge(session.judgeId);
  }
  await endJudgeSession();
  redirect("/judge");
}

/** For a device the organizer turned away or signed out: ask for approval again with a new pairing code. */
export async function requestApproval() {
  const session = await judgeSession();
  if (!session || !(await getJudgeContext(session.judgeId))) redirect("/judge");
  await signInJudgeDevice(session.judgeId);
  refresh();
}

/**
 * Board of tabulators: a judge the organizer allowed to move entries shows judges the previous or next one,
 * as the organizer can from the Session tab. The LED wall follows.
 */
export async function moveToEntry(entryId: string): Promise<ActionResult> {
  const session = await judgeSession();
  const context = session ? await getJudgeContext(session.judgeId) : null;
  if (!session || !context) return { ok: false, error: "Your session has ended. Enter your code again." };
  if (!(await approvedDevice(context.judge.id, session.deviceId))) {
    return { ok: false, error: "This device isn't approved. Ask the organizer." };
  }
  if (!context.judge.canMoveEntries) return { ok: false, error: "Only the organizer and the board of tabulators can move entries." };
  if (!isUuid(entryId)) return { ok: false, error: "Entry not found." };

  const activity = await getActivity(context.activityId);
  if (!activity || activity.sessionState !== "live") return { ok: false, error: "Judging isn't open right now." };
  const { data } = await db().from("entries").select("id").eq("id", entryId).eq("activity_id", activity.id).maybeSingle();
  if (!data) return { ok: false, error: "That entry isn't part of this activity." };

  const { error } = await db().from("activities").update(showEntryColumns(entryId)).eq("id", activity.id);
  if (error) return { ok: false, error: error.message };
  refresh();
  return { ok: true };
}

/** A score: one value for simple activities, or points per criterion (keyed by criterion id) for criteria activities. */
export async function submitScore(entryId: string, typed: string | Record<string, string>): Promise<ActionResult> {
  const session = await judgeSession();
  const context = session ? await getJudgeContext(session.judgeId) : null;
  if (!session || !context) return { ok: false, error: "Your session has ended. Enter your code again." };
  if (!(await approvedDevice(context.judge.id, session.deviceId))) {
    return { ok: false, error: "This device isn't approved to score. Ask the organizer." };
  }
  if (!isUuid(entryId)) return { ok: false, error: "Pick an entry first." };

  const activity = await getActivity(context.activityId);
  if (!activity) return { ok: false, error: "This activity no longer exists." };

  // The organizer decides what is judged: only the entry on screen, and only while the session is live.
  if (activity.sessionState !== "live") return { ok: false, error: "Judging isn't open right now. Wait for the organizer." };
  if (activity.currentEntryId !== entryId) return { ok: false, error: "The organizer has moved to another entry. Score the one on your screen." };

  let value: number;
  let breakdown: Record<string, number> | null = null;
  if (activity.scoringMode === "criteria") {
    if (typeof typed !== "object") return { ok: false, error: "Score each criterion." };
    const parsed = parseBreakdown(typed, activity.criteria, activity.decimals);
    if (!parsed.ok) return parsed;
    value = parsed.total;
    breakdown = parsed.breakdown;
  } else {
    if (typeof typed !== "string") return { ok: false, error: "Enter a score." };
    const parsed = parseScore(typed, activity);
    if (!parsed.ok) return parsed;
    value = parsed.value;
  }

  const { error } = await db()
    .from("scores")
    .insert({ activity_id: activity.id, entry_id: entryId, judge_id: context.judge.id, value, ...(breakdown ? { breakdown } : {}) });

  if (error) {
    if (error.code === "23505") return { ok: false, error: "You already scored this entry. Submitted scores can't be changed." };
    if (error.code === "23503") return { ok: false, error: "This entry was removed by the organizer." };
    return { ok: false, error: "The score didn't save. Check your connection and try again." };
  }

  refresh();
  return { ok: true };
}
