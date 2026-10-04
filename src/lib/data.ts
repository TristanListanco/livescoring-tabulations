import "server-only";
import { connection } from "next/server";
import { cache } from "react";
import { isUuid, normalizeCode } from "./codes";
import { db, photoUrl } from "./supabase/server";
import type { Activity, Board, Decimals, Entry, Judge, Score } from "./types";

type ActivityRow = {
  id: string;
  name: string;
  public_id: string;
  min_score: number | string;
  max_score: number | string;
  decimals: number;
  show_rank?: boolean;
  led_entry_id?: string | null;
  created_at: string;
};
type JudgeRow = { id: string; name: string; photo_path: string | null; position: number };
type EntryRow = { id: string; name: string; position: number };
type ScoreRow = { entry_id: string; judge_id: string; value: number | string };

// "*" rather than a column list so the app keeps working on databases that
// haven't run the migrations in supabase/migrations/ yet.
const ACTIVITY_COLUMNS = "*";

function fail(error: { message: string } | null): asserts error is null {
  if (error) throw new Error(error.message);
}

function toActivity(row: ActivityRow): Activity {
  return {
    id: row.id,
    name: row.name,
    publicId: row.public_id,
    min: Number(row.min_score),
    max: Number(row.max_score),
    decimals: row.decimals as Decimals,
    showRank: row.show_rank ?? true,
    ledEntryId: row.led_entry_id ?? null,
    createdAt: row.created_at,
  };
}

const toJudge = (row: JudgeRow): Judge => ({
  id: row.id,
  name: row.name,
  photoUrl: photoUrl(row.photo_path),
  position: row.position,
});
const toEntry = (row: EntryRow): Entry => ({ id: row.id, name: row.name, position: row.position });
const toScore = (row: ScoreRow): Score => ({ entryId: row.entry_id, judgeId: row.judge_id, value: Number(row.value) });

export type ActivitySummary = Activity & { judgeCount: number; entryCount: number; scoreCount: number };

export async function listActivities(): Promise<ActivitySummary[]> {
  await connection();
  const { data, error } = await db()
    .from("activities")
    .select(
      `${ACTIVITY_COLUMNS}, judges!judges_activity_id_fkey(count), entries!entries_activity_id_fkey(count), scores!scores_activity_id_fkey(count)`,
    )
    .order("created_at", { ascending: false });
  fail(error);
  type Row = ActivityRow & Record<"judges" | "entries" | "scores", { count: number }[]>;
  return (data as Row[]).map((row) => ({
    ...toActivity(row),
    judgeCount: row.judges[0]?.count ?? 0,
    entryCount: row.entries[0]?.count ?? 0,
    scoreCount: row.scores[0]?.count ?? 0,
  }));
}

async function loadBoard(activity: Activity): Promise<Board> {
  const [judges, entries, scores] = await Promise.all([
    db().from("judges").select("id, name, photo_path, position").eq("activity_id", activity.id).order("position").order("created_at"),
    db().from("entries").select("id, name, position").eq("activity_id", activity.id).order("position").order("created_at"),
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
  const { data, error } = await db()
    .from("judges")
    .select("id, name, photo_path, position, activity_id")
    .eq("id", judgeId)
    .maybeSingle();
  fail(error);
  if (!data) return null;
  const row = data as JudgeRow & { activity_id: string };
  return { judge: toJudge(row), activityId: row.activity_id };
}
