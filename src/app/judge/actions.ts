"use server";

import { changed } from "@/lib/live-cache";
import { redirect } from "next/navigation";
import { settleCorrection } from "@/lib/correction-settle";
import { cleanReason, correctionVoters } from "@/lib/corrections";
import { findJudgeIdByCode, getActivity, getBoard, getCorrections, getJudgeContext, getRounds } from "@/lib/data";
import { isUuid } from "@/lib/codes";
import { approvedDevice, signInJudgeDevice, touchJudge } from "@/lib/devices";
import { showColumns } from "@/lib/judging";
import { onPanel, SUBMIT_GRACE_MS, withRoundRules } from "@/lib/pageant";
import { cleanNote } from "@/lib/notes";
import { parseBreakdown, parseScore } from "@/lib/scoring";
import { endJudgeSession, judgeSession } from "@/lib/session";
import { clientAddress, LIMITS, recordFailure, TOO_MANY, tooManyFailures } from "@/lib/sign-in-limits";
import { db } from "@/lib/supabase/server";
import type { ActionResult } from "@/lib/types";

export type CodeState = { error?: string; code?: string };

export async function enterCode(_prev: CodeState, formData: FormData): Promise<CodeState> {
  const code = String(formData.get("code") ?? "").slice(0, 32);
  // Guessing codes is limited per network address (see sign-in-limits).
  const address = `judge-ip:${await clientAddress()}`;
  if (await tooManyFailures([[address, LIMITS.judgeAddress]])) return { error: TOO_MANY, code };
  const judgeId = await findJudgeIdByCode(code);
  if (!judgeId) {
    await recordFailure([address]);
    return { error: "That code doesn't match any judge. Check it with the organizer.", code };
  }
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
  changed();
}

/**
 * The chair of the board of judges shows judges the previous or next entry, as the organizer can from the
 * Session tab. The LED wall follows.
 */
export async function moveToEntry(entryId: string): Promise<ActionResult> {
  const session = await judgeSession();
  const context = session ? await getJudgeContext(session.judgeId) : null;
  if (!session || !context) return { ok: false, error: "Your session has ended. Enter your code again." };
  if (!(await approvedDevice(context.judge.id, session.deviceId))) {
    return { ok: false, error: "This device isn't approved. Ask the organizer." };
  }
  if (!context.judge.isChair) return { ok: false, error: "Only the organizer and the chair of the board of judges can move entries." };
  if (!isUuid(entryId)) return { ok: false, error: "Entry not found." };

  const board = await getBoard(context.activityId);
  if (!board || board.activity.sessionState !== "live") return { ok: false, error: "Judging isn't open right now." };
  if (!board.entries.some((e) => e.id === entryId)) return { ok: false, error: "That entry isn't part of this activity." };
  // In a pageant, only a chair on the panel of the sub-activity being judged moves it.
  const round = board.rounds.find((r) => r.id === board.activity.currentRoundId);
  if (round && !onPanel(context.judge, round)) return { ok: false, error: "You aren't judging this part of the pageant." };
  // In a pageant, only candidates in the sub-activity being judged; showing one starts its timer.
  const show = showColumns(board, entryId, Date.now());
  if ("error" in show) return { ok: false, error: show.error };

  const { error } = await db().from("activities").update(show.columns).eq("id", board.activity.id);
  if (error) return { ok: false, error: error.message };
  changed();
  return { ok: true };
}

/**
 * A judge's note on an entry of their activity, saved as they type; an empty note is removed. Only from their approved
 * device. The judge and the organizer read notes, never other judges.
 */
export async function saveNote(entryId: string, body: string): Promise<ActionResult> {
  const session = await judgeSession();
  const context = session ? await getJudgeContext(session.judgeId) : null;
  if (!session || !context) return { ok: false, error: "Your session has ended. Enter your code again." };
  if (!(await approvedDevice(context.judge.id, session.deviceId))) return { ok: false, error: "This device isn't approved. Ask the organizer." };
  if (!isUuid(entryId)) return { ok: false, error: "Entry not found." };
  const { data: entry } = await db().from("entries").select("id").eq("id", entryId).eq("activity_id", context.activityId).maybeSingle();
  if (!entry) return { ok: false, error: "This entry was removed by the organizer." };
  // An archived activity is kept as it was (every column read, so this works before migration 020 too).
  const { data: activity } = await db().from("activities").select("*").eq("id", context.activityId).maybeSingle();
  if ((activity as { archived_at?: string | null } | null)?.archived_at) return { ok: false, error: "This activity is archived, so notes can't change." };

  const text = cleanNote(body);
  const notes = db().from("judge_notes");
  const { error } = text
    ? await notes.upsert(
        { judge_id: context.judge.id, entry_id: entryId, activity_id: context.activityId, body: text, updated_at: new Date().toISOString() },
        { onConflict: "judge_id,entry_id" },
      )
    : await notes.delete().eq("judge_id", context.judge.id).eq("entry_id", entryId);
  if (error) {
    console.error(error);
    return { ok: false, error: "Your note didn't save. Check your connection." };
  }
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

  // A pageant scores in the sub-activity being judged, with its rules, and only while its timer runs.
  let rules = activity;
  let roundId: string | null = null;
  if (activity.kind === "pageant") {
    const round = (await getRounds(activity.id)).find((r) => r.id === activity.currentRoundId);
    if (!round) return { ok: false, error: "Judging isn't open right now. Wait for the organizer." };
    // The preliminary can have its own judges: only the panel of the sub-activity on screen scores it.
    if (!onPanel(context.judge, round)) return { ok: false, error: "You aren't judging this part of the pageant. Wait for your part." };
    if (round.timerSeconds && activity.scoringClosesAt && Date.now() > Date.parse(activity.scoringClosesAt) + SUBMIT_GRACE_MS) {
      return { ok: false, error: "Time's up, so scoring has closed for this candidate. Ask the organizer to reopen it." };
    }
    rules = withRoundRules(activity, round);
    roundId = round.id;
  }

  let value: number;
  let breakdown: Record<string, number> | null = null;
  if (rules.scoringMode === "criteria") {
    if (typeof typed !== "object") return { ok: false, error: "Score each criterion." };
    const parsed = parseBreakdown(typed, rules.criteria, rules.decimals);
    if (!parsed.ok) return parsed;
    value = parsed.total;
    breakdown = parsed.breakdown;
  } else {
    if (typeof typed !== "string") return { ok: false, error: "Enter a score." };
    const parsed = parseScore(typed, rules);
    if (!parsed.ok) return parsed;
    value = parsed.value;
  }

  const { error } = await db()
    .from("scores")
    .insert({
      activity_id: activity.id,
      entry_id: entryId,
      judge_id: context.judge.id,
      value,
      ...(breakdown ? { breakdown } : {}),
      ...(roundId ? { round_id: roundId } : {}),
    });

  if (error) {
    if (error.code === "23505") {
      return { ok: false, error: `You already scored this ${roundId ? "candidate here" : "entry"}. Submitted scores can't be changed.` };
    }
    if (error.code === "23503") return { ok: false, error: "This entry was removed by the organizer." };
    return { ok: false, error: "The score didn't save. Check your connection and try again." };
  }

  changed();
  return { ok: true };
}

const CORRECTIONS_UNAVAILABLE = "Score corrections need an update to the database. Ask the organizer.";
const sameBreakdown = (a: Record<string, number> | null, b: Record<string, number> | null) =>
  JSON.stringify(Object.entries(a ?? {}).sort()) === JSON.stringify(Object.entries(b ?? {}).sort());

/**
 * A judge asks to correct their own score on the entry on screen, saying why. It changes only if every other judge on
 * their panel agrees (a judge alone on their panel waits for the organizer). Only while judging is open, and in a
 * pageant only in the sub-activity being judged.
 */
export async function requestCorrection(entryId: string, typed: string | Record<string, string>, reason: string): Promise<ActionResult> {
  const session = await judgeSession();
  const context = session ? await getJudgeContext(session.judgeId) : null;
  if (!session || !context) return { ok: false, error: "Your session has ended. Enter your code again." };
  if (!(await approvedDevice(context.judge.id, session.deviceId))) return { ok: false, error: "This device isn't approved to score. Ask the organizer." };
  if (!isUuid(entryId)) return { ok: false, error: "Entry not found." };
  const why = cleanReason(reason);
  if (!why) return { ok: false, error: "Say why the score needs correcting, so the other judges can decide." };

  const activity = await getActivity(context.activityId);
  if (!activity) return { ok: false, error: "This activity no longer exists." };
  if (activity.sessionState !== "live") return { ok: false, error: "Corrections can only be asked for while judging is open." };
  if (activity.currentEntryId !== entryId) return { ok: false, error: "The organizer has moved on. Ask them to bring the entry back on screen to correct it." };

  let rules = activity;
  let roundId: string | null = null;
  if (activity.kind === "pageant") {
    const round = (await getRounds(activity.id)).find((r) => r.id === activity.currentRoundId);
    if (!round || !onPanel(context.judge, round)) return { ok: false, error: "You aren't judging this part of the pageant." };
    rules = withRoundRules(activity, round);
    roundId = round.id;
  }

  let value: number;
  let breakdown: Record<string, number> | null = null;
  if (rules.scoringMode === "criteria") {
    if (typeof typed !== "object") return { ok: false, error: "Score each criterion." };
    const parsed = parseBreakdown(typed, rules.criteria, rules.decimals);
    if (!parsed.ok) return parsed;
    value = parsed.total;
    breakdown = parsed.breakdown;
  } else {
    if (typeof typed !== "string") return { ok: false, error: "Enter a score." };
    const parsed = parseScore(typed, rules);
    if (!parsed.ok) return parsed;
    value = parsed.value;
  }

  const scores = db().from("scores").select("value, breakdown").eq("judge_id", context.judge.id).eq("entry_id", entryId);
  const { data: given } = await (roundId ? scores.eq("round_id", roundId) : scores.is("round_id", null)).maybeSingle();
  const old = given as { value: number | string; breakdown: Record<string, number | string> | null } | null;
  if (!old) return { ok: false, error: "You haven't scored this entry yet." };
  const oldBreakdown = old.breakdown ? Object.fromEntries(Object.entries(old.breakdown).map(([id, v]) => [id, Number(v)])) : null;
  if (Number(old.value) === value && sameBreakdown(oldBreakdown, breakdown)) return { ok: false, error: "That's the score you already gave." };

  const { error } = await db()
    .from("score_corrections")
    .insert({
      activity_id: activity.id,
      judge_id: context.judge.id,
      entry_id: entryId,
      round_id: roundId,
      old_value: Number(old.value),
      new_value: value,
      old_breakdown: oldBreakdown,
      new_breakdown: breakdown,
      reason: why,
    });
  if (error) {
    if (error.code === "23505") return { ok: false, error: "You've already asked to correct this score. Wait for the other judges, or withdraw it." };
    console.error(error);
    return { ok: false, error: error.code === "42P01" || error.code === "PGRST205" ? CORRECTIONS_UNAVAILABLE : "That didn't go through. Check your connection and try again." };
  }
  changed();
  return { ok: true };
}

/** Another judge's vote on a correction: final once cast. Any judge disagreeing turns it down; every judge agreeing changes the score. */
export async function voteOnCorrection(correctionId: string, agree: boolean): Promise<ActionResult> {
  const session = await judgeSession();
  const context = session ? await getJudgeContext(session.judgeId) : null;
  if (!session || !context) return { ok: false, error: "Your session has ended. Enter your code again." };
  if (!(await approvedDevice(context.judge.id, session.deviceId))) return { ok: false, error: "This device isn't approved. Ask the organizer." };
  if (!isUuid(correctionId)) return { ok: false, error: "That correction no longer exists." };

  const [board, corrections] = await Promise.all([getBoard(context.activityId), getCorrections(context.activityId)]);
  const correction = corrections?.find((c) => c.id === correctionId);
  if (!board || !correction) return { ok: false, error: "That correction no longer exists." };
  // Settled meanwhile (another judge disagreed, or it was withdrawn): nothing left to vote on.
  if (correction.status !== "open") return { ok: true };
  if (!correctionVoters(board, correction).some((j) => j.id === context.judge.id)) return { ok: false, error: "You don't vote on this correction." };

  const { error } = await db().from("correction_votes").insert({ correction_id: correction.id, judge_id: context.judge.id, activity_id: board.activity.id, agree });
  if (error && error.code !== "23505") {
    console.error(error);
    return { ok: false, error: "Your vote didn't go through. Check your connection and try again." };
  }
  if (!error) await settleCorrection(board, { ...correction, votes: [...correction.votes, { judgeId: context.judge.id, agree }] });
  changed();
  return { ok: true };
}

/** The judge who asked takes back a correction no one has settled yet. */
export async function withdrawCorrection(correctionId: string): Promise<ActionResult> {
  const session = await judgeSession();
  const context = session ? await getJudgeContext(session.judgeId) : null;
  if (!session || !context) return { ok: false, error: "Your session has ended. Enter your code again." };
  if (!(await approvedDevice(context.judge.id, session.deviceId))) return { ok: false, error: "This device isn't approved. Ask the organizer." };
  if (!isUuid(correctionId)) return { ok: false, error: "That correction no longer exists." };
  const { error } = await db()
    .from("score_corrections")
    .update({ status: "withdrawn", decided_at: new Date().toISOString() })
    .eq("id", correctionId)
    .eq("judge_id", context.judge.id)
    .eq("status", "open");
  if (error) {
    console.error(error);
    return { ok: false, error: "That didn't go through. Check your connection and try again." };
  }
  changed();
  return { ok: true };
}
