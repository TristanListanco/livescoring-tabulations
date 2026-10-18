"use client";

import { useRef } from "react";
import { flushSync } from "react-dom";
import { PhotoPicker } from "@/components/photo-picker";
import { fullName } from "@/lib/names";
import type { JudgePanel } from "@/lib/types";
import { describedBy, FieldProblem, problemId, useFieldProblems } from "../field-errors";
import { enterToNext, NEXT_LINE } from "../list-keys";
import { PersonNameInput } from "../person-name-input";

/** panel: pageants only, which segments the judge judges. */
export type DraftJudge = { key: number; first: string; last: string; photo: Blob | null; preview: string | null; panel: JudgePanel };

export const MAX_JUDGES = 20;
export const blankJudge = (key: number, panel: JudgePanel = "all"): DraftJudge => ({ key, first: "", last: "", photo: null, preview: null, panel });

export const PANEL_OPTIONS: { value: JudgePanel; label: string }[] = [
  { value: "all", label: "Both segments" },
  { value: "preliminary", label: "Preliminary only" },
  { value: "proper", label: "Pageant proper only" },
];

/**
 * A board of judges on a create form: first and last name, an optional photo, and the chair. Submits
 * judge-<i>-first_name, judge-<i>-last_name and (in the radio group `chairGroup`) the chair's position; photos go
 * in separately. A pageant with separate boards has one of these per board, numbered on from `start`.
 */
export function JudgesFields({
  judges,
  chairKey,
  onChange,
  onRemove,
  onChair,
  onAdd,
  start = 0,
  who = "Judge",
  chairOf = "the board of judges",
  chairGroup = "chair",
  addTo,
  addId = "add-judge",
  full = judges.length >= MAX_JUDGES,
}: {
  judges: DraftJudge[];
  /** Position of this board's first judge among all the activity's judges, for the field names. */
  start?: number;
  /** What screen readers call each judge, e.g. "Preliminary judge" for "Preliminary judge 1 first name". */
  who?: string;
  /** Whose chair the radio picks, e.g. "the preliminary board". */
  chairOf?: string;
  /** The chair radio group's name, one per board. */
  chairGroup?: string;
  /** Which board "Add a judge" adds to, for screen readers, e.g. "the preliminary board". */
  addTo?: string;
  /** The id of this board's "Add a judge" button, so a problem (too few judges) can point at it. */
  addId?: string;
  /** No more judges can be added: the activity has as many as it can. */
  full?: boolean;
  /** The chair's row key, or null before one is chosen. */
  chairKey: number | null;
  onChange: (key: number, patch: Partial<DraftJudge>) => void;
  /** Removes that judge's row, with whatever was typed in it, rather than always the last one. */
  onRemove: (key: number) => void;
  onChair: (key: number) => void;
  onAdd: () => void;
}) {
  const columns = "sm:grid-cols-[3.5rem_minmax(0,1fr)_minmax(0,1fr)_6rem_2.75rem]";
  const problems = useFieldProblems();
  const list = useRef<HTMLOListElement>(null);
  // Enter goes from first name to last name to the next judge's; at the last, it adds a judge once that one is named.
  const last = judges.at(-1);
  const addAfterLast = () => {
    if (full || !last?.first.trim() || !last.last.trim()) return;
    // At once, so focus goes straight to the new judge's first name.
    flushSync(onAdd);
    list.current?.querySelector<HTMLInputElement>("li:last-child input[data-next-line]")?.focus();
  };
  // A missing chair points at the board's first Chair radio.
  const chairField = `judge-${start}-chair`;
  return (
    <>
      {/*
        Column headings from sm up, on the same grid as the rows. Each field keeps its full label ("Judge 1
        first name") for screen readers and shows a short one on phones, where the fields stack.
      */}
      <div aria-hidden className={`mb-1.5 hidden gap-x-3 sm:grid ${columns}`}>
        <span />
        <span className="label mb-0">First name</span>
        <span className="label mb-0">Last name</span>
      </div>
      <ol ref={list} className="divide-y divide-line border-y border-line">
        {judges.map((j, i) => {
          const at = start + i;
          return (
            <li key={j.key} className={`grid grid-cols-[3.5rem_minmax(0,1fr)] items-start gap-x-3 gap-y-2 py-3 ${columns}`}>
              <div className="row-span-3 self-start sm:row-span-1">
                <PhotoPicker
                  name={fullName(j.first, j.last)}
                  currentUrl={j.preview}
                  size={56}
                  onPick={(photo, preview) => onChange(j.key, { photo, preview })}
                />
              </div>
              <div className="min-w-0 sm:pt-1.5">
                <label htmlFor={`judge-${at}-first_name`} className="mb-1 block text-sm font-semibold sm:sr-only">
                  <span className="sr-only">
                    {who} {i + 1}{" "}
                  </span>
                  First name
                </label>
                <PersonNameInput
                  id={`judge-${at}-first_name`}
                  name={`judge-${at}-first_name`}
                  part="first"
                  required
                  {...NEXT_LINE}
                  onKeyDown={(e) => enterToNext(e, list.current, addAfterLast)}
                  value={j.first}
                  onValueChange={(first) => onChange(j.key, { first })}
                />
              </div>
              <div className="min-w-0 sm:pt-1.5">
                <label htmlFor={`judge-${at}-last_name`} className="mb-1 block text-sm font-semibold sm:sr-only">
                  <span className="sr-only">
                    {who} {i + 1}{" "}
                  </span>
                  Last name
                </label>
                <PersonNameInput
                  id={`judge-${at}-last_name`}
                  name={`judge-${at}-last_name`}
                  part="last"
                  required
                  {...NEXT_LINE}
                  onKeyDown={(e) => enterToNext(e, list.current, addAfterLast)}
                  value={j.last}
                  onValueChange={(last) => onChange(j.key, { last })}
                />
              </div>
              <div className="flex items-center gap-2 sm:contents">
                <label className="choice h-11 shrink-0 items-center gap-2 justify-self-start px-3 py-0 text-sm font-semibold sm:mt-1.5">
                  <input
                    id={`judge-${at}-chair`}
                    type="radio"
                    name={chairGroup}
                    value={at}
                    required
                    checked={chairKey === j.key}
                    onChange={() => onChair(j.key)}
                    aria-describedby={describedBy(problems.has(chairField) && problemId(chairField))}
                  />
                  <span>
                    Chair
                    <span className="sr-only">
                      {" "}
                      of {chairOf}: judge {i + 1}
                    </span>
                  </span>
                </label>
                {/* With one judge left there's nothing to remove: the button gives way, keeping its place, rather than fading out. */}
                <button
                  type="button"
                  className={`btn btn-sm shrink-0 justify-self-start px-2.5 text-prussian/70 hover:bg-danger/10 hover:text-danger sm:mt-1.5 pointer-coarse:min-w-11 ${
                    judges.length <= 1 ? "invisible" : ""
                  }`}
                  onClick={() => onRemove(j.key)}
                  disabled={judges.length <= 1}
                  aria-label={`Remove ${who.toLowerCase()} ${i + 1}`}
                >
                  <svg viewBox="0 0 16 16" className="size-4" aria-hidden>
                    <path d="M4 4l8 8M12 4l-8 8" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
                  </svg>
                </button>
              </div>
            </li>
          );
        })}
      </ol>
      <FieldProblem fieldId={chairField} className="mt-3" />
      <div className="mt-4 flex flex-wrap items-center gap-4">
        <button
          id={addId}
          type="button"
          className="btn btn-quiet btn-sm"
          onClick={onAdd}
          disabled={full}
          aria-describedby={describedBy(problems.has(addId) && problemId(addId))}
        >
          Add a judge{addTo && <span className="sr-only"> to {addTo}</span>}
        </button>
        <p className="hint tabular" aria-live="polite">
          {judges.length} {judges.length === 1 ? "judge" : "judges"}
        </p>
        <FieldProblem fieldId={addId} className="basis-full" />
      </div>
    </>
  );
}
