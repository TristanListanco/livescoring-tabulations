"use client";

import { useState, useTransition } from "react";
import type { ActionResult, Signatory } from "@/lib/types";
import { saveSignatories } from "../account-actions";

type Row = { key: number; name: string; designation: string };
let nextKey = 0;
const blankRow = (): Row => ({ key: nextKey++, name: "", designation: "" });
const isBlank = (r: Row) => !r.name.trim() && !r.designation.trim();

/** Names and designations (Board of Tabulators, representatives) printed as signature lines on the results PDF. */
export function SignatoriesEditor({ adminId, initial }: { adminId: string | null; initial: Signatory[] }) {
  const [rows, setRows] = useState<Row[]>(() => initial.map((s) => ({ key: nextKey++, ...s })));
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
      {rows.length === 0 && <p className="hint">No signatories. The results PDF prints without signature lines for them.</p>}
      <ol className="space-y-2">
        {rows.map((r, i) => {
          const invalid = missingName.has(r.key);
          return (
            <li key={r.key} className="flex flex-wrap items-center gap-2">
              <label htmlFor={`signatory-${r.key}`} className="sr-only">
                Signatory {i + 1} full name
              </label>
              <input
                id={`signatory-${r.key}`}
                value={r.name}
                onChange={(e) => update(r.key, { name: e.target.value })}
                maxLength={120}
                placeholder="Full name"
                aria-invalid={invalid || undefined}
                className={`field max-w-xs flex-1 ${invalid ? "border-danger ring-2 ring-danger/30" : ""}`}
              />
              <label htmlFor={`signatory-${r.key}-designation`} className="sr-only">
                Signatory {i + 1} designation
              </label>
              <input
                id={`signatory-${r.key}-designation`}
                value={r.designation}
                onChange={(e) => update(r.key, { designation: e.target.value })}
                maxLength={120}
                placeholder={["Chair, Board of Tabulators", "Member, Board of Tabulators", "Student representative"][i] ?? "Designation"}
                className="field max-w-xs flex-1"
              />
              <button
                type="button"
                className="btn btn-sm text-danger hover:bg-danger/10"
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
        {result && (
          <p role={result.ok ? "status" : "alert"} className={result.ok ? "text-regal" : "font-semibold text-danger"}>
            {result.ok ? result.message : result.error}
          </p>
        )}
      </div>
    </div>
  );
}
