import { monitorEventLoopDelay } from "node:perf_hooks";
import { log } from "./lib/log";

/**
 * In production, a line a minute on how loaded this server is (the "runtime" event). How late its timers ran (event
 * loop delay: p50, p99 and the worst, in ms) shows a server too busy to answer promptly, the way a big PDF drawn on the
 * main thread used to; and its memory (rss and heap, in MB). Node.js only: see instrumentation.ts.
 */
export function startRuntimeMetrics() {
  if (process.env.NODE_ENV !== "production") return;
  const delay = monitorEventLoopDelay({ resolution: 20 });
  delay.enable();
  const ms = (ns: number) => Math.round(ns / 1e6);
  setInterval(() => {
    const memory = process.memoryUsage();
    log("info", "runtime", {
      loopP50Ms: ms(delay.percentile(50)),
      loopP99Ms: ms(delay.percentile(99)),
      loopMaxMs: ms(delay.max),
      rssMb: Math.round(memory.rss / 1e6),
      heapMb: Math.round(memory.heapUsed / 1e6),
      uptimeS: Math.round(process.uptime()),
    });
    delay.reset();
  }, 60_000).unref();
}
