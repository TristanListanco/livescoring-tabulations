import { getAdmin, getBoard, getSignatories } from "@/lib/data";
import { reportId } from "@/lib/report";
import { cutPlan, finalCutRound, partsOf, partWeights, programOrder, roundBoard, roundLabel, roundPool, roundProgress, standings, standingsBy } from "@/lib/pageant";
import { renderResultsPdf, renderStandingsPdf, type ReportOrganizer, type StandingsSheet } from "@/lib/results-pdf";
import { scoreProgress } from "@/lib/scoring";
import { canManageActivity, currentAdmin } from "@/lib/session";
import { PRELIMINARY, type Board } from "@/lib/types";

function slug(name: string): string {
  return name
    .normalize("NFKD")
    .replace(/[^\w\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .toLowerCase();
}

function fileName(...parts: string[]): string {
  return `${parts.map(slug).filter(Boolean).join("-") || "activity"}-results.pdf`;
}

function pdfResponse(pdf: Buffer, name: string): Response {
  return new Response(new Uint8Array(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${name}"`,
      "Cache-Control": "no-store",
    },
  });
}

const notYet = (message: string) => new Response(message, { status: 409 });

/**
 * A pageant's sheets: a sub-activity's results (?round=id), a cut or the final results (?cut=id), or the
 * preliminary's standings (?segment=preliminary). Each once its scores are all in, and a cut once it's confirmed.
 */
async function pageantPdf(board: Board, search: URLSearchParams, timeZone: string | undefined): Promise<Response> {
  const { activity } = board;
  const organizer = () => reportOrganizer(activity.ownerId);
  const order = programOrder(board.rounds);

  const roundId = search.get("round");
  if (roundId) {
    const round = board.rounds.find((r) => r.id === roundId);
    if (!round) return new Response("Sub-activity not found.", { status: 404 });
    const label = roundLabel(board.rounds, round);
    const progress = roundProgress(board, round);
    if (!progress.complete) return notYet(`${label} results can be exported once all scores are in (${progress.submitted} of ${progress.possible} so far).`);

    // A sub-activity in parts: its standings, each part a column with its share.
    if (partsOf(board.rounds, round.id).length) {
      const weights = partWeights(board.rounds, round);
      const { rows } = standingsBy(board, roundPool(board, round.id).entries, weights);
      const parts = new Set(weights.map((w) => w.round.id));
      const scope: Board = { ...board, entries: rows.map((r) => r.entry), scores: board.scores.filter((s) => s.roundId && parts.has(s.roundId)) };
      const sheet: StandingsSheet = { kind: "subactivity", title: `${round.name} results`, weights, rows, placed: null, tieBroken: [] };
      const pdf = await renderStandingsPdf(board, sheet, { timeZone, reportId: reportId(scope, `subactivity:${round.id}`), organizer: await organizer() });
      return pdfResponse(pdf, fileName(activity.name, round.name));
    }

    const part = roundBoard(board, round);
    const pdf = await renderResultsPdf(part, { timeZone, reportId: reportId(part, `round:${round.id}`), organizer: await organizer(), part: label });
    return pdfResponse(pdf, fileName(activity.name, label));
  }

  const cutId = search.get("cut") ?? (search.get("segment") ? null : finalCutRound(board.rounds)?.id);
  if (cutId) {
    const round = order.find((r) => r.id === cutId && r.cutSize !== null);
    if (!round) return new Response("Cut not found.", { status: 404 });
    if (round.cutEntryIds === null) return notYet(`Confirm the ${round.name} cut on the Session tab first.`);
    const plan = cutPlan(board, round);
    const basisRounds = new Set(plan.weights.flatMap((w) => [w.round.id, ...partsOf(board.rounds, w.round.id).map((p) => p.id)]));
    const scope: Board = { ...board, entries: plan.rows.map((r) => r.entry), scores: board.scores.filter((s) => s.roundId && basisRounds.has(s.roundId)) };
    const title = plan.final ? "Final results" : `Top ${round.cutEntryIds.length} after ${round.name}`;
    const sheet: StandingsSheet = {
      kind: plan.final ? "final" : "cut",
      title,
      weights: plan.weights,
      rows: plan.rows,
      placed: round.cutEntryIds,
      tieBroken: plan.ties.flatMap((t) => t.rows.map((r) => r.entry.id)),
    };
    const id = reportId(scope, `cut:${round.id}:${round.cutEntryIds.join(",")}`);
    const pdf = await renderStandingsPdf(board, sheet, { timeZone, reportId: id, organizer: await organizer() });
    return pdfResponse(pdf, fileName(activity.name, plan.final ? "final" : `top ${round.cutEntryIds.length}`));
  }

  if (search.get("segment") === "preliminary") {
    const prelim = order.filter((r) => r.segment === "preliminary");
    const missing = prelim.find((r) => !roundProgress(board, r).complete);
    if (!prelim.length) return new Response("This pageant has no preliminary.", { status: 404 });
    if (missing) return notYet(`The preliminary results can be exported once every score is in, including ${missing.name}.`);
    const entries = roundPool(board, prelim[0].id).entries;
    const { weights, rows } = standings(board, entries, [PRELIMINARY]);
    const prelimIds = new Set(prelim.flatMap((r) => [r.id, ...partsOf(board.rounds, r.id).map((p) => p.id)]));
    const scope: Board = { ...board, scores: board.scores.filter((s) => s.roundId && prelimIds.has(s.roundId)) };
    const sheet: StandingsSheet = { kind: "preliminary", title: "Preliminary results", weights, rows, placed: null, tieBroken: [] };
    const pdf = await renderStandingsPdf(board, sheet, { timeZone, reportId: reportId(scope, "segment:preliminary"), organizer: await organizer() });
    return pdfResponse(pdf, fileName(activity.name, "preliminary"));
  }

  return new Response("Choose which results to download from the Session tab.", { status: 400 });
}

/** The activity's organizer for the sheet's header and signature lines. A photo that won't load is left out, not fatal. */
async function reportOrganizer(ownerId: string | null): Promise<ReportOrganizer | null> {
  if (!ownerId) return null;
  const [admin, signatories] = await Promise.all([getAdmin(ownerId), getSignatories(ownerId)]);
  if (!admin) return null;
  let photo: Buffer | null = null;
  if (admin.photoUrl) {
    try {
      const response = await fetch(admin.photoUrl, { signal: AbortSignal.timeout(5000) });
      if (response.ok) photo = Buffer.from(await response.arrayBuffer());
    } catch {
      photo = null;
    }
  }
  return { name: admin.name, photo, signatories };
}

/** Results sheet as a PDF. Only once every judge has scored every entry (for a pageant, see pageantPdf). */
export async function GET(request: Request, { params }: RouteContext<"/admin/[id]/export">) {
  const session = await currentAdmin();
  if (!session) return new Response("Sign in to the admin panel first.", { status: 401 });

  const board = await getBoard((await params).id);
  // Organizers export only their own activities, the super admin only those no organizer owns.
  if (!board || !canManageActivity(session, board.activity.ownerId)) {
    return new Response("Activity not found.", { status: 404 });
  }

  const timeZone = new URL(request.url).searchParams.get("tz") ?? undefined;
  if (board.activity.kind === "pageant") return pageantPdf(board, new URL(request.url).searchParams, timeZone);

  const progress = scoreProgress(board);
  if (!progress.complete) {
    return new Response(`Results can be exported once all scores are in (${progress.submitted} of ${progress.possible} so far).`, {
      status: 409,
    });
  }

  const pdf = await renderResultsPdf(board, { timeZone, reportId: reportId(board), organizer: await reportOrganizer(board.activity.ownerId) });
  return pdfResponse(pdf, fileName(board.activity.name));
}
