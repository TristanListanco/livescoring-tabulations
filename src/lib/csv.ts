/**
 * Results as CSV: a header (what the sheet is, its report ID, and a fingerprint of its rows), a blank line, then the
 * rows. A CSV is plain text, so any program can change it; the fingerprint is how a changed copy is caught. It's the
 * SHA-256 of the rows exactly as written, so the browser (checking a copy, see CsvCheck) and the server (writing one)
 * read a file the same way, through readExport. Pure, for both.
 */

/** A byte-order mark first, so Excel reads names in UTF-8. */
export const BOM = "﻿";
/** CSV's line break (RFC 4180). */
export const LINE = "\r\n";
/** The header field holding the fingerprint. */
export const FINGERPRINT = "Fingerprint (SHA-256)";

/** A number as written in a sheet: these never need guarding against formulas, "-0.80" included. */
const NUMBER = /^-?\d+(\.\d+)?%?$/;

/**
 * One cell. Text a spreadsheet would run as a formula (an entry named "=HYPERLINK(…)", "+1", "@cmd") is prefixed with
 * an apostrophe, so it shows as text; then it's quoted if it holds a comma, a quote or a line break.
 */
export function csvCell(value: string | number | null | undefined): string {
  let text = value === null || value === undefined ? "" : String(value);
  if (/^[=+\-@\t\r]/.test(text) && !NUMBER.test(text)) text = `'${text}`;
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export const csvRow = (cells: (string | number | null | undefined)[]) => cells.map(csvCell).join(",");

/** The rows a fingerprint covers: the column names, then each row. */
export const csvBlock = (columns: string[], rows: (string | number | null | undefined)[][]) => [columns, ...rows].map(csvRow).join(LINE);

/** One line of CSV back into its cells (quoted cells, doubled quotes). */
export function parseCsvLine(line: string): string[] {
  const cells: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (quoted) {
      if (c === '"' && line[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (c === '"') quoted = false;
      else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") {
      cells.push(cell);
      cell = "";
    } else cell += c;
  }
  cells.push(cell);
  return cells;
}

/**
 * An exported CSV, read back: its header (field → value) and its rows as written (trailing line breaks aside), which
 * is what the fingerprint covers. Null when it isn't one (no header, no blank line).
 */
export function readExport(text: string): { header: Map<string, string>; rows: string } | null {
  const body = text.startsWith(BOM) ? text.slice(1) : text;
  const at = body.indexOf(LINE + LINE);
  if (at < 0) return null;
  const header = new Map(
    body
      .slice(0, at)
      .split(LINE)
      .map((line) => {
        const [field, ...value] = parseCsvLine(line);
        return [field, value.join(",")] as const;
      }),
  );
  return { header, rows: body.slice(at + LINE.length * 2).replace(/(\r\n)+$/, "") };
}
