"use client";

import { PhotoPicker } from "@/components/photo-picker";
import { fullName } from "@/lib/names";
import { PersonNameInput } from "../person-name-input";

export type DraftJudge = { key: number; first: string; last: string; photo: Blob | null; preview: string | null };

export const MAX_JUDGES = 20;
export const blankJudge = (key: number): DraftJudge => ({ key, first: "", last: "", photo: null, preview: null });

/**
 * The panel of judges on a create form: first and last name, an optional photo, and the chair. Submits
 * judge-<i>-first_name, judge-<i>-last_name and chair (the chair's position); photos go in separately.
 */
export function JudgesFields({
  judges,
  chairKey,
  onChange,
  onRemove,
  onChair,
  onAdd,
}: {
  judges: DraftJudge[];
  /** The chair's row key, or null before one is chosen. */
  chairKey: number | null;
  onChange: (key: number, patch: Partial<DraftJudge>) => void;
  /** Removes that judge's row, with whatever was typed in it, rather than always the last one. */
  onRemove: (key: number) => void;
  onChair: (key: number) => void;
  onAdd: () => void;
}) {
  return (
    <>
      {/*
        Column headings from sm up, on the same grid as the rows. Each field keeps its full label ("Judge 1
        first name") for screen readers and shows a short one on phones, where the fields stack.
      */}
      <div aria-hidden className="mb-1.5 hidden grid-cols-[3.5rem_minmax(0,1fr)_minmax(0,1fr)_6rem_2.75rem] gap-x-3 sm:grid">
        <span />
        <span className="label mb-0">First name</span>
        <span className="label mb-0">Last name</span>
      </div>
      <ol className="space-y-3">
        {judges.map((j, i) => (
          <li
            key={j.key}
            className="grid grid-cols-[3.5rem_minmax(0,1fr)] items-start gap-x-3 gap-y-2 sm:grid-cols-[3.5rem_minmax(0,1fr)_minmax(0,1fr)_6rem_2.75rem]"
          >
            <div className="row-span-3 self-start sm:row-span-1">
              <PhotoPicker
                name={fullName(j.first, j.last)}
                currentUrl={j.preview}
                size={56}
                onPick={(photo, preview) => onChange(j.key, { photo, preview })}
              />
            </div>
            <div className="min-w-0 sm:pt-1.5">
              <label htmlFor={`judge-${i}-first_name`} className="mb-1 block text-sm font-semibold sm:sr-only">
                <span className="sr-only">Judge {i + 1} </span>First name
              </label>
              <PersonNameInput
                id={`judge-${i}-first_name`}
                name={`judge-${i}-first_name`}
                part="first"
                required
                value={j.first}
                onValueChange={(first) => onChange(j.key, { first })}
              />
            </div>
            <div className="min-w-0 sm:pt-1.5">
              <label htmlFor={`judge-${i}-last_name`} className="mb-1 block text-sm font-semibold sm:sr-only">
                <span className="sr-only">Judge {i + 1} </span>Last name
              </label>
              <PersonNameInput
                id={`judge-${i}-last_name`}
                name={`judge-${i}-last_name`}
                part="last"
                required
                value={j.last}
                onValueChange={(last) => onChange(j.key, { last })}
              />
            </div>
            <div className="flex items-center gap-2 sm:contents">
              <label className="choice h-11 shrink-0 items-center gap-2 justify-self-start px-3 py-0 text-sm font-semibold sm:mt-1.5">
                <input type="radio" name="chair" value={i} required checked={chairKey === j.key} onChange={() => onChair(j.key)} />
                <span>
                  Chair<span className="sr-only"> of the board of judges: judge {i + 1}</span>
                </span>
              </label>
              <button
                type="button"
                className="btn btn-sm shrink-0 justify-self-start px-2.5 text-prussian/70 hover:bg-danger/10 hover:text-danger sm:mt-1.5 pointer-coarse:min-w-11"
                onClick={() => onRemove(j.key)}
                disabled={judges.length <= 1}
                aria-label={`Remove judge ${i + 1}`}
              >
                <svg viewBox="0 0 16 16" className="size-4" aria-hidden>
                  <path d="M4 4l8 8M12 4l-8 8" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
                </svg>
              </button>
            </div>
          </li>
        ))}
      </ol>
      <div className="mt-4 flex flex-wrap items-center gap-4">
        <button type="button" className="btn btn-quiet btn-sm" onClick={onAdd} disabled={judges.length >= MAX_JUDGES}>
          Add a judge
        </button>
        <p className="hint tabular" aria-live="polite">
          {judges.length} {judges.length === 1 ? "judge" : "judges"}
        </p>
      </div>
    </>
  );
}

