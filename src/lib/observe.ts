import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import { headers } from "next/headers";
import { unstable_rethrow } from "next/navigation";
import { log, messageOf } from "./log";

/** One action or route being answered: its id, and the time it has spent waiting on the database so far. */
type Trace = { request: string; dbMs: number; dbCalls: number; dbErrors: number };
const traces = new AsyncLocalStorage<Trace>();

/** A database call this slow gets a line of its own: one at a time, the tail an average hides. */
export const SLOW_DB_MS = 500;
/**
 * How long a call to the database may take before it's given up: past the database's own 8-second limit on a query,
 * so this only catches a connection that has stalled. A photo upload gets longer.
 */
export const DB_TIMEOUT_MS = 10_000;
export const UPLOAD_TIMEOUT_MS = 30_000;

/** Vercel's id for the request, which its own request logs show too; a short random one elsewhere. */
async function requestId(): Promise<string> {
  try {
    const id = (await headers()).get("x-vercel-id");
    if (id) return id.slice(0, 80);
  } catch {
    // Outside a request (a unit test): no headers.
  }
  return randomUUID().slice(0, 8);
}

/** Whether a thrown value is Next.js going somewhere (a redirect, not found), not a failure. */
function isNavigation(error: unknown): boolean {
  try {
    unstable_rethrow(error);
    return false;
  } catch {
    return true;
  }
}

/**
 * A server action or route handler that logs one line each time it answers: `ms` in all, `dbMs` of it waiting on the
 * database (`dbCalls` calls, `dbErrors` of them failed), and the outcome. "ok"; "refused", when it answered with an
 * error for the person (a validation message, or "That didn't save" after a failed write: `dbErrors` tells them
 * apart); or "failed", when it threw. A route's line has its `status`.
 */
export function traced<Args extends unknown[], Result>(name: string, run: (...args: Args) => Promise<Result>): (...args: Args) => Promise<Result> {
  return async (...args: Args) => {
    const trace: Trace = { request: await requestId(), dbMs: 0, dbCalls: 0, dbErrors: 0 };
    const started = performance.now();
    const done = (level: "info" | "warn" | "error", fields: Record<string, string | number | boolean>) =>
      log(level, "action", {
        action: name,
        ...fields,
        ms: Math.round(performance.now() - started),
        dbMs: Math.round(trace.dbMs),
        dbCalls: trace.dbCalls,
        dbErrors: trace.dbErrors,
        request: trace.request,
      });
    try {
      const result = await traces.run(trace, () => run(...args));
      if (result instanceof Response) done(result.status >= 500 ? "error" : "info", { outcome: result.status >= 400 ? "refused" : "ok", status: result.status });
      else if (result && typeof result === "object" && "ok" in result && result.ok === false) {
        const error = "error" in result ? String(result.error).slice(0, 200) : "";
        done(trace.dbErrors ? "warn" : "info", { outcome: "refused", error });
      } else done("info", { outcome: "ok" });
      return result;
    } catch (error) {
      if (isNavigation(error)) done("info", { outcome: "ok", navigated: true });
      else done("error", { outcome: "failed", error: messageOf(error).slice(0, 300) });
      throw error;
    }
  };
}

const urlOf = (input: RequestInfo | URL) => new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);

/**
 * The fetch the server's Supabase client uses: it times every call to the database (and to Storage), counts it
 * towards the action it's part of, and logs one that's slow or failed. Only the method and path are logged (the
 * table, or the file), never the query, whose filters can carry a judge's code. A failed write that's expected (409:
 * already there, for a score sent twice) isn't counted as an error. A call that doesn't answer in time is given up
 * (DB_TIMEOUT_MS), rather than holding the action until the host's own limit minutes later.
 */
export async function timedFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const started = performance.now();
  const trace = traces.getStore();
  const limit = AbortSignal.timeout(urlOf(input).pathname.startsWith("/storage/") ? UPLOAD_TIMEOUT_MS : DB_TIMEOUT_MS);
  const signal = init?.signal ? AbortSignal.any([init.signal, limit]) : limit;
  const where = () => {
    const url = urlOf(input);
    return { method: init?.method ?? (input instanceof Request ? input.method : "GET"), path: url.pathname.slice(0, 160), request: trace?.request };
  };
  let response: Response;
  try {
    response = await fetch(input, { ...init, signal });
  } catch (error) {
    if (trace) trace.dbErrors++;
    log("error", "db_unreachable", { ...where(), ms: Math.round(performance.now() - started), timedOut: limit.aborted, error: messageOf(error).slice(0, 200) });
    throw error;
  }
  const ms = performance.now() - started;
  const failed = response.status >= 500 || (response.status >= 400 && response.status !== 404 && response.status !== 406 && response.status !== 409);
  if (trace) {
    trace.dbMs += ms;
    trace.dbCalls++;
    if (failed) trace.dbErrors++;
  }
  if (failed) {
    // PostgREST's error: its code and message say what went wrong (a missing column, a broken rule, a timeout).
    const body = await response
      .clone()
      .json()
      .catch(() => null);
    const detail = body && typeof body === "object" ? (body as { code?: string; message?: string }) : {};
    log("error", "db_error", { ...where(), status: response.status, ms: Math.round(ms), code: detail.code, error: detail.message?.slice(0, 300) });
  } else if (ms >= SLOW_DB_MS) {
    log("warn", "slow_db", { ...where(), status: response.status, ms: Math.round(ms) });
  }
  return response;
}
