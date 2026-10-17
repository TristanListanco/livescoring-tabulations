import "server-only";
import { Worker } from "node:worker_threads";
import type { PdfJob, PdfKind, PdfReply } from "./pdf-worker";
import { log, messageOf } from "./log";
import * as here from "./results-pdf";

/**
 * The results PDFs, drawn on a worker thread. Drawing a PDF is one long stretch of work that never pauses (a big
 * activity's judges' notes take a second or two), and a server answers many requests at once: drawn on its main
 * thread, a PDF would hold up every other request on that server until it was done, judges' scores included.
 *
 * One worker per server, started with the first download and kept for the next: starting one takes longer than
 * drawing most PDFs. If it can't start at all, PDFs are drawn here as before; if it stops after working, the next
 * download starts another. (In development, once this file has been hot-reloaded the worker can't start: Turbopack's
 * worker loader needs `__dirname`, which hot-reloaded code doesn't get. PDFs are drawn here until the dev server
 * restarts. Production builds load their code normally.)
 */

/** Long enough for any real PDF; a render still going after this is stuck, and its worker is replaced. */
const TIMEOUT_MS = 60_000;

type Job = { kind: PdfKind; args: unknown[]; resolve: (pdf: Buffer) => void; reject: (error: Error) => void; timer: NodeJS.Timeout };

let worker: Worker | null = null;
let workerUnavailable = false;
let nextId = 0;
const waiting = new Map<number, Job>();

// In development this module is reloaded with every change: the worker from before goes with the code it ran.
const shared = globalThis as typeof globalThis & { pdfWorker?: Worker };
void shared.pdfWorker?.terminate();

const drawHere = (kind: PdfKind, args: unknown[]) => (here[kind] as (...args: unknown[]) => Promise<Buffer>)(...args);

function startWorker(): Worker | null {
  if (worker || workerUnavailable) return worker;
  let started: Worker;
  try {
    started = new Worker(new URL("./pdf-worker.ts", import.meta.url));
  } catch (error) {
    log("error", "pdf_worker_unavailable", { error: messageOf(error) });
    workerUnavailable = true;
    return null;
  }
  let replied = false;
  // An idle worker doesn't keep the server running.
  started.unref();
  started.on("message", (reply: PdfReply) => {
    replied = true;
    const job = waiting.get(reply.id);
    if (!job) return;
    waiting.delete(reply.id);
    clearTimeout(job.timer);
    if ("pdf" in reply) job.resolve(Buffer.from(reply.pdf.buffer, reply.pdf.byteOffset, reply.pdf.byteLength));
    else job.reject(new Error(reply.error));
  });
  started.on("error", (error) => log("error", "pdf_worker_failed", { error: messageOf(error) }));
  started.on("exit", () => {
    if (worker === started) worker = null;
    // One that never drew a PDF can't run here (it couldn't load, say): this server draws them itself from now on.
    if (!replied) workerUnavailable = true;
    for (const [id, job] of waiting) {
      waiting.delete(id);
      clearTimeout(job.timer);
      if (workerUnavailable) drawHere(job.kind, job.args).then(job.resolve, job.reject);
      else job.reject(new Error("The PDF worker stopped."));
    }
  });
  worker = shared.pdfWorker = started;
  return started;
}

function draw(kind: PdfKind, args: unknown[]): Promise<Buffer> {
  const target = startWorker();
  if (!target) return drawHere(kind, args);
  return new Promise((resolve, reject) => {
    const id = nextId++;
    const timer = setTimeout(() => {
      waiting.delete(id);
      reject(new Error("The PDF took too long."));
      void target.terminate();
    }, TIMEOUT_MS);
    waiting.set(id, { kind, args, resolve, reject, timer });
    try {
      target.postMessage({ id, kind, args } satisfies PdfJob);
    } catch {
      // Something in it can't be copied to the worker: this one is drawn here.
      waiting.delete(id);
      clearTimeout(timer);
      drawHere(kind, args).then(resolve, reject);
    }
  });
}

/** Where this server draws PDFs: on its worker, or itself when the worker can't run here. */
export const pdfDrawnOn = (): "worker" | "server" => (workerUnavailable ? "server" : "worker");

export const renderResultsPdf: typeof here.renderResultsPdf = (...args) => draw("renderResultsPdf", args);
export const renderJudgeSheetsPdf: typeof here.renderJudgeSheetsPdf = (...args) => draw("renderJudgeSheetsPdf", args);
export const renderStandingsPdf: typeof here.renderStandingsPdf = (...args) => draw("renderStandingsPdf", args);
export const renderNotesPdf: typeof here.renderNotesPdf = (...args) => draw("renderNotesPdf", args);
