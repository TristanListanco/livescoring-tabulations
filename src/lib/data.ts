import "server-only";
import { unstable_cache } from "next/cache";
import { connection } from "next/server";
import { cache } from "react";
import { LIVE_BOARD_TAG, liveBoardTag } from "./live-cache";
import { isUuid, normalizeCode } from "./codes";
import { nameParts } from "./names";
import { readAll } from "./read-all";
import { withheldScores } from "./scoring";
import { toLedFont, toLedShape, toLedTheme } from "./led-style";
import { db, ORGANIZER_BUCKET, photoUrl } from "./supabase/server";
import type { Correction } from "./corrections";
import type { Activity, ActivitySignoff, AdminAccount, Board, Criterion, Decimals, Deduction, Entry, Judge, JudgeDevice, JudgeSignature, ResultDecimals, Round, Score, SessionState, Signatory, Violation } from "./types";

export type ActivityRow = {
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
  led_anonymous?: boolean;
  led_font?: string;
  led_theme?: string;
  led_shape?: string;
  owner_id?: string | null;
  session_state?: string;
  /** Migration 020. */
  session_ended_at?: string | null;
  archived_at?: string | null;
  /** Migration 021. */
  live_scoring?: boolean;
  signed_off_at?: string | null;
  current_entry_id?: string | null;
  scoring_mode?: string;
  criteria?: unknown;
  criteria_display?: string;
  result_decimals?: number;
  kind?: string;
  preliminary_weight?: number | string;
  current_round_id?: string | null;
  scoring_closes_at?: string | null;
  violations?: unknown;
  created_at: string;
};
type RoundRow = {
  id: string;
  segment: string;
  name: string;
  position: number;
  weight: number | string;
  scoring_mode: string;
  min_score: number | string;
  max_score: number | string;
  decimals: number;
  criteria: unknown;
  criteria_display: string;
  timer_seconds: number | null;
  cut_size: number | null;
  cut_basis: unknown;
  cut_entry_ids: unknown;
  parent_id?: string | null;
};
type AdminRow = { id: string; email: string; name: string; photo_path: string | null };
type JudgeRow = {
  id: string;
  name: string;
  first_name?: string | null;
  last_name?: string | null;
  photo_path: string | null;
  position: number;
  is_chair?: boolean;
  panel?: string;
};
type EntryRow = { id: string; name: string; photo_path?: string | null; position: number };
type ScoreRow = { entry_id: string; judge_id: string; value: number | string; round_id?: string | null };
type DeductionRow = { id: string; entry_id: string; points: number | string; reason: string; created_at: string };

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
    .filter((c): c is { id: unknown; name: unknown; max: unknown; min?: unknown; guide?: unknown } => typeof c === "object" && c !== null)
    .map((c) => {
      const max = Number(c.max);
      const min = Number(c.min ?? 0);
      const guide = typeof c.guide === "string" ? c.guide.trim() : "";
      // A lowest score only counts when it's below the criterion's points.
      return { id: String(c.id), name: String(c.name), max, ...(min > 0 && min < max ? { min } : {}), ...(guide ? { guide } : {}) };
    })
    .filter((c) => c.id && c.name && Number.isFinite(c.max) && c.max > 0);
}

/** A pageant's violations, stored as JSON: null when it has no deductions (or before migration 015). Malformed ones are dropped. */
function toViolations(value: unknown): Violation[] | null {
  if (!Array.isArray(value)) return null;
  return value
    .filter((v): v is { id: unknown; reason: unknown; points: unknown } => typeof v === "object" && v !== null)
    .map((v) => ({ id: String(v.id), reason: String(v.reason), points: Number(v.points) }))
    .filter((v) => v.id && v.reason && Number.isFinite(v.points) && v.points > 0);
}

/** A session state as stored; anything unknown reads as not started. */
export const toSessionState = (value: string | undefined): SessionState =>
  value === "live" || value === "deliberation" || value === "ended" ? value : "draft";

/** 2 on databases without migration 007. */
function toResultDecimals(value: number | undefined): ResultDecimals {
  const places = Number(value ?? 2);
  return (Number.isInteger(places) && places >= 0 && places <= 4 ? places : 2) as ResultDecimals;
}

export function toActivity(row: ActivityRow): Activity {
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
    ledAnonymous: row.led_anonymous ?? false,
    // Databases without migration 014 show the wall's original look.
    ledFont: toLedFont(row.led_font),
    ledTheme: toLedTheme(row.led_theme),
    ledShape: toLedShape(row.led_shape),
    ownerId: row.owner_id ?? null,
    // Pageants always score live; databases without migration 021 do too.
    liveScoring: row.kind === "pageant" ? true : (row.live_scoring ?? true),
    sessionState: toSessionState(row.session_state),
    sessionEndedAt: row.session_state === "ended" ? (row.session_ended_at ?? null) : null,
    signedOffAt: row.session_state === "ended" ? (row.signed_off_at ?? null) : null,
    archivedAt: row.archived_at ?? null,
    currentEntryId: row.current_entry_id ?? null,
    scoringMode: row.scoring_mode === "criteria" ? "criteria" : "simple",
    criteria: toCriteria(row.criteria),
    criteriaDisplay: row.criteria_display === "ten" ? "ten" : "percent",
    kind: row.kind === "pageant" ? "pageant" : "event",
    preliminaryWeight: Number(row.preliminary_weight ?? 0),
    currentRoundId: row.current_round_id ?? null,
    scoringClosesAt: row.scoring_closes_at ?? null,
    violations: toViolations(row.violations),
    createdAt: row.created_at,
  };
}

/** A JSON list of ids; anything else is dropped. */
const toIds = (value: unknown): string[] => (Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : []);

function toRound(row: RoundRow): Round {
  return {
    id: row.id,
    segment: row.segment === "proper" ? "proper" : "preliminary",
    name: row.name,
    position: row.position,
    weight: Number(row.weight),
    scoringMode: row.scoring_mode === "criteria" ? "criteria" : "simple",
    min: Number(row.min_score),
    max: Number(row.max_score),
    decimals: row.decimals as Decimals,
    criteria: toCriteria(row.criteria),
    criteriaDisplay: row.criteria_display === "ten" ? "ten" : "percent",
    timerSeconds: row.timer_seconds ?? null,
    cutSize: row.cut_size ?? null,
    cutBasis: toIds(row.cut_basis),
    cutEntryIds: Array.isArray(row.cut_entry_ids) ? toIds(row.cut_entry_ids) : null,
    // Null on databases without migration 012, where sub-activities have no parts.
    parentId: row.parent_id ?? null,
  };
}

const toJudge = (row: JudgeRow): Judge => ({
  id: row.id,
  name: row.name,
  firstName: row.first_name ?? null,
  lastName: row.last_name ?? null,
  photoUrl: photoUrl(row.photo_path),
  position: row.position,
  isChair: row.is_chair ?? false,
  // "all" on databases without migration 013.
  panel: row.panel === "preliminary" || row.panel === "proper" ? row.panel : "all",
});
const toEntry = (row: EntryRow): Entry => ({ id: row.id, name: row.name, photoUrl: photoUrl(row.photo_path ?? null), position: row.position });
const toScore = (row: ScoreRow): Score => ({ entryId: row.entry_id, judgeId: row.judge_id, value: Number(row.value), roundId: row.round_id ?? null });

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
 * Something a running activity is waiting on its organizer for, on the list of activities: judges' devices to approve,
 * the first entry to show, an entry every judge has scored (show the next), every entry scored (end the session, or
 * start the deliberation), or every judge signed (end the session).
 */
export type Attention =
  | { kind: "devices"; count: number }
  | { kind: "first" }
  | { kind: "next" }
  | { kind: "end" }
  | { kind: "deliberate" }
  | { kind: "signed" };

/**
 * What each of these activities is waiting on its organizer for (see Attention), in three small reads for the whole
 * list however many rooms are running. A read that fails leaves its signal out rather than the list.
 */
export async function listAttention(activities: ActivitySummary[]): Promise<Map<string, Attention[]>> {
  const running = activities.filter((a) => !a.archivedAt && a.sessionState !== "ended");
  // Events only past the devices: a pageant's desk moves through sub-activities, not one running order.
  const live = running.filter((a) => a.kind !== "pageant" && a.sessionState === "live");
  const deliberating = running.filter((a) => a.sessionState === "deliberation");
  const onScreen = live.flatMap((a) => (a.currentEntryId ? [a.currentEntryId] : []));
  const read = async <T>(run: () => PromiseLike<{ data: unknown; error: { message: string } | null }>): Promise<T[]> => {
    try {
      const { data, error } = await run();
      return error ? [] : ((data ?? []) as T[]);
    } catch {
      return [];
    }
  };
  const [devices, scores, signatures] = await Promise.all([
    running.length
      ? read<{ judges: { activity_id: string } }>(() =>
          db()
            .from("judge_devices")
            .select("judges!inner(activity_id)")
            .eq("status", "pending")
            .in(
              "judges.activity_id",
              running.map((a) => a.id),
            ),
        )
      : [],
    onScreen.length ? read<{ activity_id: string; entry_id: string }>(() => db().from("scores").select("activity_id, entry_id").in("entry_id", onScreen)) : [],
    deliberating.length
      ? read<{ activity_id: string }>(() =>
          db()
            .from("judge_signatures")
            .select("activity_id")
            .in(
              "activity_id",
              deliberating.map((a) => a.id),
            ),
        )
      : [],
  ]);
  const count = (ids: string[]) => ids.reduce((map, id) => map.set(id, (map.get(id) ?? 0) + 1), new Map<string, number>());
  const pending = count(devices.map((d) => d.judges.activity_id));
  const scoredOnScreen = count(scores.map((s) => s.activity_id));
  const signed = count(signatures.map((s) => s.activity_id));

  const attention = new Map<string, Attention[]>();
  for (const a of running) {
    const items: Attention[] = [];
    const devicesWaiting = pending.get(a.id) ?? 0;
    if (devicesWaiting) items.push({ kind: "devices", count: devicesWaiting });
    if (live.includes(a) && a.judgeCount > 0 && a.entryCount > 0) {
      if (a.scoreCount >= a.judgeCount * a.entryCount) items.push({ kind: a.liveScoring ? "end" : "deliberate" });
      else if (!a.currentEntryId) items.push({ kind: "first" });
      else if ((scoredOnScreen.get(a.id) ?? 0) >= a.judgeCount) items.push({ kind: "next" });
    }
    if (a.sessionState === "deliberation" && a.judgeCount > 0 && (signed.get(a.id) ?? 0) >= a.judgeCount) items.push({ kind: "signed" });
    if (items.length) attention.set(a.id, items);
  }
  return attention;
}

/** An organizer's activities by name, for their account page. Only these columns are read. */
export async function listOrganizerActivityNames(ownerId?: string): Promise<{ id: string; name: string; organizer: string; sessionState: SessionState }[]> {
  await connection();
  let query = db()
    .from("activities")
    .select("id, name, session_state, owner:admins!activities_owner_id_fkey(name)")
    .not("owner_id", "is", null)
    .order("created_at", { ascending: false });
  if (ownerId) query = query.eq("owner_id", ownerId);
  const { data, error } = await query;
  fail(error);
  type Row = { id: string; name: string; session_state: string | null; owner: { name: string } | null };
  return (data as unknown as Row[]).map((row) => ({ id: row.id, name: row.name, organizer: row.owner?.name ?? "", sessionState: toSessionState(row.session_state ?? undefined) }));
}

/** An organizer's activity on the super admin's activity list: how the show is going, never what was scored. */
export type OrganizerActivityStatus = {
  id: string;
  name: string;
  kind: Activity["kind"];
  organizer: string;
  sessionState: SessionState;
  judgeCount: number;
  entryCount: number;
  scoreCount: number;
  createdAt: string;
};

/** How many of organizers' activities the super admin's list shows at a time. */
export const ORGANIZER_ACTIVITIES_PAGE = 50;

/** A row's created_at as the database writes it, which a page of the list starts after. */
const isTimestamp = (value: string) => /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?(Z|[+-]\d{2}(:\d{2})?)$/.test(value);

/**
 * Organizers' activities for the super admin's list: its name, who runs it, whether judging has started and how many
 * scores are in. Only these columns and counts are read; judges, entries and scores stay private.
 *
 * Every live one, then the rest newest first, a page at a time: those created before `before` (the last one on the page
 * before), or the newest. `older` is where the next page starts, if there is one. A page is read along an index in this
 * order (migration 023), so the counts are read for its activities alone, however many there are.
 */
export async function listOrganizerActivities(
  before?: string,
): Promise<{ live: OrganizerActivityStatus[]; activities: OrganizerActivityStatus[]; older: string | null }> {
  await connection();
  const after = before && isTimestamp(before) ? before : undefined;
  const counts =
    "session_state, created_at, owner:admins!activities_owner_id_fkey(name), judges!judges_activity_id_fkey(count), entries!entries_activity_id_fkey(count), scores!scores_activity_id_fkey(count)";
  type Row = { id: string; name: string; kind?: string; session_state?: string; created_at: string; owner: { name: string } | null } & Record<
    "judges" | "entries" | "scores",
    { count: number }[]
  >;
  const read = async (live: boolean): Promise<OrganizerActivityStatus[]> => {
    const query = (columns: string) => {
      const list = db().from("activities").select(columns).not("owner_id", "is", null).order("created_at", { ascending: false });
      if (live) return list.eq("session_state", "live");
      return (after ? list.lt("created_at", after) : list).neq("session_state", "live").limit(ORGANIZER_ACTIVITIES_PAGE + 1);
    };
    // With the activity's kind when the database has it (migration 011), so a pageant isn't counted like an event.
    let { data, error } = await query(`id, name, kind, ${counts}`);
    if (error && /kind/.test(error.message)) ({ data, error } = await query(`id, name, ${counts}`));
    fail(error);
    return (data as unknown as Row[]).map((row) => ({
      id: row.id,
      name: row.name,
      kind: row.kind === "pageant" ? "pageant" : "event",
      organizer: row.owner?.name ?? "",
      sessionState: toSessionState(row.session_state),
      judgeCount: row.judges[0]?.count ?? 0,
      entryCount: row.entries[0]?.count ?? 0,
      scoreCount: row.scores[0]?.count ?? 0,
      createdAt: row.created_at,
    }));
  };
  // Live ones lead the first page only.
  const [live, page] = await Promise.all([after ? [] : read(true), read(false)]);
  const activities = page.slice(0, ORGANIZER_ACTIVITIES_PAGE);
  return { live, activities, older: page.length > ORGANIZER_ACTIVITIES_PAGE ? activities.at(-1)!.createdAt : null };
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

type BoardRows = {
  judges: { data: unknown; error: { message: string } | null };
  entries: { data: unknown; error: { message: string } | null };
  scores: { data: unknown; error: { message: string } | null };
  rounds: { data: unknown; error: { message: string } | null } | null;
  tieBreaks: { data: unknown; error: { message: string } | null };
};

/** A board from its rows. A pageant's sub-activities only: an event has none (and a database before 011, no table). */
function toBoard(activity: Activity, rows: BoardRows): Board {
  fail(rows.judges.error);
  fail(rows.entries.error);
  fail(rows.scores.error);
  const pageant = activity.kind === "pageant";
  if (pageant && rows.rounds) fail(rows.rounds.error);
  return {
    activity,
    judges: (rows.judges.data as JudgeRow[]).map(toJudge),
    entries: (rows.entries.data as EntryRow[]).map(toEntry),
    scores: (rows.scores.data as unknown as ScoreRow[]).map(toScore),
    rounds: pageant && rows.rounds ? (rows.rounds.data as RoundRow[]).map(toRound) : [],
    tieBreaks:
      activity.kind === "event" && !activity.liveScoring && !rows.tieBreaks.error
        ? (rows.tieBreaks.data as TieBreakRow[]).map((r) => ({ tieKey: r.tie_key, entryIds: r.entry_ids, reason: r.reason, judgeId: r.judge_id, createdAt: r.created_at }))
        : [],
  };
}

type TieBreakRow = { tie_key: string; entry_ids: string[]; reason: string; judge_id: string | null; created_at: string };

/** An activity's judges, entries, scores and sub-activities, read together. */
function boardRows(activityId: string) {
  return Promise.all([
    // "*" so judges, entries and scores load on databases without the newer columns (migrations 007, 008 and 011).
    db().from("judges").select("*").eq("activity_id", activityId).order("position").order("created_at"),
    db().from("entries").select("*").eq("activity_id", activityId).order("position").order("created_at"),
    // A big pageant has more scores than one read returns: they come a page at a time, oldest first.
    readAll((from, to) => db().from("scores").select("*", { count: "exact" }).eq("activity_id", activityId).order("created_at").order("id").range(from, to)),
    db().from("rounds").select("*").eq("activity_id", activityId).order("position").order("created_at"),
    // An event's broken ties (migration 026). Missing before it, when there's nowhere to keep them.
    db().from("tie_breaks").select("tie_key, entry_ids, reason, judge_id, created_at").eq("activity_id", activityId),
  ]).then(([judges, entries, scores, rounds, tieBreaks]) => ({ judges, entries, scores, rounds, tieBreaks }));
}

async function loadBoard(activity: Activity): Promise<Board> {
  return toBoard(activity, await boardRows(activity.id));
}

export async function getActivity(id: string): Promise<Activity | null> {
  await connection();
  if (!isUuid(id)) return null;
  const { data, error } = await db().from("activities").select(ACTIVITY_COLUMNS).eq("id", id).maybeSingle();
  fail(error);
  return data ? toActivity(data as ActivityRow) : null;
}

/**
 * An activity with its judges, entries and scores. The activity and the rest are read at once, one round trip to the
 * database rather than two: every admin page, judge's screen and refresh reads a board.
 */
export const getBoard = cache(async (id: string): Promise<Board | null> => {
  await connection();
  if (!isUuid(id)) return null;
  const [activity, rows] = await Promise.all([db().from("activities").select(ACTIVITY_COLUMNS).eq("id", id).maybeSingle(), boardRows(id)]);
  fail(activity.error);
  return activity.data ? toBoard(toActivity(activity.data as ActivityRow), rows) : null;
});

/**
 * A board for the organizer: with a pageant's deductions, which only the desk, the results PDFs and the organizer's
 * actions see. Judges' screens and the public pages use getBoard and getPublicBoard, without them.
 */
export const getAdminBoard = cache(async (id: string): Promise<Board | null> => {
  // The deductions are read alongside the board, not after it (an event has none; before migration 015, no table).
  const [board, deductions] = await Promise.all([
    getBoard(id),
    isUuid(id) ? db().from("deductions").select("id, entry_id, points, reason, created_at").eq("activity_id", id).order("created_at") : null,
  ]);
  if (!board || board.activity.violations === null || !deductions) return board;
  const { data, error } = deductions;
  fail(error);
  const toDeduction = (row: DeductionRow): Deduction => ({ id: row.id, entryId: row.entry_id, points: Number(row.points), reason: row.reason, createdAt: row.created_at });
  return { ...board, deductions: (data as DeductionRow[]).map(toDeduction) };
});

/**
 * The board with each score's points per criterion, for the judges' score sheets. Only the organizer's export reads
 * them: the boards the judges' screens and public pages use never carry them.
 */
export async function withBreakdowns(board: Board): Promise<Board> {
  const pageant = board.activity.kind === "pageant";
  const { data, error } = await readAll((from, to) =>
    db()
      .from("scores")
      .select(pageant ? "entry_id, judge_id, round_id, breakdown" : "entry_id, judge_id, breakdown", { count: "exact" })
      .eq("activity_id", board.activity.id)
      .order("created_at")
      .order("id")
      .range(from, to),
  );
  fail(error);
  const key = (entryId: string, judgeId: string, roundId: string | null | undefined) => `${entryId}|${judgeId}|${roundId ?? ""}`;
  const points = new Map<string, Record<string, number>>();
  for (const row of data as unknown as (ScoreRow & { breakdown: Record<string, number | string> | null })[]) {
    if (!row.breakdown) continue;
    points.set(key(row.entry_id, row.judge_id, row.round_id), Object.fromEntries(Object.entries(row.breakdown).map(([id, v]) => [id, Number(v)])));
  }
  return { ...board, scores: board.scores.map((s) => ({ ...s, breakdown: points.get(key(s.entryId, s.judgeId, s.roundId)) ?? null })) };
}

/** A judge's note on an entry (see judge_notes): read by that judge and the organizer. */
export type JudgeNote = { judgeId: string; entryId: string; body: string; updatedAt: string };
type NoteRow = { judge_id: string; entry_id: string; body: string; updated_at: string };

/**
 * One judge's notes, by entry id. Null when notes can't be read (before migration 018), so their screen leaves notes
 * out rather than failing.
 */
export async function getJudgeNotes(judgeId: string): Promise<Record<string, string> | null> {
  const { data, error } = await db().from("judge_notes").select("entry_id, body").eq("judge_id", judgeId);
  if (error) return null;
  return Object.fromEntries((data as Pick<NoteRow, "entry_id" | "body">[]).map((r) => [r.entry_id, r.body]));
}

/** Every judge's notes on an activity, for the organizer: null before migration 018. */
export async function getActivityNotes(activityId: string): Promise<JudgeNote[] | null> {
  // A page at a time in the order of their key, which an edit doesn't move, then oldest edit first.
  const { data, error } = await readAll((from, to) =>
    db()
      .from("judge_notes")
      .select("judge_id, entry_id, body, updated_at", { count: "exact" })
      .eq("activity_id", activityId)
      .order("judge_id")
      .order("entry_id")
      .range(from, to),
  );
  if (error) return null;
  return (data as NoteRow[])
    .sort((a, b) => a.updated_at.localeCompare(b.updated_at))
    .map((r) => ({ judgeId: r.judge_id, entryId: r.entry_id, body: r.body, updatedAt: r.updated_at }));
}

type CorrectionRow = {
  id: string;
  judge_id: string;
  entry_id: string;
  round_id: string | null;
  old_value: number | string;
  new_value: number | string;
  old_breakdown: Record<string, number | string> | null;
  new_breakdown: Record<string, number | string> | null;
  reason: string;
  status: string;
  decided_by: string | null;
  created_at: string;
  decided_at: string | null;
};
const toBreakdown = (b: Record<string, number | string> | null) => (b ? Object.fromEntries(Object.entries(b).map(([id, v]) => [id, Number(v)])) : null);

/**
 * A judge's points per criterion for every entry they've scored (events), by entry id: what they review in
 * deliberation, and where a correction there starts from.
 */
export async function getOwnBreakdowns(judgeId: string): Promise<Record<string, Record<string, number>>> {
  const { data } = await db().from("scores").select("entry_id, breakdown").eq("judge_id", judgeId).is("round_id", null);
  const rows = (data ?? []) as { entry_id: string; breakdown: Record<string, number | string> | null }[];
  return Object.fromEntries(rows.flatMap((r) => (r.breakdown ? [[r.entry_id, toBreakdown(r.breakdown)!]] : [])));
}

/** The judges' signatures on an activity (see judge_signatures). Null before migration 021. */
/**
 * The organizer's signature on a deliberated session's results, given as they ended it (migration 026). Null before
 * they've signed, or on a database without the table.
 */
export async function getActivitySignoff(activityId: string): Promise<ActivitySignoff | null> {
  await connection();
  if (!isUuid(activityId)) return null;
  const { data, error } = await db().from("activity_signoffs").select("signed_by, method, drawing, signed_at").eq("activity_id", activityId).maybeSingle();
  if (error || !data) return null;
  const row = data as { signed_by: string; method: "drawn" | "checked"; drawing: string | null; signed_at: string };
  return { signedBy: row.signed_by, method: row.method, drawing: row.drawing, signedAt: row.signed_at };
}

export async function getSignatures(activityId: string): Promise<JudgeSignature[] | null> {
  const { data, error } = await db().from("judge_signatures").select("judge_id, method, drawing, signed_at").eq("activity_id", activityId);
  if (error) return null;
  return (data as { judge_id: string; method: string; drawing: string | null; signed_at: string }[]).map((r) => ({
    judgeId: r.judge_id,
    method: r.method === "drawn" && r.drawing ? "drawn" : "checked",
    drawing: r.method === "drawn" ? r.drawing : null,
    signedAt: r.signed_at,
  }));
}

/** A judge's points per criterion for one entry (in a pageant, one sub-activity): where their correction starts from. */
export async function getOwnBreakdown(judgeId: string, entryId: string, roundId: string | null): Promise<Record<string, number> | null> {
  const query = db().from("scores").select("breakdown").eq("judge_id", judgeId).eq("entry_id", entryId);
  const { data } = await (roundId ? query.eq("round_id", roundId) : query.is("round_id", null)).maybeSingle();
  return toBreakdown((data as { breakdown: Record<string, number | string> | null } | null)?.breakdown ?? null);
}

/**
 * An activity's score corrections, oldest first, each with its votes. Null when they can't be read (before migration
 * 019), so judges aren't offered corrections.
 */
export async function getCorrections(activityId: string): Promise<Correction[] | null> {
  const [corrections, votes] = await Promise.all([
    db().from("score_corrections").select("*").eq("activity_id", activityId).order("created_at"),
    db().from("correction_votes").select("correction_id, judge_id, agree").eq("activity_id", activityId),
  ]);
  if (corrections.error || votes.error) return null;
  const votesOf = new Map<string, Correction["votes"]>();
  for (const v of votes.data as { correction_id: string; judge_id: string; agree: boolean }[]) {
    votesOf.set(v.correction_id, [...(votesOf.get(v.correction_id) ?? []), { judgeId: v.judge_id, agree: v.agree }]);
  }
  return (corrections.data as CorrectionRow[]).map((r) => ({
    id: r.id,
    judgeId: r.judge_id,
    entryId: r.entry_id,
    roundId: r.round_id,
    oldValue: Number(r.old_value),
    newValue: Number(r.new_value),
    oldBreakdown: toBreakdown(r.old_breakdown),
    newBreakdown: toBreakdown(r.new_breakdown),
    reason: r.reason,
    status: r.status === "approved" || r.status === "rejected" || r.status === "withdrawn" ? r.status : "open",
    decidedBy: r.decided_by === "judge" || r.decided_by === "judges" || r.decided_by === "organizer" ? r.decided_by : null,
    createdAt: r.created_at,
    decidedAt: r.decided_at,
    votes: votesOf.get(r.id) ?? [],
  }));
}

const isPublicId = (publicId: string) => /^[a-z0-9]{6,32}$/.test(publicId);

/**
 * Whether the audience sees an activity's scores yet: always with live scoring; without it, only once the session has
 * ended with every judge's signature.
 */
export const resultsReleased = (activity: Pick<Activity, "liveScoring" | "signedOffAt">) => activity.liveScoring || activity.signedOffAt !== null;

/**
 * Judges as the public pages show them, and no more: a first name with a last initial (the avatar's initials, and
 * telling two Marias apart) and a photo. Full names stay with the organizer, the judges and the PDFs. When the
 * organizer keeps judges anonymous, not even that: the LED wall draws a "?" for each and the live results number them,
 * so neither page carries anything to read around it.
 */
function publicJudges(judges: Judge[], anonymous: boolean): Judge[] {
  return judges.map((j) => {
    if (anonymous) return { ...j, name: "", firstName: null, lastName: null, photoUrl: null };
    const { first, last } = nameParts(j);
    const initial = last.trim().charAt(0);
    return { ...j, name: initial ? `${first} ${initial}` : first, firstName: first || null, lastName: initial || null };
  });
}

/** An activity by its public link, for the audience: the live results and the LED wall. */
async function loadPublicBoard(publicId: string): Promise<Board | null> {
  const { data, error } = await db()
    .from("activities")
    .select(`${ACTIVITY_COLUMNS}, owner:admins!activities_owner_id_fkey(name, photo_path)`)
    .eq("public_id", publicId)
    .maybeSingle();
  fail(error);
  if (!data) return null;
  const row = data as ActivityRow & { owner: { name: string; photo_path: string | null } | null };
  const board = await loadBoard(toActivity(row));
  const judges = publicJudges(board.judges, board.activity.ledAnonymous);
  // A pageant's list of violations is the organizer's business, never on screen for the audience; of the organizer,
  // only the logo heads their activity's results.
  const activity = { ...board.activity, ownerId: null, violations: null };
  const logoUrl = photoUrl(row.owner?.photo_path ?? null, ORGANIZER_BUCKET);
  const organizer = row.owner && logoUrl ? { name: row.owner.name, logoUrl } : null;
  // Scores are held back on the server, so they never reach the audience's screens before they're released: only
  // which judge has scored which entry does.
  if (resultsReleased(board.activity)) return { ...board, activity, judges, organizer };
  // A broken tie says which entries were level: that waits for the results too.
  return { ...withheldScores(board), activity, judges, organizer, tieBreaks: [] };
}

/** An activity by its public link, read fresh: for the LED wall, which is on air and follows every change at once. */
export const getPublicBoard = cache(async (publicId: string): Promise<Board | null> => {
  await connection();
  return isPublicId(publicId) ? loadPublicBoard(publicId) : null;
});

/** The activity behind a public link. A link never changes activity, so it's cached for a long while (null: none). */
const activityIdFor = (publicId: string) =>
  unstable_cache(
    async () => {
      const { data, error } = await db().from("activities").select("id").eq("public_id", publicId).maybeSingle();
      fail(error);
      return (data as { id: string } | null)?.id ?? null;
    },
    ["public-activity", publicId],
    { revalidate: 3600 },
  )();

/**
 * When the activity behind a public link last changed (activity_changes, kept up to date by triggers on everything that
 * shows), or "none" before its first change. One row, read by its key.
 */
async function liveBoardVersion(publicId: string): Promise<string> {
  const activityId = await activityIdFor(publicId);
  if (!activityId) return "none";
  const { data } = await db().from("activity_changes").select("changed_at").eq("activity_id", activityId).maybeSingle();
  return (data as { changed_at: string } | null)?.changed_at ?? "none";
}

/**
 * The public live results, cached and shared by everyone watching: a crowd of phones refreshing after a score costs
 * one database read, not one each. The cache is keyed by when the activity last changed, so a page asked for after a
 * change only ever comes from an entry made after it: never the board from before, even when the change reached the
 * database before its action cleared the cache (an action that writes several times, or a slow reply), when a phone
 * that noticed the change in between would otherwise have kept the old board until the next change. Each action also
 * clears its activity's entries (changed() in live-cache.ts), and an entry expires on its own after 15 seconds.
 */
export const getLiveBoard = cache(async (publicId: string): Promise<Board | null> => {
  await connection();
  if (!isPublicId(publicId)) return null;
  const version = await liveBoardVersion(publicId);
  return unstable_cache(() => loadPublicBoard(publicId), ["live-board", publicId, version], {
    tags: [LIVE_BOARD_TAG, liveBoardTag(publicId)],
    revalidate: 15,
  })();
});

/** A pageant's sub-activities, in the order they were saved. Empty when there are none (or before migration 011). */
export async function getRounds(activityId: string): Promise<Round[]> {
  if (!isUuid(activityId)) return [];
  const { data, error } = await db().from("rounds").select("*").eq("activity_id", activityId).order("position").order("created_at");
  if (error) return [];
  return (data as RoundRow[]).map(toRound);
}

/** judgeId → access code for an activity's judges, found through the activity so they're read alongside its board. */
export async function getActivityAccessCodes(activityId: string): Promise<Map<string, string>> {
  if (!isUuid(activityId)) return new Map();
  const { data, error } = await db().from("judge_access").select("judge_id, code, judges!inner(activity_id)").eq("judges.activity_id", activityId);
  if (error) return new Map();
  return new Map((data as unknown as { judge_id: string; code: string }[]).map((r) => [r.judge_id, r.code]));
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
  const { data, error } = await db().from("judges").select("*").eq("id", judgeId).maybeSingle();
  fail(error);
  if (!data) return null;
  const row = data as JudgeRow & { activity_id: string };
  return { judge: toJudge(row), activityId: row.activity_id };
}

/**
 * What every judge action checks first, read at once: the judge, their activity, and the device this browser signed
 * in as (null without one). Null when the judge is gone. One trip to the database rather than three in a row: with
 * many activities running at once, every judge's every tap pays for each trip.
 */
export async function getJudgeSeat(judgeId: string, deviceId: string | null): Promise<{ judge: Judge; activity: Activity; device: JudgeDevice | null } | null> {
  await connection();
  if (!isUuid(judgeId)) return null;
  const [{ data, error }, device] = await Promise.all([
    db().from("judges").select("*, activity:activities(*)").eq("id", judgeId).maybeSingle(),
    deviceId ? getDevice(deviceId) : null,
  ]);
  fail(error);
  const row = data as (JudgeRow & { activity: ActivityRow | null }) | null;
  if (!row?.activity) return null;
  return { judge: toJudge(row), activity: toActivity(row.activity), device };
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
/**
 * Every judge device of an activity, newest first, found through its judges: read alongside the board rather than
 * after it, as listDevices would need the judges first.
 */
export async function listActivityDevices(activityId: string): Promise<JudgeDevice[]> {
  if (!isUuid(activityId)) return [];
  const { data, error } = await db()
    .from("judge_devices")
    .select(`${DEVICE_COLUMNS}, judges!inner(activity_id)`)
    .eq("judges.activity_id", activityId)
    .order("created_at", { ascending: false })
    .limit(500);
  if (error) return [];
  return (data as unknown as DeviceRow[]).map(toDevice);
}

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

/**
 * The names and designations an activity prints as signature lines on its results PDFs (the Board of Tabulators and
 * whoever else signs them), set on its Settings tab. Before migration 027 they were the organizer's, for all their
 * activities: those, read through the activity. Null when there's no such activity.
 */
export async function getActivitySignatories(activityId: string): Promise<Signatory[] | null> {
  if (!isUuid(activityId)) return null;
  const { data, error } = await db().from("activities").select("signatories").eq("id", activityId).maybeSingle();
  if (!error) return data ? toSignatories((data as { signatories: unknown }).signatories) : null;
  const before = await db().from("activities").select("owner:admins!activities_owner_id_fkey(signatories)").eq("id", activityId).maybeSingle();
  if (before.error || !before.data) return null;
  const owner = (before.data as unknown as { owner: { signatories: unknown } | null }).owner;
  return owner ? toSignatories(owner.signatories) : [];
}

// Drafts ------------------------------------------------------------------------------------

/** An activity still being set up, saved from the create form. `data` is the form's own state, as JSON. */
export type ActivityDraft = { id: string; kind: "event" | "pageant"; name: string; data: unknown; updatedAt: string };

type DraftRow = { id: string; kind: string; name: string; data?: unknown; updated_at: string };
const toDraft = (row: DraftRow): ActivityDraft => ({
  id: row.id,
  kind: row.kind === "pageant" ? "pageant" : "event",
  name: row.name,
  data: row.data ?? null,
  updatedAt: row.updated_at,
});

/** An admin's drafts, newest first: an organizer's own, or with null the super admin's. Empty before migration 012. */
export async function listDrafts(ownerId: string | null): Promise<ActivityDraft[]> {
  await connection();
  const query = db().from("activity_drafts").select("id, kind, name, updated_at").order("updated_at", { ascending: false });
  const { data, error } = await (ownerId ? query.eq("owner_id", ownerId) : query.is("owner_id", null));
  if (error) return [];
  return (data as DraftRow[]).map(toDraft);
}

/** One of an admin's drafts, with its form state, or null when it isn't theirs (or is gone). */
export async function getDraft(id: string, ownerId: string | null): Promise<ActivityDraft | null> {
  await connection();
  if (!isUuid(id)) return null;
  const query = db().from("activity_drafts").select("id, kind, name, data, updated_at").eq("id", id);
  const { data, error } = await (ownerId ? query.eq("owner_id", ownerId) : query.is("owner_id", null)).maybeSingle();
  if (error || !data) return null;
  return toDraft(data as DraftRow);
}
