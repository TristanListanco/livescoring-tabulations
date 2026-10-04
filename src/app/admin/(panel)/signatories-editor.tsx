"use client";

import { useState, useTransition } from "react";
import type { ActionResult, Signatory } from "@/lib/types";
import { saveSignatories } from "../account-actions";

type Row = { key: number; name: string; designation: string };
let nextKey = 0;

/** Names and designations (Board of Tabulators, representatives) printed as signature lines on the results PDF. */
export function SignatoriesEditor({ adminId, initial }: { adminId: string | null; initial: Signatory[] }) {
  const [rows, setRows] = useState<Row[]>(() =>
    initial.length ? initial.map((s) => ({ key: nextKey++, ...s })) : [{ key: nextKey++, name: "", designation: "" }],
  );
  const [result, setResult] = useState<ActionResult | null>(null);
  const [pending, startTransition] = useTransition();
  const update = (key: number, patch: Partial<Row>) => setRows((list) => list.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  const save = () =>
    startTransition(async () => {
      setResult(await saveSignatories(adminId, rows.map(({ name, designation }) => ({ name, designation }))));
    });

  return (
    <div className="space-y-3">
      <ol className="space-y-2">
        {rows.map((r, i) => (
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
              className="field max-w-xs flex-1"
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
              onClick={() => setRows((list) => (list.length > 1 ? list.filter((x) => x.key !== r.key) : [{ key: nextKey++, name: "", designation: "" }]))}
              aria-label={`Remove signatory ${i + 1}`}
            >
              Remove
            </button>
          </li>
        ))}
      </ol>
      <div className="flex flex-wrap items-center gap-3">
        <button type="button" className="btn btn-quiet btn-sm" onClick={() => setRows((list) => [...list, { key: nextKey++, name: "", designation: "" }])} disabled={rows.length >= 12}>
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
