import "server-only";
import { connection } from "next/server";
import { cache } from "react";
import { isUuid, normalizeCode } from "./codes";
import { db, ORGANIZER_BUCKET, photoUrl } from "./supabase/server";
import type { Activity, AdminAccount, Board, Criterion, Decimals, Entry, Judge, JudgeDevice, ResultDecimals, Score, Signatory } from "./types";

type ActivityRow = {
  id: string;
  name: string;
  public_id: string;
  min_score: number | string;
  max_score: number | string;
  decimals: number;
  show_rank?: boolean;
  led_entry_id?: string | null;
  led_fullscreen?: boolean;
  led_hold_scores?: boolean;
  owner_id?: string | null;
  session_state?: string;
  current_entry_id?: string | null;
  scoring_mode?: string;
  criteria?: unknown;
  criteria_display?: string;
  result_decimals?: number;
  created_at: string;
};
type AdminRow = { id: string; email: string; name: string; photo_path: string | null };
type JudgeRow = { id: string; name: string; photo_path: string | null; position: number };
type EntryRow = { id: string; name: string; photo_path?: string | null; position: number };
type ScoreRow = { entry_id: string; judge_id: string; value: number | string };

// "*" rather than a column list so the app keeps working on databases that
// haven't run the migrations in supabase/migrations/ yet.
const ACTIVITY_COLUMNS = "*";

function fail(error: { message: string } | null): asserts error is null {
  if (error) throw new Error(error.message);
}

/** Criteria are stored as JSON; anything malformed is dropped rather than trusted. */
function toCriteria(value: unknown): Criterion[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((c): c is { id: unknown; name: unknown; max: unknown } => typeof c === "object" && c !== null)
    .map((c) => ({ id: String(c.id), name: String(c.name), max: Number(c.max) }))
    .filter((c) => c.id && c.name && Number.isFinite(c.max) && c.max > 0);
}

/** 2 on databases without migration 007. */
function toResultDecimals(value: number | undefined): ResultDecimals {
  const places = Number(value ?? 2);
  return (Number.isInteger(places) && places >= 0 && places <= 4 ? places : 2) as ResultDecimals;
}

function toActivity(row: ActivityRow): Activity {
  return {
    id: row.id,
    name: row.name,
    publicId: row.public_id,
    min: Number(row.min_score),
    max: Number(row.max_score),
    decimals: row.decimals as Decimals,
    resultDecimals: toResultDecimals(row.result_decimals),
    showRank: row.show_rank ?? true,
    ledEntryId: row.led_entry_id ?? null,
    ledFullscreen: row.led_fullscreen ?? false,
    ledHoldScores: row.led_hold_scores ?? false,
    ownerId: row.owner_id ?? null,
    sessionState: row.session_state === "live" || row.session_state === "ended" ? row.session_state : "draft",
    currentEntryId: row.current_entry_id ?? null,
    scoringMode: row.scoring_mode === "criteria" ? "criteria" : "simple",
    criteria: toCriteria(row.criteria),
    criteriaDisplay: row.criteria_display === "ten" ? "ten" : "percent",
    createdAt: row.created_at,
  };
}

const toJudge = (row: JudgeRow): Judge => ({
  id: row.id,
  name: row.name,
  photoUrl: photoUrl(row.photo_path),
  position: row.position,
});
const toEntry = (row: EntryRow): Entry => ({ id: row.id, name: row.name, photoUrl: photoUrl(row.photo_path ?? null), position: row.position });
const toScore = (row: ScoreRow): Score => ({ entryId: row.entry_id, judgeId: row.judge_id, value: Number(row.value) });

const toAdmin = (row: AdminRow): AdminAccount => ({
  id: row.id,
  email: row.email,
  name: row.name,
  photoUrl: photoUrl(row.photo_path, ORGANIZER_BUCKET),
});

export type ActivitySummary = Activity & { judgeCount: number; entryCount: number; scoreCount: number; organizer: string | null };

/** An organizer's activities, or with null the super admin's own (activities no organizer owns). */
export async function listActivities(ownerId: string | null): Promise<ActivitySummary[]> {
  await connection();
  let query = db()
    .from("activities")
    .select(
      `${ACTIVITY_COLUMNS}, owner:admins!activities_owner_id_fkey(name), judges!judges_activity_id_fkey(count), entries!entries_activity_id_fkey(count), scores!scores_activity_id_fkey(count)`,
    )
    .order("created_at", { ascending: false });
  query = ownerId ? query.eq("owner_id", ownerId) : query.is("owner_id", null);
  const { data, error } = await query;
  fail(error);
  type Row = ActivityRow & Record<"judges" | "entries" | "scores", { count: number }[]> & { owner: { name: string } | null };
  return (data as unknown as Row[]).map((row) => ({
    ...toActivity(row),
    organizer: row.owner?.name ?? null,
    judgeCount: row.judges[0]?.count ?? 0,
    entryCount: row.entries[0]?.count ?? 0,
    scoreCount: row.scores[0]?.count ?? 0,
  }));
}

/**
 * Organizers' activities as the super admin sees them: the name and who runs it, nothing more. Only these
 * columns are read, so nothing else about them reaches the super admin's pages.
 */
export async function listOrganizerActivityNames(ownerId?: string): Promise<{ id: string; name: string; organizer: string }[]> {
  await connection();
  let query = db()
    .from("activities")
    .select("id, name, owner:admins!activities_owner_id_fkey(name)")
    .not("owner_id", "is", null)
    .order("created_at", { ascending: false });
  if (ownerId) query = query.eq("owner_id", ownerId);
  const { data, error } = await query;
  fail(error);
  type Row = { id: string; name: string; owner: { name: string } | null };
  return (data as unknown as Row[]).map((row) => ({ id: row.id, name: row.name, organizer: row.owner?.name ?? "" }));
}

// Organizer accounts -------------------------------------------------------------

export type AdminSummary = AdminAccount & { activityCount: number; createdAt: string };

export async function listAdmins(): Promise<AdminSummary[]> {
  await connection();
  const { data, error } = await db()
    .from("admins")
    .select("id, email, name, photo_path, created_at, activities!activities_owner_id_fkey(count)")
    .order("name");
  fail(error);
  type Row = AdminRow & { created_at: string; activities: { count: number }[] };
  return (data as unknown as Row[]).map((row) => ({ ...toAdmin(row), createdAt: row.created_at, activityCount: row.activities[0]?.count ?? 0 }));
}

export async function getAdmin(id: string): Promise<AdminAccount | null> {
  await connection();
  if (!isUuid(id)) return null;
  const { data, error } = await db().from("admins").select("id, email, name, photo_path").eq("id", id).maybeSingle();
  fail(error);
  return data ? toAdmin(data as AdminRow) : null;
}

/** For signing in and checking sessions only: includes the password hash. */
export async function getAdminCredentials(idOrEmail: string): Promise<{ admin: AdminAccount; passwordHash: string } | null> {
  const column = isUuid(idOrEmail) ? "id" : "email";
  if (column === "email" && !idOrEmail.includes("@")) return null;
  const { data, error } = await db()
    .from("admins")
    .select("id, email, name, photo_path, password_hash")
    .eq(column, column === "email" ? idOrEmail.trim().toLowerCase() : idOrEmail)
    .maybeSingle();
  fail(error);
  if (!data) return null;
  const row = data as AdminRow & { password_hash: string };
  return { admin: toAdmin(row), passwordHash: row.password_hash };
}

async function loadBoard(activity: Activity): Promise<Board> {
  const [judges, entries, scores] = await Promise.all([
    db().from("judges").select("id, name, photo_path, position").eq("activity_id", activity.id).order("position").order("created_at"),
    // "*" so entries load on databases without migration 007's photo column.
    db().from("entries").select("*").eq("activity_id", activity.id).order("position").order("created_at"),
    db().from("scores").select("entry_id, judge_id, value").eq("activity_id", activity.id),
  ]);
  fail(judges.error);
  fail(entries.error);
  fail(scores.error);
  return {
    activity,
    judges: (judges.data as JudgeRow[]).map(toJudge),
    entries: (entries.data as EntryRow[]).map(toEntry),
    scores: (scores.data as ScoreRow[]).map(toScore),
  };
}

export async function getActivity(id: string): Promise<Activity | null> {
  await connection();
  if (!isUuid(id)) return null;
  const { data, error } = await db().from("activities").select(ACTIVITY_COLUMNS).eq("id", id).maybeSingle();
  fail(error);
  return data ? toActivity(data as ActivityRow) : null;
}

export const getBoard = cache(async (id: string): Promise<Board | null> => {
  const activity = await getActivity(id);
  return activity ? loadBoard(activity) : null;
});

export const getPublicBoard = cache(async (publicId: string): Promise<Board | null> => {
  await connection();
  if (!/^[a-z0-9]{6,32}$/.test(publicId)) return null;
  const { data, error } = await db().from("activities").select(ACTIVITY_COLUMNS).eq("public_id", publicId).maybeSingle();
  fail(error);
  return data ? loadBoard(toActivity(data as ActivityRow)) : null;
});

/** judgeId → access code, for the admin's Access tab only. */
export async function getAccessCodes(judgeIds: string[]): Promise<Map<string, string>> {
  if (judgeIds.length === 0) return new Map();
  const { data, error } = await db().from("judge_access").select("judge_id, code").in("judge_id", judgeIds);
  fail(error);
  return new Map((data as { judge_id: string; code: string }[]).map((r) => [r.judge_id, r.code]));
}

export async function findJudgeIdByCode(input: string): Promise<string | null> {
  const code = normalizeCode(input);
  if (code.length !== 6) return null;
  const { data, error } = await db().from("judge_access").select("judge_id").eq("code", code).maybeSingle();
  fail(error);
  return (data as { judge_id: string } | null)?.judge_id ?? null;
}

/** The judge and the activity they belong to, or null if either was deleted. */
export async function getJudgeContext(judgeId: string): Promise<{ judge: Judge; activityId: string } | null> {
  await connection();
  if (!isUuid(judgeId)) return null;
  const { data, error } = await db().from("judges").select("id, name, photo_path, position, activity_id").eq("id", judgeId).maybeSingle();
  fail(error);
  if (!data) return null;
  const row = data as JudgeRow & { activity_id: string };
  return { judge: toJudge(row), activityId: row.activity_id };
}

// Judge devices ---------------------------------------------------------------------

type DeviceRow = { id: string; judge_id: string; pairing_code: string; label: string; status: string; created_at: string };
const DEVICE_COLUMNS = "id, judge_id, pairing_code, label, status, created_at";
const toDevice = (row: DeviceRow): JudgeDevice => ({
  id: row.id,
  judgeId: row.judge_id,
  pairingCode: row.pairing_code,
  label: row.label,
  status: row.status === "approved" || row.status === "revoked" ? row.status : "pending",
  createdAt: row.created_at,
});

export async function getDevice(deviceId: string): Promise<JudgeDevice | null> {
  if (!isUuid(deviceId)) return null;
  const { data, error } = await db().from("judge_devices").select(DEVICE_COLUMNS).eq("id", deviceId).maybeSingle();
  if (error) return null; // Before migration 006 there are no devices.
  return data ? toDevice(data as DeviceRow) : null;
}

/** These judges' devices, newest first: approved, waiting, and recently signed out (to explain an empty slot). */
export async function listDevices(judgeIds: string[]): Promise<JudgeDevice[]> {
  if (judgeIds.length === 0) return [];
  const { data, error } = await db()
    .from("judge_devices")
    .select(DEVICE_COLUMNS)
    .in("judge_id", judgeIds)
    .order("created_at", { ascending: false })
    .limit(500);
  if (error) return [];
  return (data as DeviceRow[]).map(toDevice);
}

// Report signatories --------------------------------------------------------------------

function toSignatories(value: unknown): Signatory[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((s): s is { name: unknown; designation: unknown } => typeof s === "object" && s !== null)
    .map((s) => ({ name: String(s.name ?? "").trim(), designation: String(s.designation ?? "").trim() }))
    .filter((s) => s.name);
}

/** The names and designations an organizer prints on their results PDFs. */
export async function getSignatories(adminId: string): Promise<Signatory[]> {
  if (!isUuid(adminId)) return [];
  const { data, error } = await db().from("admins").select("signatories").eq("id", adminId).maybeSingle();
  if (error || !data) return [];
  return toSignatories((data as { signatories: unknown }).signatories);
}
