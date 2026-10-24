import type { Instrumentation } from "next";

/**
 * Each server, once it starts: on Node.js, its runtime metrics (see instrumentation-node.ts). Loaded behind the runtime
 * check, which Next.js settles when it builds each runtime, so the Edge runtime's build never sees Node.js's modules.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { startRuntimeMetrics } = await import("./instrumentation-node");
    startRuntimeMetrics();
  }
}

/**
 * Every error a page, route or action throws, in the same JSON lines as the rest (see log.ts). The `digest` is the
 * reference the admin's error screen shows, so a screenshot of it leads here. The path goes without its query, which
 * can carry a judge's code, and without the code in a judge link's own path (/judge/join/<code>); no headers, which
 * carry cookies.
 */
export const onRequestError: Instrumentation.onRequestError = async (error, request, context) => {
  const { log, messageOf } = await import("./lib/log");
  log("error", "request_error", {
    method: request.method,
    path: request.path.split("?")[0].replace(/^\/judge\/join\/[^/]+/, "/judge/join/[code]").slice(0, 160),
    route: context.routePath,
    kind: context.routeType,
    digest: typeof error === "object" && error !== null && "digest" in error ? String(error.digest) : undefined,
    error: messageOf(error).slice(0, 300),
  });
};
