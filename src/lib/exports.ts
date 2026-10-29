import "server-only";
import { correctionView, type Correction, type CorrectionView } from "./corrections";
import { getActivityNotes, getActivitySignatories, getActivitySignoff, getAdmin, getCorrections, getSignatures, withBreakdowns } from "./data";
import { reportId } from "./report";
import { cutPlan, finalCutRound, judgesForRounds, partsOf, partWeights, programOrder, roundBoard, roundLabel, roundPool, roundProgress, standings, standingsBy, type StandingRow } from "./pageant";
// Drawn on a worker thread, so a big PDF doesn't hold up other requests to this server (see pdf.ts).
import { pdfDrawnOn, renderJudgeSheetsPdf, renderNotesPdf, renderResultsPdf, renderStandingsPdf } from "./pdf";
import type { ReportOrganizer, StandingsSheet } from "./results-pdf";
import { judgeScoresTable, renderCsv, resultsTable, standingsTable, type CsvTable } from "./results-csv";
import { scoreProgress } from "./scoring";
import { PRELIMINARY, type Activity, type Board, type Deduction, type Round, type Signatory } from "./types";

/**
 * An activity's downloads: its results, judges' score sheets and notes as PDFs, and the results and judges' scores as
 * CSV too (?format=csv). Each sheet is worked out once (see sheetFor), then drawn as a PDF or written as CSV, so both
 * carry the same scores and the same report ID. The CSV checker (csvFingerprints) goes through the same sheets.
 */

function slug(name: string): string {
  return name
    .normalize("NFKD")
    .replace(/[^\w\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .toLowerCase();
}

const base = (...parts: string[]) => parts.map(slug).filter(Boolean).join("-") || "activity";

/** "finals-results.pdf", "finals-results.csv". */
const resultsFiles = (...parts: string[]) => ({ pdf: `${base(...parts)}-results.pdf`, csv: `${base(...parts)}-results.csv` });

/** The judges' score sheets that go with a results sheet: "finals-judges-score-sheets.pdf", "finals-judges-scores.csv". */
const sheetsFiles = (...parts: string[]) => ({ pdf: `${base(...parts)}-judges-score-sheets.pdf`, csv: `${base(...parts)}-judges-scores.csv` });

/** ?sheet=judges: each judge's score sheet rather than the results. */
const wantsJudgeSheets = (search: URLSearchParams) => search.get("sheet") === "judges";

/** The applied corrections to a sheet's scores (one pageant sub-activity's, or an event's): null before migration 019. */
const appliedTo = (board: Board, corrections: Correction[] | null, roundId: string | null): CorrectionView[] | null =>
  corrections && corrections.filter((c) => c.status === "approved" && c.roundId === roundId).map((c) => correctionView(board, c));

const notYet = (message: string) => new Response(message, { status: 409 });

/** The deductions a standings sheet counts: its candidates', when its totals take any off. */
const countedDeductions = (board: Board, rows: StandingRow[]): Deduction[] | undefined => {
  if (!rows.some((r) => r.deducted > 0)) return undefined;
  const ids = new Set(rows.map((r) => r.entry.id));
  return board.deductions?.filter((d) => ids.has(d.entryId));
};

/** A standings sheet is signed by the judges of what it counts: the preliminary can have its own panel. */
const signedBy = (board: Board, rounds: Round[]): Board => ({ ...board, judges: judgesForRounds(board, rounds) });

/** The activity's organizer for the sheet's header. A photo that won't load is left out, not fatal. */
async function reportOrganizer(ownerId: string | null): Promise<ReportOrganizer | null> {
  if (!ownerId) return null;
  const admin = await getAdmin(ownerId);
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
  return { name: admin.name, photo };
}

/** Who a results sheet is from and who signs it: the organizer, in the header, and the activity's signatories. */
async function reportPeople(activity: Activity): Promise<{ organizer: ReportOrganizer | null; signatories: Signatory[] }> {
  const [organizer, signatories] = await Promise.all([reportOrganizer(activity.ownerId), getActivitySignatories(activity.id)]);
  return { organizer, signatories: signatories ?? [] };
}

/** One download, worked out: what it's called, its report ID, and how to draw it as a PDF or (when it has one) its CSV rows. */
type Sheet = {
  /** Which sheet, in a CSV's header and the checker's answer: "Results", "Swimsuit results", "Judges' scores". */
  label: string;
  reportId: string | null;
  files: { pdf: string; csv: string | null };
  pdf: (timeZone: string | undefined) => Promise<Buffer>;
  csv: (() => Promise<CsvTable>) | null;
};

/** A pageant's sheets (see sheetFor): a sub-activity's results, a part's, a cut's, the final results, the preliminary's standings. */
function pageantSheet(board: Board, search: URLSearchParams, corrections: Correction[] | null): Sheet | Response {
  const { activity } = board;
  const people = () => reportPeople(activity);
  const order = programOrder(board.rounds);

  const roundId = search.get("round");
  if (roundId) {
    const round = board.rounds.find((r) => r.id === roundId);
    if (!round) return new Response("Sub-activity not found.", { status: 404 });
    const label = roundLabel(board.rounds, round);
    const progress = roundProgress(board, round);
    if (!progress.complete) return notYet(`${label} results can be exported once all scores are in (${progress.submitted} of ${progress.possible} so far).`);

    if (wantsJudgeSheets(search)) {
      if (partsOf(board.rounds, round.id).length) return new Response(`Download the judges' score sheets for each part of ${round.name}.`, { status: 400 });
      // The results sheet's report ID: the two go together.
      const id = reportId({ ...roundBoard(board, round), deductions: undefined }, `round:${round.id}`);
      const part = async () => roundBoard(await withBreakdowns(board), round);
      return {
        label: `${label} judges' scores`,
        reportId: id,
        files: sheetsFiles(activity.name, label),
        pdf: async (timeZone) =>
          renderJudgeSheetsPdf(await part(), { timeZone, reportId: id, ...(await people()), part: label, corrections: appliedTo(board, corrections, round.id) ?? [] }),
        csv: async () => judgeScoresTable(await part(), "Candidate"),
      };
    }

    // A sub-activity in parts: its standings, each part a column with its share.
    if (partsOf(board.rounds, round.id).length) {
      const weights = partWeights(board.rounds, round);
      const { rows } = standingsBy(board, roundPool(board, round.id).entries, weights);
      const parts = new Set(weights.map((w) => w.round.id));
      const scope: Board = { ...board, entries: rows.map((r) => r.entry), scores: board.scores.filter((s) => s.roundId && parts.has(s.roundId)), deductions: undefined };
      const sheet: StandingsSheet = { kind: "subactivity", title: `${round.name} results`, weights, rows, placed: null, tieBroken: [], deductions: [] };
      const id = reportId(scope, `subactivity:${round.id}`);
      return {
        label: sheet.title,
        reportId: id,
        files: resultsFiles(activity.name, round.name),
        pdf: async (timeZone) => renderStandingsPdf(signedBy(board, [round]), sheet, { timeZone, reportId: id, ...(await people()) }),
        csv: async () => standingsTable(board, sheet),
      };
    }

    // One sub-activity's results: deductions come off the preliminary as a whole, not here.
    const part: Board = { ...roundBoard(board, round), deductions: undefined };
    const id = reportId(part, `round:${round.id}`);
    return {
      label: `${label} results`,
      reportId: id,
      files: resultsFiles(activity.name, label),
      pdf: async (timeZone) => renderResultsPdf(part, { timeZone, reportId: id, ...(await people()), part: label, corrections: appliedTo(board, corrections, round.id) }),
      csv: async () => resultsTable(part, "Candidate"),
    };
  }

  if (wantsJudgeSheets(search)) return new Response("Judges' score sheets come with each sub-activity's results.", { status: 400 });

  const cutId = search.get("cut") ?? (search.get("segment") ? null : finalCutRound(board.rounds)?.id);
  if (cutId) {
    const round = order.find((r) => r.id === cutId && r.cutSize !== null);
    if (!round) return new Response("Cut not found.", { status: 404 });
    if (round.cutEntryIds === null) return notYet(`Confirm the ${round.name} cut on the Session tab first.`);
    const plan = cutPlan(board, round);
    const basisRounds = new Set(plan.weights.flatMap((w) => [w.round.id, ...partsOf(board.rounds, w.round.id).map((p) => p.id)]));
    const scope: Board = {
      ...board,
      entries: plan.rows.map((r) => r.entry),
      scores: board.scores.filter((s) => s.roundId && basisRounds.has(s.roundId)),
      deductions: countedDeductions(board, plan.rows),
    };
    const title = plan.final ? "Final results" : `Top ${round.cutEntryIds.length} after ${round.name}`;
    const sheet: StandingsSheet = {
      kind: plan.final ? "final" : "cut",
      title,
      weights: plan.weights,
      rows: plan.rows,
      placed: round.cutEntryIds,
      tieBroken: plan.ties.flatMap((t) => t.rows.map((r) => r.entry.id)),
      deductions: scope.deductions ?? [],
    };
    const id = reportId(scope, `cut:${round.id}:${round.cutEntryIds.join(",")}`);
    return {
      label: title,
      reportId: id,
      files: resultsFiles(activity.name, plan.final ? "final" : `top ${round.cutEntryIds.length}`),
      pdf: async (timeZone) => renderStandingsPdf(signedBy(board, plan.weights.map((w) => w.round)), sheet, { timeZone, reportId: id, ...(await people()) }),
      csv: async () => standingsTable(board, sheet),
    };
  }

  if (search.get("segment") === "preliminary") {
    const prelim = order.filter((r) => r.segment === "preliminary");
    const missing = prelim.find((r) => !roundProgress(board, r).complete);
    if (!prelim.length) return new Response("This pageant has no preliminary.", { status: 404 });
    if (missing) return notYet(`The preliminary results can be exported once every score is in, including ${missing.name}.`);
    const entries = roundPool(board, prelim[0].id).entries;
    const { weights, rows } = standings(board, entries, [PRELIMINARY]);
    const prelimIds = new Set(prelim.flatMap((r) => [r.id, ...partsOf(board.rounds, r.id).map((p) => p.id)]));
    const scope: Board = { ...board, scores: board.scores.filter((s) => s.roundId && prelimIds.has(s.roundId)), deductions: countedDeductions(board, rows) };
    const sheet: StandingsSheet = { kind: "preliminary", title: "Preliminary results", weights, rows, placed: null, tieBroken: [], deductions: scope.deductions ?? [] };
    const id = reportId(scope, "segment:preliminary");
    return {
      label: sheet.title,
      reportId: id,
      files: resultsFiles(activity.name, "preliminary"),
      pdf: async (timeZone) => renderStandingsPdf(signedBy(board, prelim), sheet, { timeZone, reportId: id, ...(await people()) }),
      csv: async () => standingsTable(board, sheet),
    };
  }

  return new Response("Choose which results to download from the Session tab.", { status: 400 });
}

/**
 * Which sheet a download asks for, once it's ready, or why not yet: the results (only once every judge has scored
 * every entry, and without live scoring once every judge has signed), ?sheet=judges each judge's score sheet,
 * ?sheet=notes the judges' notes (at any time), or a pageant's (see pageantSheet). `corrections`: the activity's.
 */
async function sheetFor(board: Board, search: URLSearchParams, corrections: Correction[] | null): Promise<Sheet | Response> {
  const { activity } = board;
  // The judges' notes aren't results: they download whenever there are any, whatever the scores.
  if (search.get("sheet") === "notes") {
    const notes = await getActivityNotes(activity.id);
    if (!notes) return new Response("Judges' notes need a database update. Run supabase/migrations/018_judge_notes.sql.", { status: 409 });
    return {
      label: "Judges' notes",
      reportId: null,
      files: { pdf: `${base(activity.name)}-judges-notes.pdf`, csv: null },
      pdf: async (timeZone) => renderNotesPdf(board, notes, { timeZone, organizer: await reportOrganizer(activity.ownerId) }),
      csv: null,
    };
  }
  // A correction still being voted on may change a score: nothing is printed until it's settled.
  if (corrections?.some((c) => c.status === "open")) {
    return notYet("A score correction is waiting for the judges' votes. The results can be downloaded once it's settled, since it may change a score.");
  }
  if (activity.kind === "pageant") return pageantSheet(board, search, corrections);

  const progress = scoreProgress(board);
  if (!progress.complete) return notYet(`Results can be exported once all scores are in (${progress.submitted} of ${progress.possible} so far).`);
  // Without live scoring the results are official once every judge has signed, at the end of the deliberation.
  if (!activity.liveScoring && !activity.signedOffAt) return notYet("The results PDF is ready once every judge has signed, at the end of the deliberation.");

  const id = reportId(board);
  // Signed in the deliberation: by every judge, then the organizer, who signed as they ended it.
  const signed = async () => (activity.liveScoring ? [null, null] : await Promise.all([getSignatures(activity.id), getActivitySignoff(activity.id)]));
  if (wantsJudgeSheets(search)) {
    return {
      label: "Judges' scores",
      reportId: id,
      files: sheetsFiles(activity.name),
      pdf: async (timeZone) => {
        const [signatures] = await signed();
        return renderJudgeSheetsPdf(await withBreakdowns(board), {
          timeZone,
          reportId: id,
          ...(await reportPeople(activity)),
          signatures,
          corrections: appliedTo(board, corrections, null) ?? [],
        });
      },
      csv: async () => judgeScoresTable(await withBreakdowns(board)),
    };
  }
  return {
    label: "Results",
    reportId: id,
    files: resultsFiles(activity.name),
    pdf: async (timeZone) => {
      const [signatures, signoff] = await signed();
      return renderResultsPdf(board, { timeZone, reportId: id, ...(await reportPeople(activity)), signatures, signoff, corrections: appliedTo(board, corrections, null) });
    },
    csv: async () => resultsTable(board),
  };
}

/** When a CSV was exported, in the browser's time zone (as a PDF prints it). */
function exportedAt(timeZone: string | undefined): string {
  let zone = timeZone;
  try {
    if (zone) new Intl.DateTimeFormat("en", { timeZone: zone });
  } catch {
    zone = undefined;
  }
  return new Intl.DateTimeFormat("en", { dateStyle: "long", timeStyle: "short", timeZone: zone }).format(new Date());
}

/** A download for the export route: the sheet the query asks for, as a PDF or (?format=csv) CSV, or why not. */
export async function exportResponse(board: Board, search: URLSearchParams): Promise<Response> {
  const timeZone = search.get("tz") ?? undefined;
  const corrections = search.get("sheet") === "notes" ? null : await getCorrections(board.activity.id);
  const sheet = await sheetFor(board, search, corrections);
  if (sheet instanceof Response) return sheet;

  if (search.get("format") === "csv") {
    if (!sheet.csv || !sheet.files.csv) return new Response(`${sheet.label} download as a PDF only.`, { status: 400 });
    const { text } = renderCsv({ activity: board.activity.name, sheet: sheet.label, reportId: sheet.reportId, exportedAt: exportedAt(timeZone) }, await sheet.csv());
    return new Response(text, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${sheet.files.csv}"`,
        "Cache-Control": "no-store",
      },
    });
  }
  const pdf = await sheet.pdf(timeZone);
  return new Response(new Uint8Array(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${sheet.files.pdf}"`,
      "Cache-Control": "no-store",
      // Where it was drawn, for a browser's developer tools and the tests: on the worker, as it should be.
      "Server-Timing": `pdf;desc=${pdfDrawnOn()}`,
    },
  });
}

/**
 * Every CSV this activity's scores give right now, with its fingerprint: what a copy is checked against (see
 * checkExport). The same sheets as the downloads, so a copy matches only if it's what was downloaded.
 */
export async function csvFingerprints(board: Board): Promise<{ label: string; fingerprint: string }[]> {
  const corrections = await getCorrections(board.activity.id);
  const queries =
    board.activity.kind === "pageant"
      ? [
          ...board.rounds.flatMap((r) => [`round=${r.id}`, ...(partsOf(board.rounds, r.id).length ? [] : [`round=${r.id}&sheet=judges`])]),
          ...board.rounds.filter((r) => r.cutSize !== null && r.cutEntryIds !== null).map((r) => `cut=${r.id}`),
          "segment=preliminary",
        ]
      : ["", "sheet=judges"];
  const found: { label: string; fingerprint: string }[] = [];
  for (const query of queries) {
    const sheet = await sheetFor(board, new URLSearchParams(query), corrections);
    if (sheet instanceof Response || !sheet.csv) continue;
    const { fingerprint } = renderCsv({ activity: board.activity.name, sheet: sheet.label, reportId: sheet.reportId, exportedAt: "" }, await sheet.csv());
    found.push({ label: sheet.label, fingerprint });
  }
  return found;
}
