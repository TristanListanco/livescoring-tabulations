"use client";

import { useId, useRef, useState, useTransition } from "react";
import type { ActionResult, Signatory } from "@/lib/types";
import { saveSignatories } from "../account-actions";
import { FormMessage } from "./form-message";

type Row = { key: number; name: string; designation: string };
const isBlank = (r: Row) => !r.name.trim() && !r.designation.trim();

/** Names and designations (Board of Tabulators, representatives) printed as signature lines on the results PDF. */
export function SignatoriesEditor({ adminId, initial }: { adminId: string | null; initial: Signatory[] }) {
  // Keys count up within this editor, and ids build on useId, so the server and the browser render the same ids.
  const fieldId = useId();
  const nextKey = useRef(initial.length);
  const blankRow = (): Row => ({ key: nextKey.current++, name: "", designation: "" });
  const [rows, setRows] = useState<Row[]>(() => initial.map((s, i) => ({ key: i, ...s })));
  const [result, setResult] = useState<ActionResult | null>(null);
  // Rows with a designation but no name, flagged when saving.
  const [missingName, setMissingName] = useState<Set<number>>(() => new Set());
  const [pending, startTransition] = useTransition();
  const update = (key: number, patch: Partial<Row>) => {
    setRows((list) => list.map((r) => (r.key === key ? { ...r, ...patch } : r)));
    if (patch.name?.trim()) setMissingName((set) => (set.has(key) ? new Set([...set].filter((k) => k !== key)) : set));
  };

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
        adminId,
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
      }
    });
  };

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
          const invalid = missingName.has(r.key);
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
                  aria-invalid={invalid || undefined}
                  className={`field ${invalid ? "border-danger ring-2 ring-danger/30" : ""}`}
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
        <button type="button" className="btn btn-quiet btn-sm" onClick={() => setRows((list) => [...list, blankRow()])} disabled={rows.length >= 12}>
          Add signatory
        </button>
        <button type="button" className="btn btn-primary" onClick={save} disabled={pending}>
          {pending ? "Saving…" : "Save signatories"}
        </button>
        <FormMessage state={result} />
      </div>
    </div>
  );
}
