"use server";

import { changed } from "@/lib/live-cache";
import { redirect } from "next/navigation";
import { isUuid, newAccessCode, newFileTag, newPublicId } from "@/lib/codes";
import { randomUUID } from "node:crypto";
import { getActivity, getAdminBoard, getAdminCredentials, getBoard } from "@/lib/data";
import { hashPassword, verifyPassword } from "@/lib/password";
import { checkScoring, type Scoring, type ScoringInput } from "@/lib/scoring-rules";
import {
  checkSuperAdminPassword,
  currentAdmin,
  endAdminSession,
  requireAdmin,
  requireSuperAdmin,
  startOrganizerSession,
  startSuperAdminSession,
  type AdminSession,
} from "@/lib/session";
import { touchJudge } from "@/lib/devices";
import { isProductionSite } from "@/lib/environment";
import { showColumns, showEntryColumns } from "@/lib/judging";
import { toLedFont, toLedShape, toLedTheme, type LedFont, type LedShape, type LedTheme } from "@/lib/led-style";
import { cutPlan, cutResult, deductionsOpen, judgingOrder, partsOf, programOrder, roundLabel, roundPool, roundProgress, waitsForPreliminary } from "@/lib/pageant";
import { chairGap, checkPageant, deductionPoints, MAX_DEDUCTION, MAX_REASON, panelGap, parsePageantDraft, type CheckedRound } from "@/lib/pageant-setup";
import { formatBound } from "@/lib/scoring";
import { fullName, isPersonName, MAX_NAME_PART } from "@/lib/names";
import { db, PHOTO_BUCKET } from "@/lib/supabase/server";
import { newFileTag as newCriterionId } from "@/lib/codes";
import {
  PRELIMINARY,
  type ActionResult,
  type Board,
  type CriteriaDisplay,
  type JudgePanel,
  type ResultDecimals,
  type SessionState,
} from "@/lib/types";

export type FormResult = ActionResult | null;

const MAX_JUDGES = 20;
const MAX_ENTRIES = 300;
const MAX_NAME = 120;
const MAX_PHOTO_BYTES = 2 * 1024 * 1024;

const ok = (message?: string): ActionResult => ({ ok: true, message });
const err = (error: string): ActionResult => ({ ok: false, error });
/**
 * A database that's missing a migration. The super admin is the developer, so they get the exact file to run;
 * an organizer can't run it, so they're told who can, and the file goes to the server log.
 */
async function needsMigration(hint: string): Promise<ActionResult> {
  if ((await currentAdmin())?.kind === "super") return err(hint);
  console.error(hint);
  return err("This needs a database update. Ask your LiveScoring administrator to apply it, then try again.");
}

/** A database failure the organizer can't fix from the panel: the details go to the server log, not the screen. */
const dbErr = (error: { message: string }): ActionResult => {
  console.error(error);
  return err("That didn't save. Check the connection and try again.");
};
const NOT_FOUND = err("Activity not found.");

function check(error: { message: string } | null) {
  if (error) throw new Error(error.message);
}

function cleanName(value: FormDataEntryValue | null): string {
  return String(value ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_NAME);
}

function entryNames(value: FormDataEntryValue | null): string[] {
  return String(value ?? "")
    .split(/\r?\n/)
    .map((line) => line.replace(/\s+/g, " ").trim().slice(0, MAX_NAME))
    .filter(Boolean);
}

function photoFile(value: FormDataEntryValue | null): File | null | "invalid" {
  if (!(value instanceof File) || value.size === 0) return null;
  if (value.size > MAX_PHOTO_BYTES || !value.type.startsWith("image/")) return "invalid";
  return value;
}

/**
 * Simple scoring (min to max) or criteria (max points per criterion, adding up to 100; judges' totals
 * are then out of 100), from the create form. The rules themselves live in checkScoring.
 */
function readScoring(formData: FormData): { scoring: Scoring } | { error: string } {
  const displayValue = formData.get("criteria_display");
  const display: CriteriaDisplay | null = displayValue === "ten" ? "ten" : displayValue === "percent" ? "percent" : null;
  const mode = formData.get("scoring_mode") === "criteria" ? "criteria" : "simple";
  let criteria: unknown = [];
  if (mode === "criteria") {
    try {
      criteria = JSON.parse(String(formData.get("criteria") ?? "[]"));
    } catch {
      return { error: "The criteria couldn't be read. Try again." };
    }
    if (!Array.isArray(criteria)) return { error: "Add at least one criterion." };
  }
  return checkScoring(
    {
      mode,
      min: String(formData.get("min") ?? ""),
      max: String(formData.get("max") ?? ""),
      decimals: Number(formData.get("decimals")),
      criteria: criteria as ScoringInput["criteria"],
      display,
    },
    newCriterionId,
  );
}

/** Columns for the scoring rules. The criteria columns are only written when they matter, so simple activities work on databases without migration 006. */
function scoringColumns(scoring: Scoring): Record<string, unknown> {
  const columns: Record<string, unknown> = { min_score: scoring.rules.min, max_score: scoring.rules.max, decimals: scoring.rules.decimals };
  if (scoring.mode === "criteria") {
    columns.scoring_mode = scoring.mode;
    columns.criteria = scoring.criteria;
    if (scoring.display) columns.criteria_display = scoring.display;
  }
  return columns;
}

const SCORING_HINT =
  "Criteria scoring needs a database update. Run supabase/migrations/006_devices_criteria_signatories.sql in the Supabase SQL editor.";
/** The database hasn't run migration 008 yet: PostgREST can't find its columns. Other errors about them are real errors. */
const missingJudgeColumns = (message: string) => /first_name|last_name|is_chair/.test(message) && /schema cache|does not exist/.test(message);
const JUDGES_HINT =
  "Judges' first and last names and the chair need a database update. Run supabase/migrations/008_judge_names_and_chair.sql in the Supabase SQL editor.";
/** A judge's first and last name from a form, and the full name built from them. */
function readJudgeName(formData: FormData, prefix: string, who: string): { first: string; last: string; name: string } | { error: string } {
  const part = (key: string) => String(formData.get(`${prefix}${key}`) ?? "").replace(/\s+/g, " ").trim().slice(0, MAX_NAME_PART);
  const first = part("first_name");
  const last = part("last_name");
  if (!first || !last) return { error: `Enter ${who}'s first and last name.` };
  // Names are letters (with the spaces, hyphens, apostrophes and periods names carry), never digits or symbols.
  if (!isPersonName(first)) return { error: `Use letters only for ${who}'s first name.` };
  if (!isPersonName(last)) return { error: `Use letters only for ${who}'s last name.` };
  return { first, last, name: fullName(first, last) };
}

const PANELS_HINT = "Separate boards of judges need a database update. Run supabase/migrations/013_judge_panels.sql in the Supabase SQL editor.";

/** A judge's panel from a form: both segments unless it says the preliminary or pageant proper. */
const readPanel = (value: FormDataEntryValue | null): JudgePanel => (value === "preliminary" || value === "proper" ? value : "all");

/** Columns for a judge's name. */
const nameColumns = (n: { first: string; last: string; name: string }) => ({ name: n.name, first_name: n.first, last_name: n.last });
const PHOTOS_AND_PLACES_HINT =
  "This needs a database update. Run supabase/migrations/007_entry_photos_result_decimals.sql in the Supabase SQL editor.";

/** Decimal places for averages and totals in results, 0 to 4. A missing field (older forms) keeps 2. */
function readResultDecimals(formData: FormData): ResultDecimals | { error: string } {
  const text = String(formData.get("result_decimals") ?? "2").trim();
  return /^[0-4]$/.test(text) ? (Number(text) as ResultDecimals) : { error: "Decimal places shown in results must be a whole number from 0 to 4." };
}

/**
 * The signed-in admin, when they may manage this activity: an organizer their own activities, the super
 * admin only activities no organizer owns. Every action that touches an activity goes through here.
 */
async function manage(activityId: string | null | undefined): Promise<AdminSession | null> {
  const session = await requireAdmin();
  if (!activityId || !isUuid(activityId)) return null;
  const query = db().from("activities").select("id").eq("id", activityId);
  const { data, error } = await (session.kind === "organizer" ? query.eq("owner_id", session.admin.id) : query.is("owner_id", null)).maybeSingle();
  check(error);
  return data ? session : null;
}

/** Whether this is the signed-in admin's password: the super admin's, or the organizer's own. */
async function passwordMatches(session: AdminSession, password: string): Promise<boolean> {
  if (!password) return false;
  if (session.kind === "super") return checkSuperAdminPassword(password);
  const account = await getAdminCredentials(session.admin.id);
  return !!account && (await verifyPassword(password, account.passwordHash));
}

/** The activity a judge or entry belongs to, so actions addressed by judge or entry can be authorized. */
async function parentActivity(table: "judges" | "entries", id: string): Promise<string | null> {
  if (!isUuid(id)) return null;
  const { data, error } = await db().from(table).select("activity_id").eq("id", id).maybeSingle();
  check(error);
  return (data as { activity_id: string } | null)?.activity_id ?? null;
}

const SESSION_HINT = "Judging sessions need a database update. Run supabase/migrations/005_judging_session.sql in the Supabase SQL editor.";
const JUDGES_LOCKED = err("The session has started, so the panel of judges is locked.");
const ENTRIES_ENDED = err("Judging has ended, so entries can't be changed.");

/** The activity's judging session. Databases without migration 005 behave as "not started". */
async function sessionOf(activityId: string): Promise<{ state: SessionState; currentEntryId: string | null }> {
  const { data, error } = await db().from("activities").select("session_state, current_entry_id").eq("id", activityId).maybeSingle();
  if (error) return { state: "draft", currentEntryId: null };
  const row = data as { session_state: string; current_entry_id: string | null } | null;
  const state = row?.session_state === "live" || row?.session_state === "ended" ? row.session_state : "draft";
  return { state, currentEntryId: row?.current_entry_id ?? null };
}

/** Insert judges' access codes, regenerating on the (rare) collision. */
async function assignCodes(judgeIds: string[]) {
  for (let attempt = 0; attempt < 5; attempt++) {
    const { error } = await db()
      .from("judge_access")
      .insert(judgeIds.map((judge_id) => ({ judge_id, code: newAccessCode() })));
    if (!error) return;
    if (error.code !== "23505") throw new Error(error.message);
  }
  throw new Error("Could not generate unique judge codes. Try again.");
}

/** Judge and entry photos live in the activity's folder, so deleting the activity removes them all. */
async function uploadPhoto(activityId: string, ownerId: string, file: File): Promise<string> {
  const path = `${activityId}/${ownerId}-${newFileTag()}.jpg`;
  const { error } = await db()
    .storage.from(PHOTO_BUCKET)
    .upload(path, file, { contentType: file.type || "image/jpeg", cacheControl: "31536000", upsert: false });
  check(error);
  return path;
}

async function removeFiles(paths: (string | null | undefined)[]) {
  const list = paths.filter((p): p is string => Boolean(p));
  if (list.length) await db().storage.from(PHOTO_BUCKET).remove(list);
}

async function nextPosition(table: "judges" | "entries", activityId: string): Promise<number> {
  const { data, error } = await db().from(table).select("position").eq("activity_id", activityId).order("position", { ascending: false }).limit(1);
  check(error);
  return ((data as { position: number }[])[0]?.position ?? -1) + 1;
}

// Session ---------------------------------------------------------------------

// Checked when an email has no account, so a wrong email takes as long as a wrong password.
let decoyHash: Promise<string> | undefined;

export async function login(_prev: FormResult, formData: FormData): Promise<FormResult> {
  const password = String(formData.get("password") ?? "");

  if (formData.get("as") === "super") {
    if (!checkSuperAdminPassword(password)) return err("That password isn't right.");
    await startSuperAdminSession();
    redirect("/admin");
  }

  const email = String(formData.get("email") ?? "")
    .trim()
    .toLowerCase();
  const account = email ? await getAdminCredentials(email) : null;
  decoyHash ??= hashPassword("decoy password");
  const valid = await verifyPassword(password, account?.passwordHash ?? (await decoyHash));
  if (!account || !valid) return err("That email and password don't match an organizer account.");
  await startOrganizerSession(account.admin.id, account.passwordHash);
  redirect("/admin");
}

export async function logout() {
  await endAdminSession();
  redirect("/admin/login");
}

// Pageant programs ------------------------------------------------------------------

const PAGEANT_HINT = "Pageant mode needs a database update. Run supabase/migrations/011_pageant_mode.sql in the Supabase SQL editor.";

const PARTS_HINT =
  "Sub-activities with parts need a database update. Run supabase/migrations/012_pageant_parts_and_drafts.sql in the Supabase SQL editor.";

const DEDUCTIONS_HINT = "Deductions need a database update. Run supabase/migrations/015_deductions_and_themes.sql in the Supabase SQL editor.";

/**
 * Write a pageant's sub-activities and their parts. `ids` maps the form's keys to saved ids; new ones get fresh
 * ids, so cut bases (which name sub-activities by key) and parts (which name their sub-activity) can be written in
 * the same go. Upserts, so a saved program is updated in place.
 */
async function insertProgram(activityId: string, rounds: CheckedRound[], ids: Map<string, string>) {
  for (const r of rounds) {
    if (!ids.has(r.key)) ids.set(r.key, randomUUID());
    for (const p of r.parts) if (!ids.has(p.key)) ids.set(p.key, randomUUID());
  }
  type Scored = Pick<CheckedRound, "scoring" | "timerSeconds">;
  const scoring = (r: Scored) => ({
    scoring_mode: r.scoring.mode,
    min_score: r.scoring.rules.min,
    max_score: r.scoring.rules.max,
    decimals: r.scoring.rules.decimals,
    criteria: r.scoring.criteria,
    criteria_display: r.scoring.display ?? "percent",
    timer_seconds: r.timerSeconds,
  });
  // parent_id is only sent when there are parts, so pageants without parts save on databases without migration 012.
  const withParts = rounds.some((r) => r.parts.length > 0);
  const rows = rounds.flatMap((r) => [
    {
      id: ids.get(r.key)!,
      activity_id: activityId,
      segment: r.segment,
      name: r.name,
      position: r.position,
      weight: r.weight,
      ...scoring(r),
      cut_size: r.cutSize,
      cut_basis: r.cutBasis.map((k) => (k === PRELIMINARY ? k : ids.get(k))).filter(Boolean),
      ...(withParts ? { parent_id: null } : {}),
    },
    ...r.parts.map((p) => ({
      id: ids.get(p.key)!,
      activity_id: activityId,
      segment: r.segment,
      name: p.name,
      position: p.position,
      weight: p.weight,
      ...scoring(p),
      cut_size: null,
      cut_basis: [],
      parent_id: ids.get(r.key)!,
    })),
  ]);
  check((await db().from("rounds").upsert(rows)).error);
}

/** The pageant an action addresses, as a board, when the signed-in admin manages it. */
async function managedPageant(activityId: string): Promise<{ session: AdminSession; board: Board } | null> {
  const session = await manage(activityId);
  if (!session) return null;
  // With its deductions: cuts that count the preliminary rank by its score after them.
  const board = await getAdminBoard(activityId);
  return board && board.activity.kind === "pageant" ? { session, board } : null;
}

const PAGEANT_NOT_FOUND = err("Pageant not found.");

/**
 * Save a pageant's program from the Segments tab: segment shares, sub-activities, their scoring, timers and cuts.
 * Only before the session starts, so the rules can't change once anyone has scored.
 */
export async function savePageant(activityId: string, json: string): Promise<ActionResult> {
  const found = await managedPageant(activityId);
  if (!found) return PAGEANT_NOT_FOUND;
  const { board } = found;
  if (board.activity.sessionState !== "draft") return err("The session has started, so the program is final and can't be changed.");
  const draft = parsePageantDraft(json);
  if (!draft) return err("The program couldn't be read. Try again.");
  const checked = checkPageant(draft, board.entries.length, newCriterionId);
  if (!checked.ok) return err(checked.error);
  const given = board.deductions?.length ?? 0;
  if (checked.violations === null && given > 0) {
    return err(`Take back the ${given === 1 ? "deduction" : `${given} deductions`} already given on the Session tab before turning deductions off.`);
  }

  // Saved sub-activities and parts come back keyed by their ids, so they're updated in place; insertProgram names the new ones.
  const saved = new Set(board.rounds.map((r) => r.id));
  const keys = draft.rounds.flatMap((r) => [r.key, ...(r.parts ?? []).map((p) => p.key)]);
  const ids = new Map(keys.filter((k) => saved.has(k)).map((k) => [k, k]));
  try {
    await insertProgram(activityId, checked.rounds, ids);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    if (/parent_id/.test(message)) return needsMigration(PARTS_HINT);
    return dbErr({ message });
  }
  const kept = new Set(ids.values());
  const removed = board.rounds.filter((r) => !kept.has(r.id)).map((r) => r.id);
  if (removed.length) {
    const { error } = await db().from("rounds").delete().in("id", removed);
    if (error) return dbErr(error);
  }
  // Violations are only written when deductions are (or were) on, so other programs save on databases without migration 015.
  const deductions = checked.violations !== null || board.activity.violations !== null;
  const { error } = await db()
    .from("activities")
    .update({ preliminary_weight: checked.preliminaryWeight, ...(deductions ? { violations: checked.violations } : {}) })
    .eq("id", activityId);
  if (error) return /violations/.test(error.message) ? needsMigration(DEDUCTIONS_HINT) : dbErr(error);
  changed();
  return ok("Program saved.");
}

/**
 * Judge another sub-activity (or none, to have judges wait). Judges' screens wait for the first candidate.
 * Refused while an earlier cut is waiting to be confirmed, because it decides who is judged.
 */
export async function setCurrentRound(activityId: string, roundId: string | null): Promise<ActionResult> {
  const found = await managedPageant(activityId);
  if (!found) return PAGEANT_NOT_FOUND;
  const { board } = found;
  if (board.activity.sessionState !== "live") return err("Start the session first.");
  if (roundId !== null) {
    const round = board.rounds.find((r) => r.id === roundId);
    if (!round) return err("Sub-activity not found.");
    // A sub-activity with parts is judged part by part.
    if (partsOf(board.rounds, round.id).length) return err(`Choose which part of ${round.name} to judge.`);
    const { blockedBy } = roundPool(board, round.id);
    if (blockedBy) return err(`Confirm the ${blockedBy.name} cut first. It decides who is judged in ${round.name}.`);
    // Pageant proper starts once the preliminary is fully judged.
    if (waitsForPreliminary(board, round)) {
      const open = judgingOrder(board.rounds).find((r) => r.segment === "preliminary" && !roundProgress(board, r).complete);
      return err(`Finish judging the preliminary first.${open ? ` ${roundLabel(board.rounds, open)} still has scores to come.` : ""}`);
    }
  }
  const { error } = await db()
    .from("activities")
    .update({ current_round_id: roundId, current_entry_id: null, led_entry_id: null, scoring_closes_at: null })
    .eq("id", activityId);
  if (error) return dbErr(error);
  changed();
  return ok();
}

/** Restart the timer for the candidate on screen, or give judges 15 more seconds. Reopens scoring once it has closed. */
export async function extendScoring(activityId: string, how: "restart" | "more"): Promise<ActionResult> {
  const found = await managedPageant(activityId);
  if (!found) return PAGEANT_NOT_FOUND;
  const { activity, rounds } = found.board;
  const round = rounds.find((r) => r.id === activity.currentRoundId);
  if (activity.sessionState !== "live" || !round || !activity.currentEntryId) return err("Show a candidate first.");
  if (!round.timerSeconds) return err(`${round.name} has no timer.`);
  const now = Date.now();
  const from = Math.max(now, activity.scoringClosesAt ? Date.parse(activity.scoringClosesAt) : now);
  const closesAt = how === "restart" ? now + round.timerSeconds * 1000 : from + 15_000;
  const { error } = await db().from("activities").update({ scoring_closes_at: new Date(closesAt).toISOString() }).eq("id", activityId);
  if (error) return dbErr(error);
  changed();
  return ok();
}

/**
 * Confirm a cut once every score in its basis is in. `picks` breaks the ties the plan lists, in order (see
 * cutResult). The candidates who go through are the only ones judged from the next sub-activity on, and the
 * final cut's order is the final placement.
 */
export async function confirmCut(activityId: string, roundId: string, picks: string[][]): Promise<ActionResult> {
  const found = await managedPageant(activityId);
  if (!found) return PAGEANT_NOT_FOUND;
  const { board } = found;
  if (board.activity.sessionState === "draft") return err("Start the session first.");
  const round = board.rounds.find((r) => r.id === roundId);
  if (!round || round.cutSize === null) return err("That cut isn't part of this pageant.");
  if (round.cutEntryIds !== null) return err("That cut is already confirmed.");
  const plan = cutPlan(board, round);
  const cleanPicks = Array.isArray(picks) ? picks.map((p) => (Array.isArray(p) ? p.map(String) : [])) : [];
  const result = cutResult(plan, cleanPicks);
  if (!result.ok) return err(result.error);
  const { error } = await db().from("rounds").update({ cut_entry_ids: result.entryIds }).eq("id", roundId).is("cut_entry_ids", null);
  if (error) return dbErr(error);
  changed();
  if (plan.final) return ok("Final results confirmed.");
  const next = programOrder(board.rounds)[programOrder(board.rounds).findIndex((r) => r.id === roundId) + 1];
  return ok(`Top ${result.entryIds.length} confirmed.${next ? ` ${next.name} judges these ${result.entryIds.length} candidates.` : ""}`);
}

const MAX_DEDUCTIONS = 500;

/** Why deductions can't change now, or null when they can. */
function deductionsClosed(board: Board): string | null {
  if (board.activity.violations === null) return "This pageant has no deductions. Turn them on on the Segments tab before the session starts.";
  if (deductionsOpen(board)) return null;
  return board.activity.sessionState === "ended" ? "The session has ended, so deductions are final." : "Pageant proper has started, so deductions are final.";
}

/**
 * Take points off a candidate's preliminary score for a violation: one listed at setup (`violationId`, whose reason
 * and points are used), or another with its reason and points typed at the desk. Until pageant proper starts.
 */
export async function addDeduction(activityId: string, entryId: string, violationId: string | null, reason: string, points: string): Promise<ActionResult> {
  const found = await managedPageant(activityId);
  if (!found) return PAGEANT_NOT_FOUND;
  const { board } = found;
  const closed = deductionsClosed(board);
  if (closed) return err(closed);
  const entry = board.entries.find((e) => e.id === entryId);
  if (!entry) return err("Choose the candidate.");
  if ((board.deductions?.length ?? 0) >= MAX_DEDUCTIONS) return err(`A pageant can have up to ${MAX_DEDUCTIONS} deductions.`);
  let why: string;
  let off: number;
  if (violationId) {
    const violation = board.activity.violations?.find((v) => v.id === violationId);
    if (!violation) return err("That violation isn't on this pageant's list.");
    why = violation.reason;
    off = violation.points;
  } else {
    why = String(reason ?? "").replace(/\s+/g, " ").trim();
    if (!why) return err("Give the reason for the deduction.");
    if (why.length > MAX_REASON) return err(`Keep the reason to ${MAX_REASON} characters.`);
    off = deductionPoints(String(points ?? ""));
    if (Number.isNaN(off)) return err(`Give the points off the preliminary score, from 0.01 to ${MAX_DEDUCTION}.`);
  }
  const { error } = await db().from("deductions").insert({ activity_id: activityId, entry_id: entry.id, points: off, reason: why });
  if (error) return /deductions/.test(error.message) ? needsMigration(DEDUCTIONS_HINT) : dbErr(error);
  changed();
  return ok(`${formatBound(off)} ${off === 1 ? "point" : "points"} off ${entry.name}'s preliminary score: ${why}.`);
}

/** Take back a deduction, until pageant proper starts. */
export async function removeDeduction(activityId: string, deductionId: string): Promise<ActionResult> {
  const found = await managedPageant(activityId);
  if (!found) return PAGEANT_NOT_FOUND;
  const { board } = found;
  const closed = deductionsClosed(board);
  if (closed) return err(closed);
  const deduction = board.deductions?.find((d) => d.id === deductionId);
  if (!deduction) return err("That deduction was already taken back.");
  const { error } = await db().from("deductions").delete().eq("id", deduction.id).eq("activity_id", activityId);
  if (error) return dbErr(error);
  changed();
  const name = board.entries.find((e) => e.id === deduction.entryId)?.name ?? "The candidate";
  return ok(`Took back ${name}'s deduction for ${deduction.reason}.`);
}

/** Take back a confirmed cut, as long as nobody has scored the sub-activities after it yet. */
export async function undoCut(activityId: string, roundId: string): Promise<ActionResult> {
  const found = await managedPageant(activityId);
  if (!found) return PAGEANT_NOT_FOUND;
  const { board } = found;
  const order = programOrder(board.rounds);
  const index = order.findIndex((r) => r.id === roundId);
  if (index < 0 || order[index].cutEntryIds === null) return err("That cut isn't confirmed.");
  const later = new Set(order.slice(index + 1).flatMap((r) => [r.id, ...partsOf(board.rounds, r.id).map((p) => p.id)]));
  if (board.scores.some((s) => s.roundId && later.has(s.roundId))) {
    return err("Judges have already scored after this cut, so it can't be taken back.");
  }
  const { error } = await db().from("rounds").update({ cut_entry_ids: null }).eq("id", roundId);
  if (error) return dbErr(error);
  // Nobody can be judged after an unconfirmed cut, so a later sub-activity on screen goes back to waiting.
  if (board.activity.currentRoundId && later.has(board.activity.currentRoundId)) {
    await db().from("activities").update({ current_round_id: null, current_entry_id: null, scoring_closes_at: null }).eq("id", activityId);
  }
  changed();
  return ok("The cut is open again.");
}

// Activities ------------------------------------------------------------------

/**
 * Create an event, or (kind=pageant) a pageant: candidates, judges and a program of sub-activities from the
 * pageant setup, sent as JSON in `pageant`.
 */
export async function createActivity(_prev: FormResult, formData: FormData): Promise<FormResult> {
  const result = await createFromForm(formData);
  if (!("activityId" in result)) return result;
  redirect(`/admin/${result.activityId}`);
}

/** A new activity: where to find it, and its entries' ids in running order (for adding their photos next). */
type Created = { activityId: string; entryIds: string[] };
export type CreateResult = ({ ok: true } & Created) | { ok: false; error: string };

/**
 * Create a pageant without leaving the page, so the setup can then upload each candidate's photo on its own:
 * together they can be more than one request may carry. The page goes to the pageant once they're up.
 */
export async function createPageant(formData: FormData): Promise<CreateResult> {
  const result = await createFromForm(formData);
  if ("activityId" in result) return { ok: true, ...result };
  return result.ok ? { ok: false, error: "That didn't save. Try again." } : result;
}

async function createFromForm(formData: FormData): Promise<ActionResult | Created> {
  const session = await requireAdmin();
  const pageant = formData.get("kind") === "pageant";

  const name = cleanName(formData.get("name"));
  if (!name) return err(pageant ? "Give the pageant a name." : "Give the activity a name.");
  const resultDecimals = readResultDecimals(formData);
  if (typeof resultDecimals !== "number") return err(resultDecimals.error);

  const entries = entryNames(formData.get("entries"));
  if (entries.length > MAX_ENTRIES) return err(`An activity can have up to ${MAX_ENTRIES} entries.`);

  // An event's scoring, or a pageant's program; a pageant scores in its sub-activities, so its own range is a placeholder.
  let columns: Record<string, unknown>;
  let program: CheckedRound[] = [];
  if (pageant) {
    if (entries.length < 2) return err("A pageant needs at least two candidates.");
    const draft = parsePageantDraft(String(formData.get("pageant") ?? ""));
    if (!draft) return err("The pageant's program couldn't be read. Try again.");
    const checked = checkPageant(draft, entries.length, newCriterionId);
    if (!checked.ok) return err(checked.error);
    program = checked.rounds;
    columns = {
      kind: "pageant",
      preliminary_weight: checked.preliminaryWeight,
      min_score: 0,
      max_score: 100,
      decimals: 2,
      // Only written with deductions on, so pageants without them create on databases without migration 015.
      ...(checked.violations !== null ? { violations: checked.violations } : {}),
    };
  } else {
    const parsed = readScoring(formData);
    if ("error" in parsed) return err(parsed.error);
    columns = scoringColumns(parsed.scoring);
  }

  const judgeCount = Number(formData.get("judgeCount"));
  if (!Number.isInteger(judgeCount) || judgeCount < 1 || judgeCount > MAX_JUDGES) {
    return err(`An activity needs 1 to ${MAX_JUDGES} judges.`);
  }
  const judges: { name: { first: string; last: string; name: string }; photo: File | null; panel: JudgePanel }[] = [];
  for (let i = 0; i < judgeCount; i++) {
    const judgeName = readJudgeName(formData, `judge-${i}-`, `judge ${i + 1}`);
    if ("error" in judgeName) return err(judgeName.error.replace(/\bjudge (\d+)/, "Judge $1"));
    const photo = photoFile(formData.get(`judge-${i}-photo`));
    if (photo === "invalid") return err(`The photo for ${judgeName.name} must be an image under 2 MB.`);
    judges.push({ name: judgeName, photo, panel: pageant ? readPanel(formData.get(`judge-${i}-panel`)) : "all" });
  }
  // The chair of the board of judges, by position in the list; a pageant with separate boards has one per board
  // ("0,3"). Decided now: chairs can't change later.
  const chairs = new Set(
    String(formData.get("chair") ?? "")
      .split(",")
      .filter((t) => /^\d+$/.test(t) && Number(t) < judgeCount)
      .map(Number),
  );
  if (pageant) {
    const gap = panelGap(judges.map((j) => j.panel)) ?? chairGap(judges.map((j, i) => ({ panel: j.panel, isChair: chairs.has(i) })));
    if (gap) return err(gap);
  } else if (chairs.size !== 1) {
    return err("Choose the chair of the board of judges.");
  }
  // Only sent when a judge sits out a segment, so pageants with one board save on databases without migration 013.
  const panels = judges.some((j) => j.panel !== "all");

  const owner_id = session.kind === "organizer" ? session.admin.id : null;
  let activityId: string | null = null;
  for (let attempt = 0; attempt < 5 && !activityId; attempt++) {
    const { data, error } = await db()
      .from("activities")
      .insert({
        name,
        owner_id,
        public_id: newPublicId(),
        ...columns,
        // Only written when changed, so databases without migration 007 can still create activities.
        ...(resultDecimals === 2 ? {} : { result_decimals: resultDecimals }),
      })
      .select("id")
      .single();
    if (error && /kind|preliminary_weight/.test(error.message)) return needsMigration(PAGEANT_HINT);
    if (error && /violations/.test(error.message)) return needsMigration(DEDUCTIONS_HINT);
    if (error && /scoring_mode|criteria/.test(error.message)) return needsMigration(SCORING_HINT);
    if (error && /result_decimals/.test(error.message)) return needsMigration(PHOTOS_AND_PLACES_HINT);
    if (error && error.code !== "23505") return dbErr(error);
    activityId = (data as { id: string } | null)?.id ?? null;
  }
  if (!activityId) return err("Could not create the activity. Try again.");

  const uploaded: string[] = [];
  let entryIds: string[] = [];
  try {
    if (program.length) await insertProgram(activityId, program, new Map());
    const { data, error } = await db()
      .from("judges")
      // Every row has the same keys: in a bulk insert a missing key becomes null, not the column's default.
      .insert(
        judges.map((j, position) => ({ activity_id: activityId, position, ...nameColumns(j.name), is_chair: chairs.has(position), ...(panels ? { panel: j.panel } : {}) })),
      )
      .select("id, position");
    check(error);
    const rows = (data as { id: string; position: number }[]).sort((a, b) => a.position - b.position);
    await assignCodes(rows.map((r) => r.id));

    for (const row of rows) {
      const photo = judges[row.position].photo;
      if (!photo) continue;
      const path = await uploadPhoto(activityId, row.id, photo);
      uploaded.push(path);
      check((await db().from("judges").update({ photo_path: path }).eq("id", row.id)).error);
    }

    if (entries.length) {
      const { data: rows, error: entriesError } = await db()
        .from("entries")
        .insert(entries.map((n, position) => ({ activity_id: activityId, name: n, position })))
        .select("id, position");
      check(entriesError);
      entryIds = (rows as { id: string; position: number }[]).sort((a, b) => a.position - b.position).map((r) => r.id);
    }
  } catch (e) {
    await db().from("activities").delete().eq("id", activityId);
    await removeFiles(uploaded);
    const message = e instanceof Error ? e.message : "unknown error";
    if (missingJudgeColumns(message)) return needsMigration(JUDGES_HINT);
    // Before migration 013 an activity has one chair, so separate boards' two chairs break judges_one_chair_idx.
    if (/panel|one_chair/.test(message)) return needsMigration(PANELS_HINT);
    if (/parent_id/.test(message)) return needsMigration(PARTS_HINT);
    if (/rounds/.test(message)) return needsMigration(PAGEANT_HINT);
    console.error(e);
    return err(`The ${pageant ? "pageant" : "activity"} couldn't be created, and nothing was saved. Check the connection and try again.`);
  }

  // The draft it was set up from has done its job.
  const draftId = String(formData.get("draftId") ?? "");
  if (isUuid(draftId)) await ownDrafts(session, db().from("activity_drafts").delete().eq("id", draftId));
  return { activityId, entryIds };
}

/**
 * Only the name can change. Scoring (mode, range or criteria, decimal places, how totals and results show)
 * is fixed when the activity is created, so results can't be changed by changing the rules afterwards.
 */
export async function updateSettings(activityId: string, _prev: FormResult, formData: FormData): Promise<FormResult> {
  if (!(await manage(activityId))) return NOT_FOUND;
  const name = cleanName(formData.get("name"));
  if (!name) return err("Give the activity a name.");
  const { error } = await db().from("activities").update({ name }).eq("id", activityId);
  if (error) return dbErr(error);
  changed();
  return ok("Name saved.");
}

export async function setShowRank(activityId: string, show: boolean): Promise<ActionResult> {
  if (!(await manage(activityId))) return NOT_FOUND;
  const { error } = await db().from("activities").update({ show_rank: show }).eq("id", activityId);
  if (error) return dbErr(error);
  changed();
  return ok(show ? "Rankings are showing on the live results page." : "Rankings are hidden on the live results page.");
}

/**
 * Hand one of the super admin's own activities to an organizer. From then on it is private to them: the
 * super admin can no longer open it, so this goes back to the activity list.
 */
export async function setActivityOwner(activityId: string, ownerId: string): Promise<ActionResult> {
  await requireSuperAdmin();
  if (!(await manage(activityId))) return NOT_FOUND;
  if (!isUuid(ownerId)) return err("Choose an organizer from the list.");
  const { data: organizer } = await db().from("admins").select("id").eq("id", ownerId).maybeSingle();
  if (!organizer) return err("That organizer account no longer exists.");
  const { error } = await db().from("activities").update({ owner_id: ownerId }).eq("id", activityId).is("owner_id", null);
  if (error) return dbErr(error);
  redirect("/admin");
}

// Judging session ------------------------------------------------------------------

/**
 * Start (draft or ended → live) or end (live → ended) judging. Starting locks the judges and the
 * running order; judges' screens open as soon as it is live.
 */
export async function setSessionState(activityId: string, state: "live" | "ended", password = ""): Promise<ActionResult> {
  const session = await manage(activityId);
  if (!session) return NOT_FOUND;
  // Ending judging is final for the judges, so it takes the signed-in admin's password.
  if (state === "ended" && !(await passwordMatches(session, password))) return err("That password isn't right.");
  const current = await sessionOf(activityId);
  if (state === "live" && current.state === "draft") {
    const [judges, entries] = await Promise.all([
      db().from("judges").select("id", { count: "exact", head: true }).eq("activity_id", activityId),
      db().from("entries").select("id", { count: "exact", head: true }).eq("activity_id", activityId),
    ]);
    if (!judges.count) return err("Add at least one judge before starting the session.");
    if (!entries.count) return err("Add at least one entry before starting the session.");
    const board = await getBoard(activityId);
    if (board?.activity.kind === "pageant") {
      const gap = panelGap(board.judges.map((j) => j.panel));
      if (gap) return err(gap);
    }
  }
  if (state === "ended" && current.state !== "live") return err("The session isn't running.");

  const update: Record<string, string | null> = { session_state: state };
  if (state === "live" && current.state === "draft") update.session_started_at = new Date().toISOString();
  const { error } = await db().from("activities").update(update).eq("id", activityId);
  if (error) return /session_/.test(error.message) ? needsMigration(SESSION_HINT) : dbErr(error);
  changed();
  if (state === "ended") return ok("The session has ended. Judges can no longer submit scores.");
  return ok(current.state === "ended" ? "The session is open again." : "The session has started. Show the first entry when you're ready.");
}

/** Show judges the entry to score next, or null to have them wait. Only while the session is live. */
export async function setCurrentEntry(activityId: string, entryId: string | null): Promise<ActionResult> {
  if (!(await manage(activityId))) return NOT_FOUND;
  if ((await sessionOf(activityId)).state !== "live") return err("Start the session first.");
  if (entryId !== null) {
    if (!isUuid(entryId)) return err("Entry not found.");
    const { data } = await db().from("entries").select("id").eq("id", entryId).eq("activity_id", activityId).maybeSingle();
    if (!data) return err("That entry isn't part of this activity.");
  }
  // A pageant shows only candidates in the sub-activity being judged, and starts its timer.
  const activity = await getActivity(activityId);
  const board = activity?.kind === "pageant" ? await getBoard(activityId) : null;
  const show = board ? showColumns(board, entryId, Date.now()) : { columns: showEntryColumns(entryId) };
  if ("error" in show) return err(show.error);
  const { error } = await db().from("activities").update(show.columns).eq("id", activityId);
  if (error) return /current_entry_id/.test(error.message) ? needsMigration(SESSION_HINT) : dbErr(error);
  changed();
  return ok();
}

// Judge devices -----------------------------------------------------------------------

/** The judge and activity a device belongs to, if the signed-in admin manages that activity. */
async function managedDevice(deviceId: string): Promise<{ judgeId: string } | null> {
  if (!isUuid(deviceId)) return null;
  const { data } = await db().from("judge_devices").select("judge_id").eq("id", deviceId).maybeSingle();
  const judgeId = (data as { judge_id: string } | null)?.judge_id;
  if (!judgeId || !(await manage(await parentActivity("judges", judgeId)))) return null;
  return { judgeId };
}

/** Let this device score for its judge. Every other device of that judge is signed out, so only one can record scores. */
export async function approveDevice(deviceId: string): Promise<ActionResult> {
  const device = await managedDevice(deviceId);
  if (!device) return err("That device request is gone. The judge may have signed in again.");
  const now = new Date().toISOString();
  const { error } = await db()
    .from("judge_devices")
    .update({ status: "revoked", decided_at: now })
    .eq("judge_id", device.judgeId)
    .neq("id", deviceId)
    .neq("status", "revoked");
  if (error) return dbErr(error);
  const approved = await db().from("judge_devices").update({ status: "approved", decided_at: now }).eq("id", deviceId);
  if (approved.error) return dbErr(approved.error);
  await touchJudge(device.judgeId);
  changed();
  return ok("Device approved.");
}

/** Turn a request away, or sign out an approved device. The judge can ask for approval again. */
export async function revokeDevice(deviceId: string): Promise<ActionResult> {
  const device = await managedDevice(deviceId);
  if (!device) return err("That device request is gone.");
  const { error } = await db().from("judge_devices").update({ status: "revoked", decided_at: new Date().toISOString() }).eq("id", deviceId);
  if (error) return dbErr(error);
  await touchJudge(device.judgeId);
  changed();
  return ok();
}

// LED wall ----------------------------------------------------------------------

const MIGRATION_HINT = "The LED wall needs a database update. Run supabase/migrations/004_organizer_accounts.sql in the Supabase SQL editor.";

/**
 * Full screen or green screen overlay, whether scores wait until every judge has scored, whether judges stay
 * anonymous, and the wall's look: font, colour theme and corners.
 */
export async function setLedOptions(
  activityId: string,
  options: { fullscreen?: boolean; holdScores?: boolean; anonymous?: boolean; font?: LedFont; theme?: LedTheme; shape?: LedShape },
): Promise<ActionResult> {
  if (!(await manage(activityId))) return NOT_FOUND;
  const update: Record<string, boolean | string> = {};
  if (typeof options.fullscreen === "boolean") update.led_fullscreen = options.fullscreen;
  if (typeof options.holdScores === "boolean") update.led_hold_scores = options.holdScores;
  if (typeof options.anonymous === "boolean") update.led_anonymous = options.anonymous;
  // Only the choices the wall knows; anything else is ignored.
  if (options.font !== undefined && toLedFont(options.font) === options.font) update.led_font = options.font;
  if (options.theme !== undefined && toLedTheme(options.theme) === options.theme) update.led_theme = options.theme;
  if (options.shape !== undefined && toLedShape(options.shape) === options.shape) update.led_shape = options.shape;
  if (Object.keys(update).length === 0) return ok();
  const { error } = await db().from("activities").update(update).eq("id", activityId);
  if (error && /led_(font|theme|shape)/.test(error.message)) {
    return needsMigration("The LED wall's look needs a database update. Run supabase/migrations/014_led_look.sql in the Supabase SQL editor.");
  }
  if (error && /led_anonymous/.test(error.message)) {
    return needsMigration("Anonymous judges on the LED wall need a database update. Run supabase/migrations/010_led_anonymous_judges.sql in the Supabase SQL editor.");
  }
  if (error) return /led_(fullscreen|hold_scores)/.test(error.message) ? needsMigration(MIGRATION_HINT) : dbErr(error);
  changed();
  return ok();
}

// Judges ----------------------------------------------------------------------

export async function addJudge(activityId: string, _prev: FormResult, formData: FormData): Promise<FormResult> {
  if (!(await manage(activityId))) return NOT_FOUND;
  if ((await sessionOf(activityId)).state !== "draft") return JUDGES_LOCKED;
  const judgeName = readJudgeName(formData, "", "the judge");
  if ("error" in judgeName) return err(judgeName.error);

  const { count } = await db().from("judges").select("id", { count: "exact", head: true }).eq("activity_id", activityId);
  if ((count ?? 0) >= MAX_JUDGES) return err(`An activity can have up to ${MAX_JUDGES} judges.`);

  const panel = readPanel(formData.get("panel"));
  const { data, error } = await db()
    .from("judges")
    .insert({ activity_id: activityId, position: await nextPosition("judges", activityId), ...nameColumns(judgeName), ...(panel === "all" ? {} : { panel }) })
    .select("id")
    .single();
  if (error && /panel/.test(error.message)) return needsMigration(PANELS_HINT);
  if (error) return missingJudgeColumns(error.message) ? needsMigration(JUDGES_HINT) : dbErr(error);
  const judgeId = (data as { id: string }).id;
  try {
    await assignCodes([judgeId]);
  } catch (e) {
    await db().from("judges").delete().eq("id", judgeId);
    return err(e instanceof Error ? e.message : "Could not add the judge.");
  }
  changed();
  return ok(`${judgeName.name} added.`);
}

export async function renameJudge(judgeId: string, _prev: FormResult, formData: FormData): Promise<FormResult> {
  const activityId = await parentActivity("judges", judgeId);
  if (!activityId || !(await manage(activityId))) return err("Judge not found.");
  if ((await sessionOf(activityId)).state !== "draft") return JUDGES_LOCKED;
  const judgeName = readJudgeName(formData, "", "the judge");
  if ("error" in judgeName) return err(judgeName.error);
  const { error } = await db().from("judges").update(nameColumns(judgeName)).eq("id", judgeId);
  if (error) return missingJudgeColumns(error.message) ? needsMigration(JUDGES_HINT) : dbErr(error);
  changed();
  return ok("Saved.");
}

/** Pageants: which segments a judge judges. Only before the session starts, like the rest of the panel. */
export async function setJudgePanel(judgeId: string, panel: JudgePanel): Promise<ActionResult> {
  const activityId = await parentActivity("judges", judgeId);
  if (!activityId || !(await manage(activityId))) return err("Judge not found.");
  if ((await sessionOf(activityId)).state !== "draft") return JUDGES_LOCKED;
  // A chair chairs their board: like the chair, it's decided when the pageant is created.
  const { data: judge } = await db().from("judges").select("*").eq("id", judgeId).maybeSingle();
  if ((judge as { is_chair?: boolean } | null)?.is_chair) return err("A chair's board is set when the pageant is created, so it can't change.");
  const { error } = await db().from("judges").update({ panel: readPanel(panel) }).eq("id", judgeId);
  if (error) return /panel/.test(error.message) ? needsMigration(PANELS_HINT) : dbErr(error);
  changed();
  return ok(panel === "preliminary" ? "Judges the preliminary only." : panel === "proper" ? "Judges pageant proper only." : "Judges both segments.");
}

export async function setJudgePhoto(judgeId: string, formData: FormData): Promise<ActionResult> {
  const activityId = await parentActivity("judges", judgeId);
  if (!activityId || !(await manage(activityId))) return err("Judge not found.");
  if ((await sessionOf(activityId)).state !== "draft") return JUDGES_LOCKED;
  const { data: judge } = await db().from("judges").select("photo_path").eq("id", judgeId).maybeSingle();

  const photo = photoFile(formData.get("photo"));
  if (photo === "invalid") return err("Photos must be images under 2 MB.");

  let path: string | null = null;
  if (photo) path = await uploadPhoto(activityId, judgeId, photo);
  const { error } = await db().from("judges").update({ photo_path: path }).eq("id", judgeId);
  if (error) {
    await removeFiles([path]);
    return dbErr(error);
  }
  await removeFiles([(judge as { photo_path: string | null } | null)?.photo_path]);
  changed();
  return ok();
}

export async function removeJudge(judgeId: string): Promise<ActionResult> {
  const activityId = await parentActivity("judges", judgeId);
  if (!activityId || !(await manage(activityId))) return err("Judge not found.");
  if ((await sessionOf(activityId)).state !== "draft") return JUDGES_LOCKED;
  // "*" so this works on databases without migration 008's is_chair.
  const { data: judge } = await db().from("judges").select("*").eq("id", judgeId).maybeSingle();
  if ((judge as { is_chair?: boolean } | null)?.is_chair) {
    return err("The chair of the board of judges is set when the activity is created, so they can't be removed.");
  }
  const { error } = await db().from("judges").delete().eq("id", judgeId);
  if (error) return dbErr(error);
  await removeFiles([(judge as { photo_path: string | null } | null)?.photo_path]);
  changed();
  return ok();
}

// Entries ---------------------------------------------------------------------

export async function addEntries(activityId: string, _prev: FormResult, formData: FormData): Promise<FormResult> {
  if (!(await manage(activityId))) return NOT_FOUND;
  if ((await sessionOf(activityId)).state === "ended") return ENTRIES_ENDED;
  const names = entryNames(formData.get("names"));
  if (names.length === 0) return err("Type at least one entry name.");

  const { count } = await db().from("entries").select("id", { count: "exact", head: true }).eq("activity_id", activityId);
  if ((count ?? 0) + names.length > MAX_ENTRIES) return err(`An activity can have up to ${MAX_ENTRIES} entries.`);

  const start = await nextPosition("entries", activityId);
  const { error } = await db()
    .from("entries")
    .insert(names.map((name, i) => ({ activity_id: activityId, name, position: start + i })));
  if (error) return dbErr(error);
  changed();
  return ok(names.length === 1 ? `${names[0]} added.` : `${names.length} entries added.`);
}

export async function renameEntry(entryId: string, _prev: FormResult, formData: FormData): Promise<FormResult> {
  const activityId = await parentActivity("entries", entryId);
  if (!activityId || !(await manage(activityId))) return err("Entry not found.");
  if ((await sessionOf(activityId)).state === "ended") return ENTRIES_ENDED;
  const name = cleanName(formData.get("name"));
  if (!name) return err("Entries need a name.");
  const { error } = await db().from("entries").update({ name }).eq("id", entryId);
  if (error) return dbErr(error);
  changed();
  return ok("Saved.");
}

/** An entry's photo for the LED wall, or null to remove it. Allowed at any time, even mid-session. */
export async function setEntryPhoto(entryId: string, formData: FormData): Promise<ActionResult> {
  const result = await storeEntryPhoto(entryId, formData);
  if (result.ok) changed();
  return result;
}

/**
 * A candidate's photo from the pageant setup, sent one at a time just after the pageant is created. Nothing to
 * refresh: the setup goes on to the pageant's page once they're all up.
 */
export async function addCandidatePhoto(entryId: string, formData: FormData): Promise<ActionResult> {
  return storeEntryPhoto(entryId, formData);
}

async function storeEntryPhoto(entryId: string, formData: FormData): Promise<ActionResult> {
  const activityId = await parentActivity("entries", entryId);
  if (!activityId || !(await manage(activityId))) return err("Entry not found.");
  if ((await sessionOf(activityId)).state === "ended") return ENTRIES_ENDED;
  const photo = photoFile(formData.get("photo"));
  if (photo === "invalid") return err("Photos must be images under 2 MB.");

  // "*" so a database without migration 007 gets the update hint below rather than a failed read.
  const { data: entry } = await db().from("entries").select("*").eq("id", entryId).maybeSingle();
  let path: string | null = null;
  if (photo) path = await uploadPhoto(activityId, entryId, photo);
  const { error } = await db().from("entries").update({ photo_path: path }).eq("id", entryId);
  if (error) {
    await removeFiles([path]);
    return /photo_path/.test(error.message) ? needsMigration(PHOTOS_AND_PLACES_HINT) : dbErr(error);
  }
  await removeFiles([(entry as { photo_path?: string | null } | null)?.photo_path]);
  return ok();
}

export async function removeEntry(entryId: string): Promise<ActionResult> {
  const activityId = await parentActivity("entries", entryId);
  if (!activityId || !(await manage(activityId))) return err("Entry not found.");
  const { state } = await sessionOf(activityId);
  if (state === "ended") return ENTRIES_ENDED;
  if (state !== "draft") {
    const { count } = await db().from("scores").select("id", { count: "exact", head: true }).eq("entry_id", entryId);
    if (count) return err("Judges have already scored this entry, so it can't be removed during the session.");
  }
  const { data: entry } = await db().from("entries").select("*").eq("id", entryId).maybeSingle();
  const { error } = await db().from("entries").delete().eq("id", entryId);
  if (error) return dbErr(error);
  await removeFiles([(entry as { photo_path?: string | null } | null)?.photo_path]);
  changed();
  return ok();
}

export async function moveEntry(entryId: string, direction: -1 | 1): Promise<ActionResult> {
  const activityId = await parentActivity("entries", entryId);
  if (!activityId || !(await manage(activityId))) return err("Entry not found.");
  if ((await sessionOf(activityId)).state !== "draft") return err("The running order is locked once the session has started.");

  const { data, error } = await db().from("entries").select("id, position").eq("activity_id", activityId).order("position").order("created_at");
  check(error);
  const order = (data as { id: string; position: number }[]).map((r) => r.id);
  const from = order.indexOf(entryId);
  const to = from + direction;
  if (from < 0 || to < 0 || to >= order.length) return ok();
  [order[from], order[to]] = [order[to], order[from]];

  // Renumber so positions stay dense even if earlier edits left gaps or duplicates.
  const current = new Map((data as { id: string; position: number }[]).map((r) => [r.id, r.position]));
  await Promise.all(
    order.map((id, position) =>
      current.get(id) === position
        ? null
        : db()
            .from("entries")
            .update({ position })
            .eq("id", id)
            .then(({ error: e }) => check(e)),
    ),
  );
  changed();
  return ok();
}

// Developer -------------------------------------------------------------------

/** Developer tool for rehearsals: refused on the live site. */
export async function resetScores(activityId: string): Promise<ActionResult> {
  if (!(await manage(activityId))) return NOT_FOUND;
  if (isProductionSite()) return err("Resetting scores isn't available on the live site.");
  const { error } = await db().from("scores").delete().eq("activity_id", activityId);
  if (error) return dbErr(error);
  // Back to a fresh start for the next rehearsal: judges unlock and wait for the session again.
  await db().from("activities").update({ session_state: "draft", current_entry_id: null, session_started_at: null }).eq("id", activityId);
  // A pageant also reopens its cuts, takes back its deductions and goes back to no sub-activity on screen.
  if ((await getActivity(activityId))?.kind === "pageant") {
    await db().from("rounds").update({ cut_entry_ids: null }).eq("activity_id", activityId);
    // Fails harmlessly on databases without migration 015, which have no deductions.
    await db().from("deductions").delete().eq("activity_id", activityId);
    await db().from("activities").update({ current_round_id: null, scoring_closes_at: null }).eq("id", activityId);
  }
  changed();
  return ok("All scores were deleted and the session is back to not started.");
}

export async function deleteActivity(activityId: string): Promise<ActionResult> {
  if (!(await manage(activityId))) return NOT_FOUND;
  // Not mid-show: the Settings tab hides the button while live, and this holds even if a stale page still shows it.
  const { data: live } = await db().from("activities").select("id").eq("id", activityId).eq("session_state", "live").maybeSingle();
  if (live) return err("The session is live. End it on the Session tab before deleting the activity.");
  return removeActivity(activityId);
}

/** Developer tool for rehearsals: delete the activity at any time, even mid-session. Refused on the live site. */
export async function deleteActivityNow(activityId: string): Promise<ActionResult> {
  if (!(await manage(activityId))) return NOT_FOUND;
  if (isProductionSite()) return err("Deleting an activity mid-session isn't available on the live site. End the session, then delete it from Settings.");
  return removeActivity(activityId);
}

/** Delete an activity with everything in it (judges, entries, scores, sub-activities) and its photos. */
async function removeActivity(activityId: string): Promise<ActionResult> {
  const { data: files } = await db().storage.from(PHOTO_BUCKET).list(activityId, { limit: 1000 });
  const { error } = await db().from("activities").delete().eq("id", activityId);
  if (error) return dbErr(error);
  await removeFiles((files ?? []).map((f) => `${activityId}/${f.name}`));
  // Its live results page goes too, rather than showing the cached board until it expires.
  changed();
  redirect("/admin");
}

// Drafts ------------------------------------------------------------------------------------

const DRAFTS_HINT = "Saving drafts needs a database update. Run supabase/migrations/012_pageant_parts_and_drafts.sql in the Supabase SQL editor.";
/** Judge photos ride along as small images, so a draft with a full panel stays well under this. */
const MAX_DRAFT_CHARS = 6_000_000;

export type DraftResult = { ok: true; id: string; savedAt: string } | { ok: false; error: string };

/** Limit a drafts query to the signed-in admin's own: an organizer's, or the super admin's (no owner). */
function ownDrafts<Q extends { eq: (column: string, value: string) => Q; is: (column: string, value: null) => Q }>(session: AdminSession, query: Q): Q {
  return session.kind === "organizer" ? query.eq("owner_id", session.admin.id) : query.is("owner_id", null);
}

/**
 * Save the create form as a draft: a new one, or over `draftId`. `data` is the form's own state as JSON; only its
 * owner can read it back. A draft that has gone (deleted elsewhere) is saved as a new one.
 */
export async function saveDraft(draftId: string | null, kind: "event" | "pageant", name: string, data: string): Promise<DraftResult> {
  const session = await requireAdmin();
  if (kind !== "event" && kind !== "pageant") return { ok: false, error: "That draft couldn't be read. Try again." };
  if (typeof data !== "string" || data.length > MAX_DRAFT_CHARS) return { ok: false, error: "That draft is too big to save. Remove some photos and try again." };
  let parsed: unknown;
  try {
    parsed = JSON.parse(data);
  } catch {
    return { ok: false, error: "That draft couldn't be read. Try again." };
  }
  const row = { kind, name: String(name ?? "").replace(/\s+/g, " ").trim().slice(0, MAX_NAME), data: parsed, updated_at: new Date().toISOString() };
  // Before migration 012 there's no drafts table: the super admin is told which file to run.
  const failed = async (e: { message: string }): Promise<DraftResult> => {
    const result = /activity_drafts/.test(e.message) ? await needsMigration(DRAFTS_HINT) : dbErr(e);
    return result.ok ? { ok: false, error: "That didn't save. Try again." } : result;
  };

  if (draftId && isUuid(draftId)) {
    const { data: updated, error } = await ownDrafts(session, db().from("activity_drafts").update(row).eq("id", draftId)).select("id");
    if (error) return failed(error);
    if ((updated as { id: string }[]).length) return { ok: true, id: draftId, savedAt: row.updated_at };
  }
  const owner_id = session.kind === "organizer" ? session.admin.id : null;
  const { data: created, error } = await db().from("activity_drafts").insert({ ...row, owner_id }).select("id").single();
  if (error) return failed(error);
  return { ok: true, id: (created as { id: string }).id, savedAt: row.updated_at };
}

/** Delete one of the signed-in admin's drafts. */
export async function deleteDraft(draftId: string): Promise<ActionResult> {
  const session = await requireAdmin();
  if (!isUuid(draftId)) return err("Draft not found.");
  const { error } = await ownDrafts(session, db().from("activity_drafts").delete().eq("id", draftId));
  if (error) return dbErr(error);
  changed();
  return ok("Draft deleted.");
}
