"use client";

import { useId, useState, useTransition } from "react";
import { MAX_SIGNATORIES } from "@/lib/signatories";
import type { ActionResult, Signatory } from "@/lib/types";
import { saveSignatories } from "../actions";
import { FormMessage } from "./form-message";

const isBlank = (r: SignatoryRow) => !r.name.trim() && !r.designation.trim();
/** Signatories as they'd be saved (spaces tidied), as one string to compare. */
const listed = (list: { name: string; designation: string }[]) =>
  JSON.stringify(list.map((s) => [s.name.replace(/\s+/g, " ").trim(), s.designation.replace(/\s+/g, " ").trim()]));

/** Names and designations (Board of Tabulators, representatives) printed as signature lines on an activity's results PDFs. */
export function SignatoriesEditor({ activityId, initial }: { activityId: string; initial: Signatory[] }) {
  const [rows, setRows] = useState<SignatoryRow[]>(() => initial.map((s, i) => ({ key: i, ...s })));
  // What's saved, to tell whether there's anything to save: the button stands out only when there is.
  const [baseline, setBaseline] = useState(() => listed(initial));
  const changed = listed(rows.filter((r) => !isBlank(r))) !== baseline;
  const [result, setResult] = useState<ActionResult | null>(null);
  // Rows with a designation but no name, flagged when saving.
  const [missingName, setMissingName] = useState<Set<number>>(() => new Set());
  const [pending, startTransition] = useTransition();

  const save = () => {
    // Empty rows are left out of what's saved and disappear from the list once it is.
    const filled = rows.filter((r) => !isBlank(r));
    const unnamed = filled.filter((r) => !r.name.trim());
    setMissingName(new Set(unnamed.map((r) => r.key)));
    if (unnamed.length) {
      const which = unnamed.map((r) => rows.indexOf(r) + 1).join(", ");
      setResult({ ok: false, error: `Add a name to signatory ${which}, or remove ${unnamed.length === 1 ? "that row" : "those rows"}.` });
      return;
    }
    startTransition(async () => {
      const r = await saveSignatories(
        activityId,
        filled.map(({ name, designation }) => ({ name, designation })),
      );
      setResult(r);
      if (r.ok) {
        const saved = filled.map((row) => ({
          ...row,
          name: row.name.replace(/\s+/g, " ").trim(),
          designation: row.designation.replace(/\s+/g, " ").trim(),
        }));
        setRows(saved);
        setBaseline(listed(saved));
      }
    });
  };

  return (
    <SignatoryRows
      rows={rows}
      setRows={setRows}
      invalid={missingName}
      onNamed={(key) => setMissingName((set) => (set.has(key) ? new Set([...set].filter((k) => k !== key)) : set))}
      after={
        <>
          <button type="button" className={`btn ${changed ? "btn-primary" : "btn-quiet"}`} onClick={save} disabled={pending || !changed}>
            {pending ? "Saving…" : "Save signatories"}
          </button>
          <FormMessage state={result} />
        </>
      }
    />
  );
}

/** A signatory row while it's edited: `key` keeps each row's fields its own as rows come and go. */
export type SignatoryRow = { key: number; name: string; designation: string };

/** A draft's signatories as rows (anything unreadable left out). */
export const openSignatories = (data: unknown): SignatoryRow[] =>
  (Array.isArray(data) ? data : [])
    .filter((s): s is Signatory => typeof s?.name === "string" && typeof s?.designation === "string")
    .map((s, key) => ({ key, name: s.name, designation: s.designation }));

/** Rows as saved (or sent with a create form): the filled ones, without their keys. */
export const filledSignatories = (rows: SignatoryRow[]) => rows.filter((r) => !isBlank(r)).map(({ name, designation }) => ({ name, designation }));

/**
 * The signatories' rows: a full name and a designation each, added and removed here. Used by Settings (with its Save,
 * `after`) and by the create forms (sent with the form). `invalid`: rows flagged for a missing name.
 */
export function SignatoryRows({
  rows,
  setRows,
  invalid,
  onNamed,
  after,
}: {
  rows: SignatoryRow[];
  setRows: React.Dispatch<React.SetStateAction<SignatoryRow[]>>;
  invalid?: Set<number>;
  /** A flagged row was given a name. */
  onNamed?: (key: number) => void;
  /** Beside Add signatory: Settings' Save and its message. */
  after?: React.ReactNode;
}) {
  // Keys build on useId, so the server and the browser render the same ids.
  const fieldId = useId();
  const update = (key: number, patch: Partial<SignatoryRow>) => {
    setRows((list) => list.map((r) => (r.key === key ? { ...r, ...patch } : r)));
    if (patch.name?.trim()) onNamed?.(key);
  };
  const add = () => setRows((list) => [...list, { key: Math.max(-1, ...list.map((r) => r.key)) + 1, name: "", designation: "" }]);
  return (
    <div className="space-y-3">
      {rows.length === 0 && <p className="hint">No signatories yet.</p>}
      {rows.length > 0 && (
        // Column headings from sm up; on phones, where the two fields stack, each shows its own label.
        <div aria-hidden className="hidden max-w-3xl grid-cols-[minmax(0,1fr)_minmax(0,1fr)_6rem] gap-x-2 sm:grid">
          <span className="label mb-0">Full name</span>
          <span className="label mb-0">Designation</span>
        </div>
      )}
      <ol className="space-y-5 sm:space-y-2">
        {rows.map((r, i) => {
          const flagged = invalid?.has(r.key) ?? false;
          return (
            <li key={r.key} className="grid max-w-3xl grid-cols-[minmax(0,1fr)_auto] items-end gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_6rem] sm:items-center">
              <div className="col-start-1 row-start-1 min-w-0">
                <label htmlFor={`${fieldId}-${r.key}`} className="mb-1 block text-sm font-semibold sm:sr-only">
                  <span className="sr-only">Signatory {i + 1} </span>Full name
                </label>
                <input
                  id={`${fieldId}-${r.key}`}
                  value={r.name}
                  onChange={(e) => update(r.key, { name: e.target.value })}
                  maxLength={120}
                  aria-invalid={flagged || undefined}
                  className={`field ${flagged ? "border-danger ring-2 ring-danger/30" : ""}`}
                />
              </div>
              <div className="col-start-1 row-start-2 min-w-0 sm:col-start-2 sm:row-start-1">
                <label htmlFor={`${fieldId}-${r.key}-designation`} className="mb-1 block text-sm font-semibold sm:sr-only">
                  <span className="sr-only">Signatory {i + 1} </span>Designation
                </label>
                <input
                  id={`${fieldId}-${r.key}-designation`}
                  value={r.designation}
                  onChange={(e) => update(r.key, { designation: e.target.value })}
                  maxLength={120}
                  placeholder={["e.g. Chair, Board of Tabulators", "e.g. Member, Board of Tabulators", "e.g. Client representative"][i] ?? "e.g. Board member"}
                  className="field"
                />
              </div>
              <button
                type="button"
                className="btn btn-sm col-start-2 row-span-2 row-start-1 self-center justify-self-start text-danger hover:bg-danger/10 sm:col-start-3 sm:row-span-1"
                onClick={() => setRows((list) => list.filter((x) => x.key !== r.key))}
                aria-label={`Remove signatory ${i + 1}`}
              >
                Remove
              </button>
            </li>
          );
        })}
      </ol>
      <div className="flex flex-wrap items-center gap-3">
        <button type="button" className="btn btn-quiet btn-sm" onClick={add} disabled={rows.length >= MAX_SIGNATORIES}>
          Add signatory
        </button>
        {after}
      </div>
    </div>
  );
}
