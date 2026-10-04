"use server";

import { refresh } from "next/cache";
import { redirect } from "next/navigation";
import { findJudgeIdByCode, getActivity, getJudgeContext } from "@/lib/data";
import { isUuid } from "@/lib/codes";
import { parseScore } from "@/lib/scoring";
import { endJudgeSession, sessionJudgeId, startJudgeSession } from "@/lib/session";
import { db } from "@/lib/supabase/server";
import type { ActionResult } from "@/lib/types";

export type CodeState = { error?: string; code?: string };

export async function enterCode(_prev: CodeState, formData: FormData): Promise<CodeState> {
  const code = String(formData.get("code") ?? "");
  const judgeId = await findJudgeIdByCode(code);
  if (!judgeId) return { error: "That code doesn't match any judge. Check it with the organizer.", code };
  await startJudgeSession(judgeId);
  redirect("/judge/score");
}

export async function leavePortal() {
  await endJudgeSession();
  redirect("/judge");
}

export async function submitScore(entryId: string, typed: string): Promise<ActionResult> {
  const judgeId = await sessionJudgeId();
  const context = judgeId ? await getJudgeContext(judgeId) : null;
  if (!context) return { ok: false, error: "Your session has ended. Enter your code again." };
  if (!isUuid(entryId)) return { ok: false, error: "Pick an entry first." };

  const activity = await getActivity(context.activityId);
  if (!activity) return { ok: false, error: "This activity no longer exists." };

  // The organizer decides what is judged: only the entry on screen, and only while the session is live.
  if (activity.sessionState !== "live") return { ok: false, error: "Judging isn't open right now. Wait for the organizer." };
  if (activity.currentEntryId !== entryId) return { ok: false, error: "The organizer has moved to another entry. Score the one on your screen." };

  const parsed = parseScore(typed, activity);
  if (!parsed.ok) return parsed;

  const { error } = await db().from("scores").insert({
    activity_id: activity.id,
    entry_id: entryId,
    judge_id: context.judge.id,
    value: parsed.value,
  });

  if (error) {
    if (error.code === "23505") return { ok: false, error: "You already scored this entry. Submitted scores can't be changed." };
    if (error.code === "23503") return { ok: false, error: "This entry was removed by the organizer." };
    return { ok: false, error: "The score didn't save. Check your connection and try again." };
  }

  refresh();
  return { ok: true };
}
