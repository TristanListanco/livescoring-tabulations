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
import { db, PHOTO_BUCKET } from "@/lib/supabase/server";
import type { ActionResult, Decimals } from "@/lib/types";

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
  return String(value ?? "").replace(/\s+/g, " ").trim().slice(0, MAX_NAME);
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
      error: decimals === 0 ? "Whole-number scoring needs a whole-number min and max." : `Min and max can have at most ${decimals} decimal place${decimals > 1 ? "s" : ""}.`,
    };
  }
  const min = Number(minText);
  const max = Number(maxText);
  if (max <= min) return { error: "Max score must be higher than min score." };
  return { rules: { min, max, decimals: decimals as Decimals } };
}

/**
 * The signed-in admin, when they may manage this activity: the super admin manages every activity,
 * an organizer only their own. Every action that touches an activity goes through here.
 */
async function manage(activityId: string | null | undefined): Promise<AdminSession | null> {
  const session = await requireAdmin();
  if (!activityId || !isUuid(activityId)) return null;
  let query = db().from("activities").select("id").eq("id", activityId);
  if (session.kind === "organizer") query = query.eq("owner_id", session.admin.id);
  const { data, error } = await query.maybeSingle();
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

async function uploadPhoto(activityId: string, judgeId: string, file: File): Promise<string> {
  const path = `${activityId}/${judgeId}-${newFileTag()}.jpg`;
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

async function activityHasScores(activityId: string): Promise<boolean> {
  const { count, error } = await db().from("scores").select("id", { count: "exact", head: true }).eq("activity_id", activityId);
  check(error);
  return (count ?? 0) > 0;
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

  const email = String(formData.get("email") ?? "").trim().toLowerCase();
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
  const parsed = readRules(formData);
  if ("error" in parsed) return err(parsed.error);

  const judgeCount = Number(formData.get("judgeCount"));
  if (!Number.isInteger(judgeCount) || judgeCount < 1 || judgeCount > MAX_JUDGES) {
    return err(`An activity needs 1 to ${MAX_JUDGES} judges.`);
  }
  const judges: { name: string; photo: File | null }[] = [];
  for (let i = 0; i < judgeCount; i++) {
    const judgeName = cleanName(formData.get(`judge-${i}-name`));
    if (!judgeName) return err(`Judge ${i + 1} needs a name.`);
    const photo = photoFile(formData.get(`judge-${i}-photo`));
    if (photo === "invalid") return err(`The photo for ${judgeName} must be an image under 2 MB.`);
    judges.push({ name: judgeName, photo });
  }

  const entries = entryNames(formData.get("entries"));
  if (entries.length > MAX_ENTRIES) return err(`An activity can have up to ${MAX_ENTRIES} entries.`);

  const owner_id = session.kind === "organizer" ? session.admin.id : null;
  let activityId: string | null = null;
  for (let attempt = 0; attempt < 5 && !activityId; attempt++) {
    const { data, error } = await db()
      .from("activities")
      .insert({ name, owner_id, public_id: newPublicId(), min_score: parsed.rules.min, max_score: parsed.rules.max, decimals: parsed.rules.decimals })
      .select("id")
      .single();
    if (error && error.code !== "23505") return err(`Could not create the activity: ${error.message}`);
    activityId = (data as { id: string } | null)?.id ?? null;
  }
  if (!activityId) return err("Could not create the activity. Try again.");

  const uploaded: string[] = [];
  try {
    const { data, error } = await db()
      .from("judges")
      .insert(judges.map((j, position) => ({ activity_id: activityId, name: j.name, position })))
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
      check((await db().from("entries").insert(entries.map((n, position) => ({ activity_id: activityId, name: n, position })))).error);
    }
  } catch (e) {
    await db().from("activities").delete().eq("id", activityId);
    await removeFiles(uploaded);
    return err(`Could not create the activity: ${e instanceof Error ? e.message : "unknown error"}`);
  }

  redirect(`/admin/${activityId}`);
}

export async function updateSettings(activityId: string, _prev: FormResult, formData: FormData): Promise<FormResult> {
  if (!(await manage(activityId))) return NOT_FOUND;

  const name = cleanName(formData.get("name"));
  if (!name) return err("Give the activity a name.");
  const parsed = readRules(formData);
  if ("error" in parsed) return err(parsed.error);

  const { data: current, error } = await db().from("activities").select("min_score, max_score, decimals").eq("id", activityId).maybeSingle();
  check(error);
  if (!current) return NOT_FOUND;
  const rulesChanged =
    Number(current.min_score) !== parsed.rules.min || Number(current.max_score) !== parsed.rules.max || current.decimals !== parsed.rules.decimals;
  if (rulesChanged && (await activityHasScores(activityId))) {
    return err("Judges have already submitted scores. Reset scores in the Developer tab before changing the range or decimals.");
  }

  const update = await db()
    .from("activities")
    .update({ name, min_score: parsed.rules.min, max_score: parsed.rules.max, decimals: parsed.rules.decimals })
    .eq("id", activityId);
  check(update.error);
  refresh();
  return ok("Settings saved.");
}

export async function setShowRank(activityId: string, show: boolean): Promise<ActionResult> {
  if (!(await manage(activityId))) return NOT_FOUND;
  const { error } = await db().from("activities").update({ show_rank: show }).eq("id", activityId);
  if (error) return err(error.message);
  refresh();
  return ok(show ? "Rankings are showing on the live results page." : "Rankings are hidden on the live results page.");
}

/** Hand an activity to an organizer, or back to the super admin with null. Super admin only. */
export async function setActivityOwner(activityId: string, ownerId: string | null): Promise<ActionResult> {
  await requireSuperAdmin();
  if (!isUuid(activityId) || (ownerId !== null && !isUuid(ownerId))) return err("Choose an organizer from the list.");
  const { error } = await db().from("activities").update({ owner_id: ownerId }).eq("id", activityId);
  if (error) return err(error.message);
  refresh();
  return ok(ownerId ? "The organizer can now manage this activity." : "Only you can manage this activity now.");
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
  const name = cleanName(formData.get("name"));
  if (!name) return err("Enter the judge's name.");

  const { count } = await db().from("judges").select("id", { count: "exact", head: true }).eq("activity_id", activityId);
  if ((count ?? 0) >= MAX_JUDGES) return err(`An activity can have up to ${MAX_JUDGES} judges.`);

  const { data, error } = await db()
    .from("judges")
    .insert({ activity_id: activityId, name, position: await nextPosition("judges", activityId) })
    .select("id")
    .single();
  if (error) return err(error.message);
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

export async function renameJudge(judgeId: string, _prev: FormResult, formData: FormData): Promise<FormResult> {
  if (!(await manage(await parentActivity("judges", judgeId)))) return err("Judge not found.");
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
  if (!(await manage(await parentActivity("judges", judgeId)))) return err("Judge not found.");
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

export async function removeEntry(entryId: string): Promise<ActionResult> {
  if (!(await manage(await parentActivity("entries", entryId)))) return err("Entry not found.");
  const { error } = await db().from("entries").delete().eq("id", entryId);
  if (error) return err(error.message);
  refresh();
  return ok();
}

export async function moveEntry(entryId: string, direction: -1 | 1): Promise<ActionResult> {
  const activityId = await parentActivity("entries", entryId);
  if (!activityId || !(await manage(activityId))) return err("Entry not found.");

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
      current.get(id) === position ? null : db().from("entries").update({ position }).eq("id", id).then(({ error: e }) => check(e)),
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
  refresh();
  return ok("All scores were deleted.");
}

export async function deleteActivity(activityId: string): Promise<ActionResult> {
  if (!(await manage(activityId))) return NOT_FOUND;

  const { data: files } = await db().storage.from(PHOTO_BUCKET).list(activityId, { limit: 1000 });
  const { error } = await db().from("activities").delete().eq("id", activityId);
  if (error) return err(error.message);
  await removeFiles((files ?? []).map((f) => `${activityId}/${f.name}`));
  redirect("/admin");
}
