"use client";

import { useActionState } from "react";
import { SubmitButton } from "@/components/submit-button";
import type { ActionResult } from "@/lib/types";
import { FormMessage } from "../../admin/(panel)/form-message";
import { checkSheet } from "./actions";

/** A results sheet's report ID, or its CSV, checked against the activity's results as they stand now (see checkSheet). */
export function SheetCheck({ publicId }: { publicId: string }) {
  const [state, check] = useActionState<ActionResult | null, FormData>(checkSheet.bind(null, publicId), null);
  return (
    <form action={check} className="card mt-8 space-y-5 p-5 sm:p-6">
      <div>
        <label htmlFor="report-id" className="label">
          Report ID
        </label>
        <input
          id="report-id"
          name="report_id"
          className="field tabular max-w-sm uppercase"
          placeholder="LS-0000-0000-0000"
          autoComplete="off"
          spellCheck={false}
          aria-describedby="report-id-hint"
        />
        <p id="report-id-hint" className="hint mt-1">
          At the top of every results sheet. It says which results the sheet was printed from.
        </p>
      </div>
      <div>
        <label htmlFor="sheet-csv" className="label">
          Or its CSV
        </label>
        <input id="sheet-csv" name="file" type="file" accept=".csv,text/csv" className="block text-[15px] file:mr-3 file:h-10 file:cursor-pointer file:rounded-full file:border file:border-line file:bg-white file:px-4 file:font-semibold file:text-regal hover:file:bg-wash" aria-describedby="sheet-csv-hint" />
        <p id="sheet-csv-hint" className="hint mt-1">
          The sheet downloaded as CSV: every number on it is checked too.
        </p>
      </div>
      <SubmitButton pendingLabel="Checking…">Check</SubmitButton>
      <FormMessage state={state} className="max-w-[65ch]" />
    </form>
  );
}
