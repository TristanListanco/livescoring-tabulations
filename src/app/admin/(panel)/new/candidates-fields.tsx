"use client";

import { useRef } from "react";
import { PhotoPicker } from "@/components/photo-picker";
import { describedBy, FieldProblem, problemId, useFieldProblems } from "../field-errors";
import { moveButton, moveKeepingFocus } from "../move-focus";

export type DraftCandidate = { key: number; name: string; photo: Blob | null; preview: string | null };

export const MAX_CANDIDATES = 300;
export const blankCandidate = (key: number): DraftCandidate => ({ key, name: "", photo: null, preview: null });
const MAX_NAME = 120;

function Arrow({ up }: { up?: boolean }) {
  return (
    <svg viewBox="0 0 16 16" className={`size-4 ${up ? "" : "rotate-180"}`} aria-hidden>
      <path d="M8 3.5v9M4 7.5l4-4 4 4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/**
 * A pageant's candidates on the setup: in running order, each with a name and an optional photo for the LED wall.
 * Photos are square, as the wall shows them.
 */
export function CandidatesFields({
  candidates,
  onChange,
  onRemove,
  onMove,
  onAdd,
}: {
  candidates: DraftCandidate[];
  onChange: (key: number, patch: Partial<DraftCandidate>) => void;
  onRemove: (key: number) => void;
  onMove: (key: number, direction: -1 | 1) => void;
  /** Add a blank candidate at the end of the running order. */
  onAdd: () => void;
}) {
  const list = useRef<HTMLOListElement>(null);
  const problems = useFieldProblems();
  const full = candidates.length >= MAX_CANDIDATES;

  return (
    <div className="space-y-5">
      {candidates.length > 0 && (
        <ol ref={list} aria-label="Candidates" className="divide-y divide-line border-y border-line">
          {candidates.map((c, i) => {
            const label = c.name.trim() || `Candidate ${i + 1}`;
            return (
              <li
                key={c.key}
                // On phones the row's buttons go under the name, so the name keeps the width.
                className="grid grid-cols-[2.5rem_3rem_minmax(0,1fr)] items-center gap-x-3 gap-y-1 py-2.5 sm:grid-cols-[2.5rem_3rem_minmax(0,28rem)_auto]"
              >
                <span className="tabular text-right font-semibold text-prussian/75">
                  <span className="sr-only">No. </span>
                  {i + 1}
                </span>
                <PhotoPicker
                  name={c.name}
                  currentUrl={c.preview}
                  size={48}
                  square
                  pixels={480}
                  label={`Photo for ${label} (optional, shown on the LED wall)`}
                  onPick={(photo, preview) => onChange(c.key, { photo, preview })}
                />
                <div>
                  <label htmlFor={`candidate-${c.key}`} className="sr-only">
                    Candidate {i + 1} name
                  </label>
                  <input
                    id={`candidate-${c.key}`}
                    value={c.name}
                    maxLength={MAX_NAME}
                    onChange={(e) => onChange(c.key, { name: e.target.value })}
                    placeholder="Name"
                    aria-invalid={problems.has(`candidate-${c.key}`) || undefined}
                    aria-describedby={describedBy(problems.has(`candidate-${c.key}`) && problemId(`candidate-${c.key}`))}
                    className={`field ${problems.has(`candidate-${c.key}`) ? "border-danger" : ""}`}
                  />
                  <FieldProblem fieldId={`candidate-${c.key}`} />
                </div>
                <div className="col-start-3 flex items-center justify-end sm:col-start-auto sm:justify-start">
                  {c.photo && (
                    <button type="button" className="btn btn-sm text-prussian/80 hover:bg-wash" onClick={() => onChange(c.key, { photo: null, preview: null })}>
                      Remove photo<span className="sr-only"> of {label}</span>
                    </button>
                  )}
                  <button
                    type="button"
                    className="btn btn-sm px-2 text-prussian/75 hover:bg-wash pointer-coarse:min-w-11"
                    onClick={() => moveKeepingFocus(c.key, -1, () => onMove(c.key, -1))}
                    disabled={i === 0}
                    aria-label={`Move ${label} up`}
                    {...moveButton(c.key, -1)}
                  >
                    <Arrow up />
                  </button>
                  <button
                    type="button"
                    className="btn btn-sm px-2 text-prussian/75 hover:bg-wash pointer-coarse:min-w-11"
                    onClick={() => moveKeepingFocus(c.key, 1, () => onMove(c.key, 1))}
                    disabled={i === candidates.length - 1}
                    aria-label={`Move ${label} down`}
                    {...moveButton(c.key, 1)}
                  >
                    <Arrow />
                  </button>
                  <button
                    type="button"
                    className="btn btn-sm px-2 text-prussian/75 hover:bg-danger/10 hover:text-danger pointer-coarse:min-w-11"
                    onClick={() => onRemove(c.key)}
                    aria-label={`Remove ${label}`}
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
      )}

      <div className="flex flex-wrap items-center gap-4">
        <button
          id="add-candidate"
          type="button"
          className="btn btn-quiet btn-sm"
          aria-describedby={describedBy(problems.has("add-candidate") && problemId("add-candidate"))}
          onClick={() => {
            onAdd();
            // Straight to the new candidate's name.
            requestAnimationFrame(() => list.current?.querySelector<HTMLInputElement>("li:last-child input[id^=candidate-]")?.focus());
          }}
          disabled={full}
        >
          Add a candidate
        </button>
        <p className="hint tabular" aria-live="polite">
          {candidates.length} {candidates.length === 1 ? "candidate" : "candidates"}, in running order. Each keeps their number through every cut.
        </p>
        <FieldProblem fieldId="add-candidate" className="basis-full" />
      </div>
    </div>
  );
}
