"use server";

import { refresh } from "next/cache";
import { redirect } from "next/navigation";
import { isUuid, newAccessCode, newFileTag, newPublicId } from "@/lib/codes";
import { randomUUID } from "node:crypto";
import { getActivity, getAdminCredentials, getBoard } from "@/lib/data";
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
import { cutPlan, cutResult, programOrder, roundPool } from "@/lib/pageant";
import { checkPageant, parsePageantDraft, type CheckedRound } from "@/lib/pageant-setup";
import { fullName, isPersonName, MAX_NAME_PART } from "@/lib/names";
import { db, PHOTO_BUCKET } from "@/lib/supabase/server";
import { newFileTag as newCriterionId } from "@/lib/codes";
import { PRELIMINARY, type ActionResult, type Board, type CriteriaDisplay, type LedTransition, type ResultDecimals, type SessionState } from "@/lib/types";

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

/**
 * Write a pageant's sub-activities. `ids` maps the form's keys to saved sub-activities' ids; new ones get fresh
 * ids, so cut bases (which name sub-activities by key) can be written in the same go. Upserts, so a saved program
 * is updated in place.
 */
async function insertProgram(activityId: string, rounds: CheckedRound[], ids: Map<string, string>) {
  for (const r of rounds) if (!ids.has(r.key)) ids.set(r.key, randomUUID());
  const rows = rounds.map((r) => ({
    id: ids.get(r.key)!,
    activity_id: activityId,
    segment: r.segment,
    name: r.name,
    position: r.position,
    weight: r.weight,
    scoring_mode: r.scoring.mode,
    min_score: r.scoring.rules.min,
    max_score: r.scoring.rules.max,
    decimals: r.scoring.rules.decimals,
    criteria: r.scoring.criteria,
    criteria_display: r.scoring.display ?? "percent",
    timer_seconds: r.timerSeconds,
    cut_size: r.cutSize,
    cut_basis: r.cutBasis.map((k) => (k === PRELIMINARY ? k : ids.get(k))).filter(Boolean),
  }));
  check((await db().from("rounds").upsert(rows)).error);
}

/** The pageant an action addresses, as a board, when the signed-in admin manages it. */
async function managedPageant(activityId: string): Promise<{ session: AdminSession; board: Board } | null> {
  const session = await manage(activityId);
  if (!session) return null;
  const board = await getBoard(activityId);
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
  if (board.activity.sessionState !== "draft") return err("The session has started, so the program is locked. Timers can still change.");
  const draft = parsePageantDraft(json);
  if (!draft) return err("The program couldn't be read. Try again.");
  const checked = checkPageant(draft, board.entries.length, newCriterionId);
  if (!checked.ok) return err(checked.error);

  // Saved sub-activities come back keyed by their ids, so they're updated in place; insertProgram names the new ones.
  const saved = new Set(board.rounds.map((r) => r.id));
  const ids = new Map(draft.rounds.filter((r) => saved.has(r.key)).map((r) => [r.key, r.key]));
  try {
    await insertProgram(activityId, checked.rounds, ids);
  } catch (e) {
    return dbErr(e instanceof Error ? e : { message: String(e) });
  }
  const kept = new Set(ids.values());
  const removed = board.rounds.filter((r) => !kept.has(r.id)).map((r) => r.id);
  if (removed.length) {
    const { error } = await db().from("rounds").delete().in("id", removed);
    if (error) return dbErr(error);
  }
  const { error } = await db().from("activities").update({ preliminary_weight: checked.preliminaryWeight }).eq("id", activityId);
  if (error) return dbErr(error);
  refresh();
  return ok("Program saved.");
}

/** A sub-activity's scoring timer, in seconds, or null to turn it off. It can change at any time, even mid-show. */
export async function setRoundTimer(roundId: string, seconds: number | null): Promise<ActionResult> {
  if (!isUuid(roundId)) return err("Sub-activity not found.");
  const { data } = await db().from("rounds").select("activity_id").eq("id", roundId).maybeSingle();
  const activityId = (data as { activity_id: string } | null)?.activity_id;
  if (!activityId || !(await manage(activityId))) return err("Sub-activity not found.");
  if (seconds !== null && !(Number.isInteger(seconds) && seconds >= 5 && seconds <= 3600)) return err("Set the timer from 5 to 3600 seconds, or turn it off.");
  const { error } = await db().from("rounds").update({ timer_seconds: seconds }).eq("id", roundId);
  if (error) return dbErr(error);
  refresh();
  return ok(seconds === null ? "Timer off." : `Judges get ${seconds} seconds to score each candidate.`);
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
    const { blockedBy } = roundPool(board, round.id);
    if (blockedBy) return err(`Confirm the ${blockedBy.name} cut first. It decides who is judged in ${round.name}.`);
  }
  const { error } = await db()
    .from("activities")
    .update({ current_round_id: roundId, current_entry_id: null, led_entry_id: null, scoring_closes_at: null })
    .eq("id", activityId);
  if (error) return dbErr(error);
  refresh();
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
  refresh();
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
  refresh();
  if (plan.final) return ok("Final results confirmed.");
  const next = programOrder(board.rounds)[programOrder(board.rounds).findIndex((r) => r.id === roundId) + 1];
  return ok(`Top ${result.entryIds.length} confirmed.${next ? ` ${next.name} judges these ${result.entryIds.length} candidates.` : ""}`);
}

/** Take back a confirmed cut, as long as nobody has scored the sub-activities after it yet. */
export async function undoCut(activityId: string, roundId: string): Promise<ActionResult> {
  const found = await managedPageant(activityId);
  if (!found) return PAGEANT_NOT_FOUND;
  const { board } = found;
  const order = programOrder(board.rounds);
  const index = order.findIndex((r) => r.id === roundId);
  if (index < 0 || order[index].cutEntryIds === null) return err("That cut isn't confirmed.");
  const later = new Set(order.slice(index + 1).map((r) => r.id));
  if (board.scores.some((s) => s.roundId && later.has(s.roundId))) {
    return err("Judges have already scored after this cut, so it can't be taken back.");
  }
  const { error } = await db().from("rounds").update({ cut_entry_ids: null }).eq("id", roundId);
  if (error) return dbErr(error);
  // Nobody can be judged after an unconfirmed cut, so a later sub-activity on screen goes back to waiting.
  if (board.activity.currentRoundId && later.has(board.activity.currentRoundId)) {
    await db().from("activities").update({ current_round_id: null, current_entry_id: null, scoring_closes_at: null }).eq("id", activityId);
  }
  refresh();
  return ok("The cut is open again.");
}

// Activities ------------------------------------------------------------------

/**
 * Create an event, or (kind=pageant) a pageant: candidates, judges and a program of sub-activities from the
 * pageant setup, sent as JSON in `pageant`.
 */
export async function createActivity(_prev: FormResult, formData: FormData): Promise<FormResult> {
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
    columns = { kind: "pageant", preliminary_weight: checked.preliminaryWeight, min_score: 0, max_score: 100, decimals: 2 };
  } else {
    const parsed = readScoring(formData);
    if ("error" in parsed) return err(parsed.error);
    columns = scoringColumns(parsed.scoring);
  }

  const judgeCount = Number(formData.get("judgeCount"));
  if (!Number.isInteger(judgeCount) || judgeCount < 1 || judgeCount > MAX_JUDGES) {
    return err(`An activity needs 1 to ${MAX_JUDGES} judges.`);
  }
  const judges: { name: { first: string; last: string; name: string }; photo: File | null }[] = [];
  for (let i = 0; i < judgeCount; i++) {
    const judgeName = readJudgeName(formData, `judge-${i}-`, `judge ${i + 1}`);
    if ("error" in judgeName) return err(judgeName.error.replace(/\bjudge (\d+)/, "Judge $1"));
    const photo = photoFile(formData.get(`judge-${i}-photo`));
    if (photo === "invalid") return err(`The photo for ${judgeName.name} must be an image under 2 MB.`);
    judges.push({ name: judgeName, photo });
  }
  // The chair of the board of judges, by position in the list. Decided now: it can't change later.
  const chairText = String(formData.get("chair") ?? "");
  const chair = /^\d+$/.test(chairText) && Number(chairText) < judgeCount ? Number(chairText) : null;
  if (chair === null) return err("Choose the chair of the board of judges.");

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
    if (error && /scoring_mode|criteria/.test(error.message)) return needsMigration(SCORING_HINT);
    if (error && /result_decimals/.test(error.message)) return needsMigration(PHOTOS_AND_PLACES_HINT);
    if (error && error.code !== "23505") return dbErr(error);
    activityId = (data as { id: string } | null)?.id ?? null;
  }
  if (!activityId) return err("Could not create the activity. Try again.");

  const uploaded: string[] = [];
  try {
    if (program.length) await insertProgram(activityId, program, new Map());
    const { data, error } = await db()
      .from("judges")
      // Every row has the same keys: in a bulk insert a missing key becomes null, not the column's default.
      .insert(judges.map((j, position) => ({ activity_id: activityId, position, ...nameColumns(j.name), is_chair: position === chair })))
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
      check(
        (
          await db()
            .from("entries")
            .insert(entries.map((n, position) => ({ activity_id: activityId, name: n, position })))
        ).error,
      );
    }
  } catch (e) {
    await db().from("activities").delete().eq("id", activityId);
    await removeFiles(uploaded);
    const message = e instanceof Error ? e.message : "unknown error";
    if (missingJudgeColumns(message)) return needsMigration(JUDGES_HINT);
    if (/rounds/.test(message)) return needsMigration(PAGEANT_HINT);
    console.error(e);
    return err(`The ${pageant ? "pageant" : "activity"} couldn't be created, and nothing was saved. Check the connection and try again.`);
  }

  redirect(`/admin/${activityId}`);
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
  refresh();
  return ok("Name saved.");
}

export async function setShowRank(activityId: string, show: boolean): Promise<ActionResult> {
  if (!(await manage(activityId))) return NOT_FOUND;
  const { error } = await db().from("activities").update({ show_rank: show }).eq("id", activityId);
  if (error) return dbErr(error);
  refresh();
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
  }
  if (state === "ended" && current.state !== "live") return err("The session isn't running.");

  const update: Record<string, string | null> = { session_state: state };
  if (state === "live" && current.state === "draft") update.session_started_at = new Date().toISOString();
  const { error } = await db().from("activities").update(update).eq("id", activityId);
  if (error) return /session_/.test(error.message) ? needsMigration(SESSION_HINT) : dbErr(error);
  refresh();
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
  refresh();
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
  refresh();
  return ok("Device approved.");
}

/** Turn a request away, or sign out an approved device. The judge can ask for approval again. */
export async function revokeDevice(deviceId: string): Promise<ActionResult> {
  const device = await managedDevice(deviceId);
  if (!device) return err("That device request is gone.");
  const { error } = await db().from("judge_devices").update({ status: "revoked", decided_at: new Date().toISOString() }).eq("id", deviceId);
  if (error) return dbErr(error);
  await touchJudge(device.judgeId);
  refresh();
  return ok();
}

// LED wall ----------------------------------------------------------------------

const MIGRATION_HINT = "The LED wall needs a database update. Run supabase/migrations/004_organizer_accounts.sql in the Supabase SQL editor.";

/** Full screen or green screen overlay, and whether scores wait until every judge has scored. */
export async function setLedOptions(
  activityId: string,
  options: { fullscreen?: boolean; holdScores?: boolean; transition?: LedTransition; anonymous?: boolean },
): Promise<ActionResult> {
  if (!(await manage(activityId))) return NOT_FOUND;
  const update: Record<string, boolean | string> = {};
  if (typeof options.fullscreen === "boolean") update.led_fullscreen = options.fullscreen;
  if (typeof options.holdScores === "boolean") update.led_hold_scores = options.holdScores;
  if (options.transition === "fade" || options.transition === "wipe") update.led_transition = options.transition;
  if (typeof options.anonymous === "boolean") update.led_anonymous = options.anonymous;
  const { error } = await db().from("activities").update(update).eq("id", activityId);
  if (error && /led_anonymous/.test(error.message)) {
    return needsMigration("Anonymous judges on the LED wall need a database update. Run supabase/migrations/010_led_anonymous_judges.sql in the Supabase SQL editor.");
  }
  if (error && /led_transition/.test(error.message)) {
    return needsMigration("LED wall animations need a database update. Run supabase/migrations/009_led_transition.sql in the Supabase SQL editor.");
  }
  if (error) return /led_(fullscreen|hold_scores)/.test(error.message) ? needsMigration(MIGRATION_HINT) : dbErr(error);
  refresh();
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

  const { data, error } = await db()
    .from("judges")
    .insert({ activity_id: activityId, position: await nextPosition("judges", activityId), ...nameColumns(judgeName) })
    .select("id")
    .single();
  if (error) return missingJudgeColumns(error.message) ? needsMigration(JUDGES_HINT) : dbErr(error);
  const judgeId = (data as { id: string }).id;
  try {
    await assignCodes([judgeId]);
  } catch (e) {
    await db().from("judges").delete().eq("id", judgeId);
    return err(e instanceof Error ? e.message : "Could not add the judge.");
  }
  refresh();
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
  refresh();
  return ok("Saved.");
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
  refresh();
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
  refresh();
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
  refresh();
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
  refresh();
  return ok("Saved.");
}

/** An entry's photo for the LED wall, or null to remove it. Allowed at any time, even mid-session. */
export async function setEntryPhoto(entryId: string, formData: FormData): Promise<ActionResult> {
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
  refresh();
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
  refresh();
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
  refresh();
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
  // A pageant also reopens its cuts and goes back to no sub-activity on screen.
  if ((await getActivity(activityId))?.kind === "pageant") {
    await db().from("rounds").update({ cut_entry_ids: null }).eq("activity_id", activityId);
    await db().from("activities").update({ current_round_id: null, scoring_closes_at: null }).eq("id", activityId);
  }
  refresh();
  return ok("All scores were deleted and the session is back to not started.");
}

export async function deleteActivity(activityId: string): Promise<ActionResult> {
  if (!(await manage(activityId))) return NOT_FOUND;
  // Not mid-show: the Settings tab hides the button while live, and this holds even if a stale page still shows it.
  const { data: live } = await db().from("activities").select("id").eq("id", activityId).eq("session_state", "live").maybeSingle();
  if (live) return err("The session is live. End it on the Session tab before deleting the activity.");

  const { data: files } = await db().storage.from(PHOTO_BUCKET).list(activityId, { limit: 1000 });
  const { error } = await db().from("activities").delete().eq("id", activityId);
  if (error) return dbErr(error);
  await removeFiles((files ?? []).map((f) => `${activityId}/${f.name}`));
  redirect("/admin");
}
