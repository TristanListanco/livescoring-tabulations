"use server";

import { changed } from "@/lib/live-cache";
import { redirect } from "next/navigation";
import { applyOwnCorrection, settleCorrection } from "@/lib/correction-settle";
import { cleanReason, correctionVoters } from "@/lib/corrections";
import { findJudgeIdByCode, getBoard, getCorrections, getJudgeContext, getJudgeSeat, getRounds, getSignatures } from "@/lib/data";
import { cleanSignature } from "@/lib/deliberation";
import { beginDeliberation, DELIBERATION_HINT } from "@/lib/deliberation-server";
import { isUuid } from "@/lib/codes";
import { signInJudgeDevice, touchJudge } from "@/lib/devices";
import { scoreWindowOpen, showColumns } from "@/lib/judging";
import { onPanel, SUBMIT_GRACE_MS, withRoundRules } from "@/lib/pageant";
import { cleanNote } from "@/lib/notes";
import { parseBreakdown, parseScore, rankEntries } from "@/lib/scoring";
import { tieKey, tiesIn, unbrokenTies } from "@/lib/ties";
import { endJudgeSession, judgeSession } from "@/lib/session";
import { clientAddress, LIMITS, recordFailure, TOO_MANY, tooManyFailures } from "@/lib/sign-in-limits";
import { db } from "@/lib/supabase/server";
import type { ActionResult, Activity, Judge } from "@/lib/types";
import { traced } from "@/lib/observe";
import { log } from "@/lib/log";

export type CodeState = { error?: string; code?: string };

const NOT_APPROVED = "This device isn't approved. Ask the organizer.";

/**
 * The signed-in judge on their approved device, with their activity: what every judge action checks first, read in
 * one trip to the database (see getJudgeSeat), since judges across every activity running at once pay for each trip
 * on every tap. Or why not, as the action's result.
 */
async function seat(notApproved = NOT_APPROVED): Promise<{ judge: Judge; activity: Activity; activityId: string } | { ok: false; error: string }> {
  const session = await judgeSession();
  const found = session ? await getJudgeSeat(session.judgeId, session.deviceId) : null;
  if (!session || !found) return { ok: false, error: "Your session has ended. Enter your code again." };
  const { judge, activity, device } = found;
  if (!device || device.judgeId !== judge.id || device.status !== "approved") return { ok: false, error: notApproved };
  return { judge, activity, activityId: activity.id };
}

export const enterCode = traced("enterCode", async function enterCode(_prev: CodeState, formData: FormData): Promise<CodeState> {
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
});

/**
 * A judge on this device, signed in and not signed out by the organizer: approved or still waiting for approval. Calling
 * for help needs no more than that, since a judge waiting to be approved is often the one who needs it.
 */
async function signedInJudge(): Promise<{ judgeId: string; activityId: string } | null> {
  const session = await judgeSession();
  const found = session ? await getJudgeSeat(session.judgeId, session.deviceId) : null;
  if (!session || !found?.device || found.device.judgeId !== found.judge.id || found.device.status === "revoked") return null;
  return { judgeId: found.judge.id, activityId: found.activity.id };
}

const NEEDS_HELP_UPDATE = "Asking for help needs a database update. Wave to the organizer instead.";

/**
 * Assist me: the organizer is alerted wherever they are in the admin panel (see AssistanceAlerts), and comes over. Asking
 * again while a call is waiting is the same call.
 */
export const requestAssistance = traced("requestAssistance", async function requestAssistance(): Promise<ActionResult> {
  const judge = await signedInJudge();
  if (!judge) return { ok: false, error: "Your session has ended. Enter your code again." };
  const { error } = await db().from("assistance_requests").insert({ activity_id: judge.activityId, judge_id: judge.judgeId });
  // One waiting call per judge (assistance_one_open_idx): this one's already in.
  if (error && error.code !== "23505") {
    if (/assistance_requests/.test(error.message)) return { ok: false, error: NEEDS_HELP_UPDATE };
    log("error", "assistance_not_sent", { code: error.code, error: error.message });
    return { ok: false, error: "Your call didn't go through. Check your connection, or wave to the organizer." };
  }
  changed();
  return { ok: true };
});

/** The judge no longer needs the organizer: their waiting call is taken back. */
export const cancelAssistance = traced("cancelAssistance", async function cancelAssistance(): Promise<ActionResult> {
  const judge = await signedInJudge();
  if (!judge) return { ok: false, error: "Your session has ended. Enter your code again." };
  const { error } = await db()
    .from("assistance_requests")
    .update({ cancelled_at: new Date().toISOString() })
    .eq("judge_id", judge.judgeId)
    .is("answered_at", null)
    .is("cancelled_at", null);
  if (error) return { ok: false, error: /assistance_requests/.test(error.message) ? NEEDS_HELP_UPDATE : "That didn't go through. Try again." };
  changed();
  return { ok: true };
});

/** Signing out also signs this device out for good: signing in again asks the organizer for approval again. */
export const leavePortal = traced("leavePortal", async function leavePortal() {
  const session = await judgeSession();
  if (session?.deviceId && isUuid(session.deviceId)) {
    await db().from("judge_devices").update({ status: "revoked", decided_at: new Date().toISOString() }).eq("id", session.deviceId).eq("judge_id", session.judgeId);
    await touchJudge(session.judgeId);
  }
  await endJudgeSession();
  redirect("/judge");
});

/** For a device the organizer turned away or signed out: ask for approval again with a new pairing code. */
export const requestApproval = traced("requestApproval", async function requestApproval() {
  const session = await judgeSession();
  if (!session || !(await getJudgeContext(session.judgeId))) redirect("/judge");
  await signInJudgeDevice(session.judgeId);
  changed();
});

/**
 * The chair of the board of judges shows judges the previous or next entry, as the organizer can from the
 * Session tab. The LED wall follows.
 */
export const moveToEntry = traced("moveToEntry", async function moveToEntry(entryId: string): Promise<ActionResult> {
  const context = await seat();
  if ("error" in context) return context;
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
  if (error) {
    log("error", "entry_not_shown", { code: error.code, error: error.message });
    return { ok: false, error: "That didn't go through. Check your connection and try again." };
  }
  changed(context.activity.publicId);
  return { ok: true };
});

/**
 * A judge's note on an entry of their activity, saved as they type; an empty note is removed. Only from their approved
 * device. The judge and the organizer read notes, never other judges.
 */
export const saveNote = traced("saveNote", async function saveNote(entryId: string, body: string): Promise<ActionResult> {
  const context = await seat();
  if ("error" in context) return context;
  if (!isUuid(entryId)) return { ok: false, error: "Entry not found." };
  const { data: entry } = await db().from("entries").select("id").eq("id", entryId).eq("activity_id", context.activityId).maybeSingle();
  if (!entry) return { ok: false, error: "This entry was removed by the organizer." };
  // An archived activity is kept as it was.
  if (context.activity.archivedAt) return { ok: false, error: "This activity is archived, so notes can't change." };

  const text = cleanNote(body);
  const notes = db().from("judge_notes");
  const { error } = text
    ? await notes.upsert(
        { judge_id: context.judge.id, entry_id: entryId, activity_id: context.activityId, body: text, updated_at: new Date().toISOString() },
        { onConflict: "judge_id,entry_id" },
      )
    : await notes.delete().eq("judge_id", context.judge.id).eq("entry_id", entryId);
  if (error) {
    log("error", "note_not_saved", { code: error.code, error: error.message });
    return { ok: false, error: "Your note didn't save. Check your connection." };
  }
  return { ok: true };
});

/** A score: one value for simple activities, or points per criterion (keyed by criterion id) for criteria activities. */
export const submitScore = traced("submitScore", async function submitScore(entryId: string, typed: string | Record<string, string>): Promise<ActionResult> {
  const context = await seat("This device isn't approved to score. Ask the organizer.");
  if ("error" in context) return context;
  if (!isUuid(entryId)) return { ok: false, error: "Pick an entry first." };

  const { activity } = context;

  // The organizer decides what is judged: only the entry on screen (or, for a few seconds, the one they just moved on
  // from, for a score confirmed before the move), and only while the session is live. The database checks the session too.
  if (activity.sessionState !== "live") return { ok: false, error: "Judging isn't open right now. Wait for the organizer." };
  if (!scoreWindowOpen(activity, entryId, Date.now())) return { ok: false, error: "The organizer has moved to another entry. Score the one on your screen." };

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
      // Already in. The same score is this one sent again (its reply was lost on the way, say): it's saved.
      const saved = db().from("scores").select("value, breakdown").eq("judge_id", context.judge.id).eq("entry_id", entryId);
      const { data } = await (roundId ? saved.eq("round_id", roundId) : saved.is("round_id", null)).maybeSingle();
      const row = data as { value: number | string; breakdown: Record<string, number> | null } | null;
      if (row && Number(row.value) === value && sameBreakdown(row.breakdown, breakdown)) return { ok: true };
      return { ok: false, error: `You already scored this ${roundId ? "candidate here" : "entry"}. Submitted scores can't be changed.` };
    }
    if (error.code === "23503") return { ok: false, error: "This entry was removed by the organizer." };
    // The session ended (or the deliberation started) as the score arrived: the database turns it away (migration 028).
    if (error.code === "55000") return { ok: false, error: "Judging isn't open right now. Wait for the organizer." };
    // The one write that matters most: why it failed goes to the log, beside the judge's own message.
    log("error", "score_not_saved", { activity: activity.id, entry: entryId, judge: context.judge.id, code: error.code, error: error.message });
    return { ok: false, error: "The score didn't save. Check your connection and try again." };
  }

  changed(context.activity.publicId);
  return { ok: true };
});

const CORRECTIONS_UNAVAILABLE = "Score corrections need an update to the database. Ask the organizer.";
const sameBreakdown = (a: Record<string, number> | null, b: Record<string, number> | null) =>
  JSON.stringify(Object.entries(a ?? {}).sort()) === JSON.stringify(Object.entries(b ?? {}).sort());

/**
 * A judge corrects their own score, saying why. In an event without live scoring (with it, a submitted score is final)
 * the correction is theirs to make: it's applied at once, with its reason recorded for the results PDF, until they've
 * signed their scores. While judging is open, the entry on screen; during the deliberation, any entry. In a pageant the
 * judge asks instead, in the sub-activity being judged: it changes only if every other judge on their panel agrees (a
 * judge alone on their panel waits for the organizer).
 */
export const requestCorrection = traced("requestCorrection", async function requestCorrection(entryId: string, typed: string | Record<string, string>, reason: string): Promise<ActionResult> {
  const context = await seat("This device isn't approved to score. Ask the organizer.");
  if ("error" in context) return context;
  if (!isUuid(entryId)) return { ok: false, error: "Entry not found." };
  const { activity } = context;
  // An event's judge corrects their own (live scoring off); a pageant's asks the rest of their panel.
  const own = activity.kind === "event";
  const why = cleanReason(reason);
  if (!why) return { ok: false, error: own ? "Say why the score needs correcting: it's kept with the correction." : "Say why the score needs correcting, so the other judges can decide." };

  if (activity.liveScoring && own) return { ok: false, error: "This event scores live, so submitted scores are final." };
  const deliberating = activity.sessionState === "deliberation";
  if (activity.sessionState !== "live" && !deliberating) return { ok: false, error: "Corrections can only be asked for while judging is open." };
  if (!deliberating && activity.currentEntryId !== entryId) {
    return { ok: false, error: "The organizer has moved on. Ask them to bring the entry back on screen to correct it." };
  }

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

  // Signed scores are the ones the judge stands by: they don't change after.
  if (own && deliberating) {
    const signatures = await getSignatures(activity.id);
    if (signatures?.some((s) => s.judgeId === context.judge.id)) return { ok: false, error: "You've signed your scores, so they can't change now." };
  }

  const { data: made, error } = await db()
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
    })
    .select("id")
    .single();
  if (error) {
    // An open one for this score: asked before the judges stopped voting on corrections, or in a pageant.
    if (error.code === "23505") return { ok: false, error: "A correction to this score is already waiting for the other judges. Wait for them, or withdraw it." };
    log("error", "correction_not_requested", { code: error.code, error: error.message });
    return { ok: false, error: error.code === "42P01" || error.code === "PGRST205" ? CORRECTIONS_UNAVAILABLE : "That didn't go through. Check your connection and try again." };
  }
  if (own) {
    const applied = await applyOwnCorrection((made as { id: string }).id);
    if (!applied.ok) {
      log("error", "correction_not_applied", { error: applied.error });
      return { ok: false, error: /Unknown outcome/.test(applied.error) ? CORRECTIONS_UNAVAILABLE : "Your correction didn't go through. Check your connection and try again." };
    }
  }
  changed(context.activity.publicId);
  return { ok: true };
});

/** Another judge's vote on a correction: final once cast. Any judge disagreeing turns it down; every judge agreeing changes the score. */
export const voteOnCorrection = traced("voteOnCorrection", async function voteOnCorrection(correctionId: string, agree: boolean): Promise<ActionResult> {
  // Exactly true or false: anything else (the text "false", say) could be stored one way and counted the other.
  if (typeof agree !== "boolean") return { ok: false, error: "Agree or disagree." };
  const context = await seat();
  if ("error" in context) return context;
  if (!isUuid(correctionId)) return { ok: false, error: "That correction no longer exists." };

  const [board, corrections] = await Promise.all([getBoard(context.activityId), getCorrections(context.activityId)]);
  const correction = corrections?.find((c) => c.id === correctionId);
  if (!board || !correction) return { ok: false, error: "That correction no longer exists." };
  // Settled meanwhile (another judge disagreed, or it was withdrawn): nothing left to vote on.
  if (correction.status !== "open") return { ok: true };
  if (!correctionVoters(board, correction).some((j) => j.id === context.judge.id)) return { ok: false, error: "You don't vote on this correction." };

  const { error } = await db().from("correction_votes").insert({ correction_id: correction.id, judge_id: context.judge.id, activity_id: board.activity.id, agree });
  if (error && error.code !== "23505") {
    log("error", "vote_not_saved", { code: error.code, error: error.message });
    return { ok: false, error: "Your vote didn't go through. Check your connection and try again." };
  }
  if (!error) await settleCorrection(board, { ...correction, votes: [...correction.votes, { judgeId: context.judge.id, agree }] });
  changed(context.activity.publicId);
  return { ok: true };
});

/** The chair of the board of judges opens the deliberation from their own screen, as the organizer can from the desk. */
export const startDeliberation = traced("startDeliberation", async function startDeliberation(): Promise<ActionResult> {
  const context = await seat();
  if ("error" in context) return context;
  if (!context.judge.isChair) return { ok: false, error: "Only the organizer and the chair of the board of judges can start the deliberation." };
  return beginDeliberation(context.activityId);
});

/**
 * A judge signs off on their scores at the end of the deliberation: their drawn signature (SVG path data, from a
 * touchscreen), or null for "(Sgd.)" ticked on a screen without touch. Not while a correction is open: they sign the
 * scores as they'll stand. Once every judge has signed, the organizer can end the session.
 */
export const signOff = traced("signOff", async function signOff(drawing: string | null): Promise<ActionResult> {
  const context = await seat();
  if ("error" in context) return context;
  const path = drawing === null ? null : cleanSignature(drawing);
  if (drawing !== null && !path) return { ok: false, error: "Draw your signature in the box, then sign." };

  const { activity } = context;
  const [corrections, signatures] = await Promise.all([getCorrections(context.activityId), getSignatures(context.activityId)]);
  if (activity.sessionState !== "deliberation") return { ok: false, error: "Signing opens during the deliberation." };
  if (signatures === null) return { ok: false, error: DELIBERATION_HINT };
  if (signatures.some((s) => s.judgeId === context.judge.id)) return { ok: true };
  if (corrections?.some((c) => c.status === "open")) return { ok: false, error: "A score correction is still open. Sign once it's settled." };
  // The judges sign the order the results print: every tie in the ranking is broken first.
  const board = await getBoard(context.activityId);
  if (board && unbrokenTies(rankEntries(board.entries, board.judges, board.scores, board.activity), board.tieBreaks ?? []).length) {
    return { ok: false, error: "A tie in the ranking isn't broken yet. Sign once the chair has broken it." };
  }

  const { error } = await db()
    .from("judge_signatures")
    .insert({ judge_id: context.judge.id, activity_id: activity.id, method: path ? "drawn" : "checked", drawing: path });
  if (error && error.code !== "23505") {
    log("error", "signature_not_saved", { code: error.code, error: error.message });
    return { ok: false, error: "Your signature didn't save. Check your connection and try again." };
  }
  changed(context.activity.publicId);
  return { ok: true };
});

/**
 * The chair of the board of judges breaks a tie in the ranking during the deliberation: the tied entries in the order
 * they place, highest first, and why. The scores stay as given. Every tie is broken before the judges sign; breaking
 * one (or changing a break) after some have signed voids their signatures (the database does it), so every judge signs
 * the order the results print.
 */
export const breakTie = traced("breakTie", async function breakTie(order: string[], reason: string): Promise<ActionResult> {
  const context = await seat();
  if ("error" in context) return context;
  if (!context.judge.isChair) return { ok: false, error: "Only the chair of the board of judges breaks a tie." };
  if (!Array.isArray(order) || order.length < 2 || order.some((id) => typeof id !== "string" || !isUuid(id)) || new Set(order).size !== order.length) {
    return { ok: false, error: "Put the tied entries in order." };
  }
  const why = cleanReason(reason);
  if (!why) return { ok: false, error: "Say why they place in this order: it's printed with the results." };

  const board = await getBoard(context.activityId);
  if (!board || board.activity.sessionState !== "deliberation") return { ok: false, error: "Ties are broken during the deliberation." };
  const tie = tiesIn(rankEntries(board.entries, board.judges, board.scores, board.activity)).find((t) => t.key === tieKey(order));
  if (!tie) return { ok: false, error: "Those entries aren't tied any more: a score changed. Check the tie again." };

  const { error } = await db()
    .from("tie_breaks")
    .upsert(
      { activity_id: board.activity.id, tie_key: tie.key, entry_ids: order, reason: why, judge_id: context.judge.id, created_at: new Date().toISOString() },
      { onConflict: "activity_id,tie_key" },
    );
  if (error) {
    log("error", "tie_not_broken", { code: error.code, error: error.message });
    return {
      ok: false,
      error: error.code === "42P01" || error.code === "PGRST205" ? "Breaking ties needs a database update. Ask the organizer." : "That didn't go through. Check your connection and try again.",
    };
  }
  changed(context.activity.publicId);
  return { ok: true };
});

/** The judge who asked takes back a correction no one has settled yet. */
export const withdrawCorrection = traced("withdrawCorrection", async function withdrawCorrection(correctionId: string): Promise<ActionResult> {
  const context = await seat();
  if ("error" in context) return context;
  if (!isUuid(correctionId)) return { ok: false, error: "That correction no longer exists." };
  const { error } = await db()
    .from("score_corrections")
    .update({ status: "withdrawn", decided_at: new Date().toISOString() })
    .eq("id", correctionId)
    .eq("judge_id", context.judge.id)
    .eq("status", "open");
  if (error) {
    log("error", "correction_not_withdrawn", { code: error.code, error: error.message });
    return { ok: false, error: "That didn't go through. Check your connection and try again." };
  }
  changed(context.activity.publicId);
  return { ok: true };
});
