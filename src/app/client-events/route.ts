import { deviceLabel } from "@/lib/device-label";
import { log } from "@/lib/log";
import { PROBLEM_KINDS, type ProblemKind } from "@/lib/report-problem";

/** A screen in trouble reports a few times; more than this a minute from one address is noise, or someone filling the log. */
const PER_MINUTE = 30;
const recent = new Map<string, number[]>();

/** The page, without its query, and without the code a judge link carries in its path. */
const pagePath = (where: unknown) =>
  typeof where === "string" ? where.split("?")[0].replace(/^\/judge\/join\/[^/]+/, "/judge/join/[code]").slice(0, 120) : undefined;

/**
 * Problems the screens report about themselves (see report-problem.ts), as a line in the log each: what went wrong,
 * where, and on what kind of device. Nothing else is kept. Limited per address, in memory: a busy server forgets.
 */
export async function POST(request: Request) {
  const address = request.headers.get("x-real-ip") ?? request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  const now = Date.now();
  const times = (recent.get(address) ?? []).filter((t) => now - t < 60_000);
  if (times.length >= PER_MINUTE) return new Response(null, { status: 429 });
  if (recent.size > 5_000) recent.clear();
  recent.set(address, [...times, now]);

  let body: { kind?: unknown; where?: unknown; digest?: unknown };
  try {
    body = JSON.parse((await request.text()).slice(0, 1_000));
  } catch {
    return new Response(null, { status: 400 });
  }
  if (typeof body?.kind !== "string" || !PROBLEM_KINDS.includes(body.kind as ProblemKind)) return new Response(null, { status: 400 });
  log("warn", "client_problem", {
    kind: body.kind,
    where: pagePath(body.where),
    digest: typeof body.digest === "string" ? body.digest.slice(0, 40) : undefined,
    device: deviceLabel(request.headers.get("user-agent")),
    request: request.headers.get("x-vercel-id")?.slice(0, 80),
  });
  return new Response(null, { status: 204 });
}
