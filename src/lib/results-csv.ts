import "server-only";
import { createHash } from "node:crypto";
import { BOM, csvBlock, csvRow, FINGERPRINT, LINE } from "./csv";
import type { StandingsSheet } from "./results-pdf";
import { averageText, formatScore, judgeSheet, rankEntries, scoreText } from "./scoring";
import { applyTieBreaks } from "./ties";
import type { Board } from "./types";

/** The sheet's rows: column names, then each row's cells, ready to write. */
export type CsvTable = { columns: string[]; rows: (string | number | null)[][] };

export const sha256 = (text: string) => createHash("sha256").update(text, "utf8").digest("hex");

/**
 * A sheet as CSV: the header (the activity, which sheet, its report ID as on the PDF, when it was exported and the
 * fingerprint of its rows), a blank line, then the rows. Only the rows are fingerprinted, so the same scores always give
 * the same fingerprint, whenever they're exported.
 */
export function renderCsv(
  meta: { activity: string; sheet: string; reportId: string | null; exportedAt: string },
  table: CsvTable,
): { text: string; fingerprint: string } {
  const rows = csvBlock(table.columns, table.rows);
  const fingerprint = sha256(rows);
  const header = [
    ["Activity", meta.activity],
    ["Sheet", meta.sheet],
    ...(meta.reportId ? [["Report ID", meta.reportId]] : []),
    ["Exported", meta.exportedAt],
    [FINGERPRINT, fingerprint],
    ["Note", "A read-only copy: any change to the rows below stops them matching the fingerprint. Check a copy on the Session tab."],
  ];
  return { text: BOM + header.map(csvRow).join(LINE) + LINE + LINE + rows + LINE, fingerprint };
}

/** The results, as on the results PDF: rank (ties the judges broke placed as they ordered them), entry, each judge, average. */
export function resultsTable(board: Board, noun: "Entry" | "Candidate" = "Entry"): CsvTable {
  const { activity, judges } = board;
  const rows = applyTieBreaks(rankEntries(board.entries, judges, board.scores, activity), board.tieBreaks ?? []);
  return {
    columns: ["Rank", "No.", noun, ...judges.map((j) => j.name), "Average"],
    rows: rows.map((row) => [
      row.rank,
      row.number,
      row.entry.name,
      ...judges.map((j) => {
        const value = row.scores.get(j.id);
        return value === undefined ? null : scoreText(value, activity);
      }),
      row.average === null ? null : averageText(row.average, activity),
    ]),
  };
}

/** Every judge's scores, as on their score sheets: one row per judge and entry, with each criterion's points. */
export function judgeScoresTable(board: Board, noun: "Entry" | "Candidate" = "Entry"): CsvTable {
  const { activity } = board;
  const criteria = activity.scoringMode === "criteria" ? activity.criteria : [];
  return {
    columns: ["Judge", "No.", noun, "Score", ...criteria.map((c) => `${c.name} (${c.max})`)],
    rows: board.judges.flatMap((judge) =>
      judgeSheet(board, judge.id).map((row) => [
        judge.name,
        row.number,
        row.entry.name,
        row.value === null ? null : formatScore(row.value, activity.decimals),
        ...row.points.map((p) => (p === null ? null : formatScore(p, activity.decimals))),
      ]),
    ),
  };
}

/** A pageant's standings, as on its sheet: placed candidates first in their confirmed order, each part, deductions, total. */
export function standingsTable(board: Board, sheet: StandingsSheet): CsvTable {
  const places = board.activity.resultDecimals;
  const pct = (v: number | null | undefined) => (v === null || v === undefined ? null : `${v.toFixed(places)}%`);
  const placed = sheet.placed ?? [];
  const placeOf = new Map(placed.map((id, i) => [id, i + 1]));
  const rows = sheet.placed ? [...sheet.rows].sort((a, b) => (placeOf.get(a.entry.id) ?? Infinity) - (placeOf.get(b.entry.id) ?? Infinity)) : sheet.rows;
  const tieBroken = new Set(sheet.placed ? sheet.tieBroken : []);
  const status = sheet.kind === "final" ? "Place" : sheet.kind === "cut" ? "Result" : null;
  const deducting = sheet.rows.some((r) => r.deducted > 0);
  const share = (weight: number) => `${Math.round(weight * 100) / 100}%`;
  return {
    columns: [
      ...(status ? [status] : []),
      "Rank",
      "No.",
      "Candidate",
      ...sheet.weights.map((w) => `${w.round.name} (${share(w.weight)})`),
      ...(deducting ? ["Deductions"] : []),
      "Total",
      ...(tieBroken.size ? ["Tie broken"] : []),
    ],
    rows: rows.map((row) => [
      ...(status ? [sheet.kind === "final" ? (placeOf.get(row.entry.id) ?? null) : placeOf.has(row.entry.id) ? "Through" : null] : []),
      row.rank,
      row.number,
      row.entry.name,
      ...sheet.weights.map((w) => pct(row.parts.get(w.round.id))),
      ...(deducting ? [row.deducted > 0 ? `-${row.deducted.toFixed(places)}` : null] : []),
      pct(row.total),
      ...(tieBroken.size ? [tieBroken.has(row.entry.id) ? "Yes" : null] : []),
    ]),
  };
}
