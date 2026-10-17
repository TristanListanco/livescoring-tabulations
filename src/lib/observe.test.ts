import { afterEach, describe, expect, it, vi } from "vitest";
import { SLOW_DB_MS, timedFetch, traced } from "./observe";

/** Every JSON line logged while `run` runs. */
async function linesOf(run: () => Promise<unknown>): Promise<Record<string, unknown>[]> {
  const lines: string[] = [];
  for (const level of ["log", "warn", "error"] as const) vi.spyOn(console, level).mockImplementation((line: string) => void lines.push(line));
  await run().catch(() => {});
  return lines.map((line) => JSON.parse(line));
}

/** The database answering after `ms`, with this status and body. */
function database(ms: number, status = 200, body: unknown = []) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => {
      await new Promise((resolve) => setTimeout(resolve, ms));
      return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
    }),
  );
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("traced", () => {
  it("logs an action's time, and the part of it spent on the database", async () => {
    database(20);
    const save = traced("submitScore", async () => {
      await timedFetch("https://db.example/rest/v1/scores?judge_id=eq.1");
      await timedFetch("https://db.example/rest/v1/activities?id=eq.2");
      return { ok: true };
    });
    const [line] = await linesOf(save);
    expect(line).toMatchObject({ level: "info", event: "action", action: "submitScore", outcome: "ok", dbCalls: 2, dbErrors: 0 });
    expect(line.dbMs as number).toBeGreaterThanOrEqual(30);
    expect(line.ms as number).toBeGreaterThanOrEqual(line.dbMs as number);
    expect(line.request).toEqual(expect.any(String));
  });

  it("tells a refusal from a failure", async () => {
    const refused = await linesOf(traced("submitScore", async () => ({ ok: false, error: "Enter a score." })));
    expect(refused[0]).toMatchObject({ level: "info", outcome: "refused", error: "Enter a score." });

    const thrown = traced("setCurrentEntry", async () => {
      throw new Error("connection reset");
    });
    await expect(thrown()).rejects.toThrow("connection reset");
    const failed = await linesOf(thrown);
    expect(failed[0]).toMatchObject({ level: "error", outcome: "failed", error: "connection reset" });
  });

  it("gives a route's status", async () => {
    const [line] = await linesOf(traced("GET /admin/[id]/export", async () => new Response("Not yet", { status: 409 })));
    expect(line).toMatchObject({ outcome: "refused", status: 409 });
  });
});

describe("timedFetch", () => {
  it("logs a slow call with its path, never its query", async () => {
    database(SLOW_DB_MS + 20);
    const lines = await linesOf(() => timedFetch("https://db.example/rest/v1/judge_access?code=eq.SECRET1"));
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ level: "warn", event: "slow_db", method: "GET", path: "/rest/v1/judge_access", status: 200 });
    expect(JSON.stringify(lines)).not.toContain("SECRET1");
  });

  it("logs a failed call with the database's own reason", async () => {
    database(1, 400, { code: "42703", message: "column scores.points does not exist" });
    const [line] = await linesOf(() => timedFetch("https://db.example/rest/v1/scores", { method: "POST" }));
    expect(line).toMatchObject({ level: "error", event: "db_error", method: "POST", status: 400, code: "42703", error: "column scores.points does not exist" });
  });

  it("stays quiet about a fast call, and about a score that's already in", async () => {
    database(1);
    expect(await linesOf(() => timedFetch("https://db.example/rest/v1/scores"))).toEqual([]);
    database(1, 409, { code: "23505" });
    expect(await linesOf(() => timedFetch("https://db.example/rest/v1/scores", { method: "POST" }))).toEqual([]);
  });
});
