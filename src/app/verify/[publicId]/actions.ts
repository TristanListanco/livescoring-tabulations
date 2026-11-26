"use server";

import { FINGERPRINT, readExport } from "@/lib/csv";
import { checkableActivity, getAdminBoard } from "@/lib/data";
import { sheetsNow } from "@/lib/exports";
import { sha256 } from "@/lib/results-csv";
import type { ActionResult } from "@/lib/types";

/** A CSV of one activity's results is well under this; anything bigger isn't one. */
const MAX_CSV_BYTES = 2_000_000;

const no = (error: string): ActionResult => ({ ok: false, error });

/**
 * Checks a results sheet someone has (an accounting firm verifying the results, say) against the activity's results as
 * they stand now, from the address printed on the sheet: its report ID says which results it was printed from, and its
 * CSV, every number on it (its rows must still match its own fingerprint, and that fingerprint must be one of the sheets
 * the scores give now). Says only whether it matches and which sheet it is, never a score.
 */
export async function checkSheet(publicId: string, _previous: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const activity = await checkableActivity(publicId);
  if (!activity) return no("These results can't be checked here: the activity is gone.");
  const board = await getAdminBoard(activity.id);
  const sheets = board ? await sheetsNow(board) : [];
  if (!sheets.length) return no(`${activity.name} has no official results right now, so there's nothing to check a sheet against.`);

  const file = formData.get("file");
  if (file instanceof File && file.size > 0) {
    if (file.size > MAX_CSV_BYTES) return no("That file is too big to be a CSV downloaded from Tabulous.");
    const read = readExport(await file.text());
    const fingerprint = read?.header.get(FINGERPRINT);
    if (!read || !fingerprint) return no("That isn't a CSV downloaded from Tabulous: it has no fingerprint.");
    if (sha256(read.rows) !== fingerprint) return no("This file was changed after it was downloaded: its rows no longer match its fingerprint.");
    for (const sheet of sheets) {
      if ((await sheet.fingerprint()) === fingerprint) return { ok: true, message: `It matches “${sheet.label}”, every number as ${activity.name}'s results stand now.` };
    }
    return no(`It's unchanged since it was downloaded, but it doesn't match ${activity.name}'s results as they stand now: it's from another activity, or a score has changed since.`);
  }

  const typed = String(formData.get("report_id") ?? "").replace(/\s+/g, "").toUpperCase();
  if (!typed) return no("Type the report ID printed at the top of the sheet, or choose its CSV.");
  const labels = [...new Set(sheets.filter((s) => s.reportId === typed).map((s) => `“${s.label}”`))];
  if (!labels.length) {
    return no(`${typed} isn't the report ID of any of ${activity.name}'s results as they stand now: the sheet is from another activity, or a score has changed since it was printed.`);
  }
  return {
    ok: true,
    message: `${typed} is the report ID of ${labels.join(" and ")}, as ${activity.name}'s results stand now. To check every number on it too, choose its CSV.`,
  };
}
