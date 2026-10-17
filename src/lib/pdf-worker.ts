import { parentPort } from "node:worker_threads";
import { renderJudgeSheetsPdf, renderNotesPdf, renderResultsPdf, renderStandingsPdf } from "./results-pdf";

/** The PDF worker (see pdf.ts): draws each PDF it's sent and sends it back. */
const RENDERERS = { renderResultsPdf, renderJudgeSheetsPdf, renderStandingsPdf, renderNotesPdf };
export type PdfKind = keyof typeof RENDERERS;
export type PdfJob = { id: number; kind: PdfKind; args: unknown[] };
export type PdfReply = { id: number; pdf: Uint8Array } | { id: number; error: string };

parentPort?.on("message", async ({ id, kind, args }: PdfJob) => {
  try {
    // The organizer's photo comes across as plain bytes; the renderer takes a Buffer.
    const options = args.at(-1) as { organizer?: { photo: Uint8Array | null } | null };
    if (options.organizer?.photo) options.organizer.photo = Buffer.from(options.organizer.photo);
    const render = RENDERERS[kind] as (...args: unknown[]) => Promise<Buffer>;
    parentPort!.postMessage({ id, pdf: await render(...args) } satisfies PdfReply);
  } catch (e) {
    parentPort!.postMessage({ id, error: e instanceof Error ? e.message : String(e) } satisfies PdfReply);
  }
});
