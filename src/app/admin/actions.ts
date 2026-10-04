"use server";

import { refresh } from "next/cache";
import { redirect } from "next/navigation";
import { isUuid, newAccessCode, newFileTag, newPublicId } from "@/lib/codes";
import { getAdminCredentials } from "@/lib/data";
import { hashPassword, verifyPassword } from "@/lib/password";
import type { ScoreRules } from "@/lib/scoring";
import {
  checkSuperAdminPassword,
  endAdminSession,
  requireAdmin,
  requireSuperAdmin,
  startOrganizerSession,
  startSuperAdminSession,
  type AdminSession,
} from "@/lib/session";
import { touchJudge } from "@/lib/devices";
import { showEntryColumns } from "@/lib/judging";
import { db, PHOTO_BUCKET } from "@/lib/supabase/server";
import { newFileTag as newCriterionId } from "@/lib/codes";
import type { ActionResult, CriteriaDisplay, Criterion, Decimals, ResultDecimals, ScoringMode, SessionState } from "@/lib/types";

export type FormResult = ActionResult | null;

const MAX_JUDGES = 20;
const MAX_ENTRIES = 300;
const MAX_NAME = 120;
const MAX_PHOTO_BYTES = 2 * 1024 * 1024;

const ok = (message?: string): ActionResult => ({ ok: true, message });
const err = (error: string): ActionResult => ({ ok: false, error });
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

function readRules(formData: FormData): { rules: ScoreRules } | { error: string } {
  const decimals = Number(formData.get("decimals"));
  if (decimals !== 0 && decimals !== 1 && decimals !== 2) return { error: "Choose how many decimal places judges can use." };

  const minText = String(formData.get("min") ?? "").trim();
  const maxText = String(formData.get("max") ?? "").trim();
  const number = /^\d{1,4}(\.\d{1,2})?$/;
  if (!number.test(minText) || !number.test(maxText)) {
    return { error: "Min and max must be numbers from 0 to 9999." };
  }
  const places = (t: string) => t.split(".")[1]?.length ?? 0;
  if (places(minText) > decimals || places(maxText) > decimals) {
    return {
      error:
        decimals === 0
          ? "Whole-number scoring needs a whole-number min and max."
          : `Min and max can have at most ${decimals} decimal place${decimals > 1 ? "s" : ""}.`,
    };
  }
  const min = Number(minText);
  const max = Number(maxText);
  if (max <= min) return { error: "Max score must be higher than min score." };
  return { rules: { min, max, decimals: decimals as Decimals } };
}

type Scoring = { mode: ScoringMode; rules: ScoreRules; criteria: Criterion[]; display: CriteriaDisplay | null };

/**
 * Simple scoring (min to max) or criteria (max points per criterion, adding up to 100; judges' totals
 * are then out of 100). Criteria keep their ids across edits so stored breakdowns still line up.
 */
function readScoring(formData: FormData): { scoring: Scoring } | { error: string } {
  const displayValue = formData.get("criteria_display");
  const display: CriteriaDisplay | null = displayValue === "ten" ? "ten" : displayValue === "percent" ? "percent" : null;
  if (formData.get("scoring_mode") !== "criteria") {
    const parsed = readRules(formData);
    return "error" in parsed ? parsed : { scoring: { mode: "simple", rules: parsed.rules, criteria: [], display } };
  }

  const decimals = Number(formData.get("decimals"));
  if (decimals !== 0 && decimals !== 1 && decimals !== 2) return { error: "Choose how many decimal places judges can use." };
  let raw: unknown;
  try {
    raw = JSON.parse(String(formData.get("criteria") ?? "[]"));
  } catch {
    return { error: "The criteria couldn't be read. Try again." };
  }
  if (!Array.isArray(raw) || raw.length === 0) return { error: "Add at least one criterion." };
  if (raw.length > 20) return { error: "An activity can have up to 20 criteria." };

  const criteria: Criterion[] = [];
  const names = new Set<string>();
  for (const item of raw as { id?: unknown; name?: unknown; max?: unknown }[]) {
    const name = String(item?.name ?? "")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 60);
    const max = Number(item?.max);
    if (!name) return { error: "Every criterion needs a name." };
    if (names.has(name.toLowerCase())) return { error: `"${name}" is listed twice. Give each criterion its own name.` };
    if (!Number.isInteger(max) || max < 1 || max > 100) return { error: `Give ${name} a max of 1 to 100 points.` };
    names.add(name.toLowerCase());
    const id = typeof item?.id === "string" && /^[a-z0-9]{1,40}$/.test(item.id) ? item.id : newCriterionId();
    criteria.push({ id, name, max });
  }
  const total = criteria.reduce((sum, c) => sum + c.max, 0);
  if (total !== 100) return { error: `The criteria add up to ${total} points. They must add up to 100.` };
  return { scoring: { mode: "criteria", rules: { min: 0, max: 100, decimals: decimals as Decimals }, criteria, display } };
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
const MOVE_ENTRIES_HINT =
  "Letting judges move entries needs a database update. Run supabase/migrations/008_judges_move_entries.sql in the Supabase SQL editor.";
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

/** The activity a judge or entry belongs to, so actions addressed by judge or entry can be authorized. */
async function parentActivity(table: "judges" | "entries", id: string): Promise<string | null> {
  if (!isUuid(id)) return null;
  const { data, error } = await db().from(table).select("activity_id").eq("id", id).maybeSingle();
  check(error);
  return (data as { activity_id: string } | null)?.activity_id ?? null;
}

const SESSION_HINT = "Judging sessions need a database update. Run supabase/migrations/005_judging_session.sql in the Supabase SQL editor.";
const JUDGES_LOCKED = err("Judges are locked once the session has started. Reset scores in the Developer tab to unlock them.");

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

// Activities ------------------------------------------------------------------

export async function createActivity(_prev: FormResult, formData: FormData): Promise<FormResult> {
  const session = await requireAdmin();

  const name = cleanName(formData.get("name"));
  if (!name) return err("Give the activity a name.");
  const parsed = readScoring(formData);
  if ("error" in parsed) return err(parsed.error);
  const resultDecimals = readResultDecimals(formData);
  if (typeof resultDecimals !== "number") return err(resultDecimals.error);

  const judgeCount = Number(formData.get("judgeCount"));
  if (!Number.isInteger(judgeCount) || judgeCount < 1 || judgeCount > MAX_JUDGES) {
    return err(`An activity needs 1 to ${MAX_JUDGES} judges.`);
  }
  const judges: { name: string; photo: File | null; movesEntries: boolean }[] = [];
  for (let i = 0; i < judgeCount; i++) {
    const judgeName = cleanName(formData.get(`judge-${i}-name`));
    if (!judgeName) return err(`Judge ${i + 1} needs a name.`);
    const photo = photoFile(formData.get(`judge-${i}-photo`));
    if (photo === "invalid") return err(`The photo for ${judgeName} must be an image under 2 MB.`);
    judges.push({ name: judgeName, photo, movesEntries: formData.get(`judge-${i}-moves`) === "on" });
  }

  const entries = entryNames(formData.get("entries"));
  if (entries.length > MAX_ENTRIES) return err(`An activity can have up to ${MAX_ENTRIES} entries.`);

  const owner_id = session.kind === "organizer" ? session.admin.id : null;
  let activityId: string | null = null;
  for (let attempt = 0; attempt < 5 && !activityId; attempt++) {
    const { data, error } = await db()
      .from("activities")
      .insert({
        name,
        owner_id,
        public_id: newPublicId(),
        ...scoringColumns(parsed.scoring),
        // Only written when changed, so databases without migration 007 can still create activities.
        ...(resultDecimals === 2 ? {} : { result_decimals: resultDecimals }),
      })
      .select("id")
      .single();
    if (error && /scoring_mode|criteria/.test(error.message)) return err(SCORING_HINT);
    if (error && /result_decimals/.test(error.message)) return err(PHOTOS_AND_PLACES_HINT);
    if (error && error.code !== "23505") return err(`Could not create the activity: ${error.message}`);
    activityId = (data as { id: string } | null)?.id ?? null;
  }
  if (!activityId) return err("Could not create the activity. Try again.");

  const uploaded: string[] = [];
  try {
    const { data, error } = await db()
      .from("judges")
      // can_move_entries only when set, so databases without migration 008 can still create activities.
      .insert(judges.map((j, position) => ({ activity_id: activityId, name: j.name, position, ...(j.movesEntries ? { can_move_entries: true } : {}) })))
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
    return err(/can_move_entries/.test(message) ? MOVE_ENTRIES_HINT : `Could not create the activity: ${message}`);
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
  if (error) return err(error.message);
  refresh();
  return ok("Name saved.");
}

export async function setShowRank(activityId: string, show: boolean): Promise<ActionResult> {
  if (!(await manage(activityId))) return NOT_FOUND;
  const { error } = await db().from("activities").update({ show_rank: show }).eq("id", activityId);
  if (error) return err(error.message);
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
  if (error) return err(error.message);
  redirect("/admin");
}

// Judging session ------------------------------------------------------------------

/**
 * Start (draft or ended → live) or end (live → ended) judging. Starting locks the judges and the
 * running order; judges' screens open as soon as it is live.
 */
export async function setSessionState(activityId: string, state: "live" | "ended"): Promise<ActionResult> {
  if (!(await manage(activityId))) return NOT_FOUND;
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
  if (error) return err(/session_/.test(error.message) ? SESSION_HINT : error.message);
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
  const { error } = await db().from("activities").update(showEntryColumns(entryId)).eq("id", activityId);
  if (error) return err(/current_entry_id/.test(error.message) ? SESSION_HINT : error.message);
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
  if (error) return err(error.message);
  const approved = await db().from("judge_devices").update({ status: "approved", decided_at: now }).eq("id", deviceId);
  if (approved.error) return err(approved.error.message);
  await touchJudge(device.judgeId);
  refresh();
  return ok("Device approved.");
}

/** Turn a request away, or sign out an approved device. The judge can ask for approval again. */
export async function revokeDevice(deviceId: string): Promise<ActionResult> {
  const device = await managedDevice(deviceId);
  if (!device) return err("That device request is gone.");
  const { error } = await db().from("judge_devices").update({ status: "revoked", decided_at: new Date().toISOString() }).eq("id", deviceId);
  if (error) return err(error.message);
  await touchJudge(device.judgeId);
  refresh();
  return ok();
}

// LED wall ----------------------------------------------------------------------

const MIGRATION_HINT = "The LED wall needs a database update. Run supabase/migrations/004_organizer_accounts.sql in the Supabase SQL editor.";

/** Put an entry on the LED wall output, or pass null to clear it. */
export async function setLedEntry(activityId: string, entryId: string | null): Promise<ActionResult> {
  if (!(await manage(activityId))) return NOT_FOUND;
  if (entryId !== null && !isUuid(entryId)) return err("Entry not found.");
  if (entryId) {
    const { data } = await db().from("entries").select("id").eq("id", entryId).eq("activity_id", activityId).maybeSingle();
    if (!data) return err("That entry isn't part of this activity.");
  }
  const { error } = await db().from("activities").update({ led_entry_id: entryId }).eq("id", activityId);
  if (error) return err(error.message);
  refresh();
  return ok();
}

/** Full screen or green screen overlay, and whether scores wait until every judge has scored. */
export async function setLedOptions(activityId: string, options: { fullscreen?: boolean; holdScores?: boolean }): Promise<ActionResult> {
  if (!(await manage(activityId))) return NOT_FOUND;
  const update: Record<string, boolean> = {};
  if (typeof options.fullscreen === "boolean") update.led_fullscreen = options.fullscreen;
  if (typeof options.holdScores === "boolean") update.led_hold_scores = options.holdScores;
  const { error } = await db().from("activities").update(update).eq("id", activityId);
  if (error) return err(/led_(fullscreen|hold_scores)/.test(error.message) ? MIGRATION_HINT : error.message);
  refresh();
  return ok();
}

// Judges ----------------------------------------------------------------------

export async function addJudge(activityId: string, _prev: FormResult, formData: FormData): Promise<FormResult> {
  if (!(await manage(activityId))) return NOT_FOUND;
  if ((await sessionOf(activityId)).state !== "draft") return JUDGES_LOCKED;
  const name = cleanName(formData.get("name"));
  if (!name) return err("Enter the judge's name.");

  const { count } = await db().from("judges").select("id", { count: "exact", head: true }).eq("activity_id", activityId);
  if ((count ?? 0) >= MAX_JUDGES) return err(`An activity can have up to ${MAX_JUDGES} judges.`);

  const { data, error } = await db()
    .from("judges")
    .insert({
      activity_id: activityId,
      name,
      position: await nextPosition("judges", activityId),
      ...(formData.get("moves") === "on" ? { can_move_entries: true } : {}),
    })
    .select("id")
    .single();
  if (error) return err(/can_move_entries/.test(error.message) ? MOVE_ENTRIES_HINT : error.message);
  const judgeId = (data as { id: string }).id;
  try {
    await assignCodes([judgeId]);
  } catch (e) {
    await db().from("judges").delete().eq("id", judgeId);
    return err(e instanceof Error ? e.message : "Could not add the judge.");
  }
  refresh();
  return ok(`${name} added.`);
}

/**
 * Board of tabulators: whether this judge can move to the previous or next entry from their own screen.
 * Allowed at any time, even mid-session, so the organizer can hand it over if a judge's device fails.
 */
export async function setJudgeMovesEntries(judgeId: string, moves: boolean): Promise<ActionResult> {
  const activityId = await parentActivity("judges", judgeId);
  if (!activityId || !(await manage(activityId))) return err("Judge not found.");
  const { data, error } = await db().from("judges").update({ can_move_entries: moves }).eq("id", judgeId).select("name").single();
  if (error) return err(/can_move_entries/.test(error.message) ? MOVE_ENTRIES_HINT : error.message);
  refresh();
  const name = (data as { name: string }).name;
  return ok(moves ? `${name} can move entries.` : `${name} can no longer move entries.`);
}

export async function renameJudge(judgeId: string, _prev: FormResult, formData: FormData): Promise<FormResult> {
  const activityId = await parentActivity("judges", judgeId);
  if (!activityId || !(await manage(activityId))) return err("Judge not found.");
  if ((await sessionOf(activityId)).state !== "draft") return JUDGES_LOCKED;
  const name = cleanName(formData.get("name"));
  if (!name) return err("Enter the judge's name.");
  const { error } = await db().from("judges").update({ name }).eq("id", judgeId);
  if (error) return err(error.message);
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
    return err(error.message);
  }
  await removeFiles([(judge as { photo_path: string | null } | null)?.photo_path]);
  refresh();
  return ok();
}

export async function removeJudge(judgeId: string): Promise<ActionResult> {
  const activityId = await parentActivity("judges", judgeId);
  if (!activityId || !(await manage(activityId))) return err("Judge not found.");
  if ((await sessionOf(activityId)).state !== "draft") return JUDGES_LOCKED;
  const { data: judge } = await db().from("judges").select("photo_path").eq("id", judgeId).maybeSingle();
  const { error } = await db().from("judges").delete().eq("id", judgeId);
  if (error) return err(error.message);
  await removeFiles([(judge as { photo_path: string | null } | null)?.photo_path]);
  refresh();
  return ok();
}

// Entries ---------------------------------------------------------------------

export async function addEntries(activityId: string, _prev: FormResult, formData: FormData): Promise<FormResult> {
  if (!(await manage(activityId))) return NOT_FOUND;
  const names = entryNames(formData.get("names"));
  if (names.length === 0) return err("Type at least one entry name.");

  const { count } = await db().from("entries").select("id", { count: "exact", head: true }).eq("activity_id", activityId);
  if ((count ?? 0) + names.length > MAX_ENTRIES) return err(`An activity can have up to ${MAX_ENTRIES} entries.`);

  const start = await nextPosition("entries", activityId);
  const { error } = await db()
    .from("entries")
    .insert(names.map((name, i) => ({ activity_id: activityId, name, position: start + i })));
  if (error) return err(error.message);
  refresh();
  return ok(names.length === 1 ? `${names[0]} added.` : `${names.length} entries added.`);
}

export async function renameEntry(entryId: string, _prev: FormResult, formData: FormData): Promise<FormResult> {
  if (!(await manage(await parentActivity("entries", entryId)))) return err("Entry not found.");
  const name = cleanName(formData.get("name"));
  if (!name) return err("Entries need a name.");
  const { error } = await db().from("entries").update({ name }).eq("id", entryId);
  if (error) return err(error.message);
  refresh();
  return ok("Saved.");
}

/** An entry's photo for the LED wall, or null to remove it. Allowed at any time, even mid-session. */
export async function setEntryPhoto(entryId: string, formData: FormData): Promise<ActionResult> {
  const activityId = await parentActivity("entries", entryId);
  if (!activityId || !(await manage(activityId))) return err("Entry not found.");
  const photo = photoFile(formData.get("photo"));
  if (photo === "invalid") return err("Photos must be images under 2 MB.");

  // "*" so a database without migration 007 gets the update hint below rather than a failed read.
  const { data: entry } = await db().from("entries").select("*").eq("id", entryId).maybeSingle();
  let path: string | null = null;
  if (photo) path = await uploadPhoto(activityId, entryId, photo);
  const { error } = await db().from("entries").update({ photo_path: path }).eq("id", entryId);
  if (error) {
    await removeFiles([path]);
    return err(/photo_path/.test(error.message) ? PHOTOS_AND_PLACES_HINT : error.message);
  }
  await removeFiles([(entry as { photo_path?: string | null } | null)?.photo_path]);
  refresh();
  return ok();
}

export async function removeEntry(entryId: string): Promise<ActionResult> {
  const activityId = await parentActivity("entries", entryId);
  if (!activityId || !(await manage(activityId))) return err("Entry not found.");
  if ((await sessionOf(activityId)).state !== "draft") {
    const { count } = await db().from("scores").select("id", { count: "exact", head: true }).eq("entry_id", entryId);
    if (count) return err("Judges have already scored this entry, so it can't be removed during the session.");
  }
  const { data: entry } = await db().from("entries").select("*").eq("id", entryId).maybeSingle();
  const { error } = await db().from("entries").delete().eq("id", entryId);
  if (error) return err(error.message);
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

export async function resetScores(activityId: string): Promise<ActionResult> {
  if (!(await manage(activityId))) return NOT_FOUND;
  const { error } = await db().from("scores").delete().eq("activity_id", activityId);
  if (error) return err(error.message);
  // Back to a fresh start for the next rehearsal: judges unlock and wait for the session again.
  await db().from("activities").update({ session_state: "draft", current_entry_id: null, session_started_at: null }).eq("id", activityId);
  refresh();
  return ok("All scores were deleted and the session is back to not started.");
}

export async function deleteActivity(activityId: string): Promise<ActionResult> {
  if (!(await manage(activityId))) return NOT_FOUND;

  const { data: files } = await db().storage.from(PHOTO_BUCKET).list(activityId, { limit: 1000 });
  const { error } = await db().from("activities").delete().eq("id", activityId);
  if (error) return err(error.message);
  await removeFiles((files ?? []).map((f) => `${activityId}/${f.name}`));
  redirect("/admin");
}
