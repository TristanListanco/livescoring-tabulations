"use client";

import { useId, useRef, type ClipboardEvent } from "react";
import { flushSync } from "react-dom";
import { MAX_DETAIL } from "@/lib/entry-details";
import { describedBy, FieldProblem, problemId, useFieldProblems } from "./field-errors";
import { enterToNext, NEXT_LINE } from "./list-keys";

/** An entry being added: its name, and one line of details about it (a school, a division), both as typed. */
export type EntryRow = { key: number; name: string; details: string };

/** The most entries an activity takes (the server says the same). */
export const MAX_ENTRY_ROWS = 300;

export const blankEntry = (key: number): EntryRow => ({ key, name: "", details: "" });

/** The rows with a name, in order. */
export const namedEntries = (rows: EntryRow[]) => rows.filter((r) => r.name.trim());

/**
 * What the server reads: each named entry on its line, its details after a "|" (so a "|" typed in them becomes "/").
 * With no details anywhere, just the names.
 */
export function entryLines(rows: EntryRow[]): string {
  const named = namedEntries(rows);
  const details = named.some((r) => r.details.trim());
  return named.map((r) => (details ? `${r.name.trim()} | ${r.details.replaceAll("|", "/").trim()}` : r.name.trim())).join("\n");
}

/**
 * Lines pasted into a name (a list, or rows from a spreadsheet): a row each, the first column the name and the rest
 * its details. Null for a single line, which pastes as usual.
 */
export function pastedRows(text: string): { name: string; details: string }[] | null {
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  if (lines.length < 2 && !/[\t|]/.test(text)) return null;
  return lines.map((line) => {
    const [name, ...rest] = line.split(/\t|\|/);
    return { name: name.trim(), details: rest.map((v) => v.trim()).filter(Boolean).join(", ") };
  });
}

/**
 * A list of entries, added one at a time: each a name, and under it one optional line of details. Enter goes from a
 * name to its details to the next entry's name, adding an entry once the last is named, as a list is typed out. A list
 * pasted into a name (or rows copied from a spreadsheet) becomes a row each. `problemField`: the id a form problem
 * points at (the first name field). `detailsLabel`: what the details are called ("Details", or an older activity's
 * first named field).
 */
export function EntryRows({
  rows,
  setRows,
  noun = "entry",
  detailsLabel = "Details",
  withDetails = true,
  problemField,
  label,
  footer,
}: {
  /** At the end of the add row (the Entries tab's Add entries button): on the same line from md up, under it on phones. */
  footer?: React.ReactNode;
  /** What each row is called to screen readers ("Entry 1 name"): "New entry" beside entries already listed. */
  label?: string;
  rows: EntryRow[];
  setRows: React.Dispatch<React.SetStateAction<EntryRow[]>>;
  noun?: "entry" | "candidate";
  detailsLabel?: string;
  withDetails?: boolean;
  problemField?: string;
}) {
  const prefix = useId();
  const list = useRef<HTMLOListElement>(null);
  const problems = useFieldProblems();
  const nextKey = () => Math.max(-1, ...rows.map((r) => r.key)) + 1;
  const update = (key: number, patch: Partial<EntryRow>) => setRows((all) => all.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  const add = () => setRows((all) => (all.length < MAX_ENTRY_ROWS ? [...all, blankEntry(Math.max(-1, ...all.map((r) => r.key)) + 1)] : all));
  const remove = (key: number) => setRows((all) => (all.length > 1 ? all.filter((r) => r.key !== key) : [blankEntry(nextKey())]));
  // At the last field: a new entry once this one has a name, and the cursor in its name.
  const addAfterLast = () => {
    if (!rows.at(-1)?.name.trim() || rows.length >= MAX_ENTRY_ROWS) return;
    flushSync(add);
    list.current?.querySelector<HTMLInputElement>("li:last-child input[data-entry-name]")?.focus();
  };
  const paste = (key: number, e: ClipboardEvent<HTMLInputElement>) => {
    const pasted = pastedRows(e.clipboardData.getData("text"));
    if (!pasted) return;
    e.preventDefault();
    setRows((all) => {
      const at = all.findIndex((r) => r.key === key);
      let next = Math.max(-1, ...all.map((r) => r.key)) + 1;
      const made = pasted.map((p, i) => (i === 0 ? { ...all[at], name: p.name, details: p.details || all[at].details } : { key: next++, ...p }));
      return [...all.slice(0, at), ...made, ...all.slice(at + 1)].slice(0, MAX_ENTRY_ROWS);
    });
  };
  const count = namedEntries(rows).length;
  const plural = noun === "entry" ? "entries" : "candidates";
  const problem = problemField ? problems.has(problemField) : false;
  const called = label ?? (noun === "entry" ? "Entry" : "Candidate");

  return (
    <div className="max-w-2xl">
      <ol ref={list} className="divide-y divide-line border-y border-line">
        {rows.map((r, i) => {
          const name = r.name.trim() || `${noun} ${i + 1}`;
          const nameId = i === 0 && problemField ? problemField : `${prefix}-${r.key}`;
          return (
            <li key={r.key} className="grid grid-cols-[1.75rem_minmax(0,1fr)_auto] items-start gap-x-3 gap-y-2 py-3">
              <span aria-hidden className="tabular pt-3 text-right text-sm text-prussian/60">
                {i + 1}
              </span>
              <div className="min-w-0 space-y-2">
                <label htmlFor={nameId} className="sr-only">
                  {called} {i + 1} name
                </label>
                <input
                  id={nameId}
                  value={r.name}
                  onChange={(e) => update(r.key, { name: e.target.value })}
                  onPaste={(e) => paste(r.key, e)}
                  {...NEXT_LINE}
                  data-entry-name=""
                  onKeyDown={(e) => enterToNext(e, list.current, addAfterLast)}
                  maxLength={120}
                  placeholder={i === 0 ? (noun === "entry" ? "e.g. Team Agila" : "e.g. Maria Santos") : `${noun === "entry" ? "Entry" : "Candidate"} name`}
                  aria-invalid={(i === 0 && problem) || undefined}
                  aria-describedby={describedBy(i === 0 && problem && problemField && problemId(problemField))}
                  className={`field font-semibold ${i === 0 && problem ? "border-danger ring-2 ring-danger/30" : ""}`}
                />
                {withDetails && (
                  <>
                    <label htmlFor={`${prefix}-${r.key}-details`} className="sr-only">
                      {detailsLabel} for {name}
                    </label>
                    <input
                      id={`${prefix}-${r.key}-details`}
                      value={r.details}
                      onChange={(e) => update(r.key, { details: e.target.value })}
                      {...NEXT_LINE}
                      onKeyDown={(e) => enterToNext(e, list.current, addAfterLast)}
                      maxLength={MAX_DETAIL}
                      placeholder={`${detailsLabel} (optional), e.g. Grade 10, St. Mary's`}
                      className="field h-10 text-sm"
                    />
                  </>
                )}
              </div>
              {/* The last one left is cleared rather than removed: there's always a row to type into. */}
              <button
                type="button"
                onClick={() => remove(r.key)}
                aria-label={`Remove ${name}`}
                className="btn btn-sm mt-1 px-2.5 text-prussian/70 hover:bg-danger/10 hover:text-danger pointer-coarse:min-w-11"
              >
                <svg viewBox="0 0 16 16" className="size-4" aria-hidden>
                  <path d="M4 4l8 8M12 4l-8 8" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
                </svg>
              </button>
            </li>
          );
        })}
      </ol>
      {problemField && <FieldProblem fieldId={problemField} className="mt-3" />}
      <div className="mt-4 flex flex-wrap items-center gap-4">
        <button type="button" className="btn btn-quiet btn-sm" onClick={add} disabled={rows.length >= MAX_ENTRY_ROWS}>
          Add {noun === "entry" ? "an entry" : "a candidate"}
        </button>
        <p className="hint tabular" aria-live="polite">
          {count} {count === 1 ? noun : plural}
        </p>
        {footer && <div className="flex w-full items-center gap-3 md:ml-auto md:w-auto">{footer}</div>}
      </div>
    </div>
  );
}
