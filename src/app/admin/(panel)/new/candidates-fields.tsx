"use client";

import { useRef, useState } from "react";
import { flushSync } from "react-dom";
import { PhotoPicker } from "@/components/photo-picker";
import { namesFromPaste } from "@/lib/names";
import { describedBy, FieldProblem, problemId, useFieldProblems } from "../field-errors";
import { enterToNext, NEXT_LINE, roveToolbar } from "../list-keys";
import { moveButton, moveKeepingFocus } from "../move-focus";

export type DraftCandidate = { key: number; name: string; photo: Blob | null; preview: string | null };

export const MAX_CANDIDATES = 300;
export const blankCandidate = (key: number): DraftCandidate => ({ key, name: "", photo: null, preview: null });
export const MAX_CANDIDATE_NAME = 120;

/** What a pasted list did: how many names went in, how many didn't fit, and the row the last one landed in. */
export type PasteResult = { placed: number; dropped: number; lastKey: number };

function Arrow({ up }: { up?: boolean }) {
  return (
    <svg viewBox="0 0 16 16" className={`size-4 ${up ? "" : "rotate-180"}`} aria-hidden>
      <path d="M8 3.5v9M4 7.5l4-4 4 4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/**
 * A pageant's candidates on the setup: in running order, each with a name and an optional photo for the LED wall.
 * Photos are square, as the wall shows them. Made for copying a score sheet: a list pasted into any name fills that
 * row and the ones after it, Enter goes to the next name (adding a row at the end), and each row's move and remove
 * buttons are a single stop in the Tab order.
 */
export function CandidatesFields({
  candidates,
  onChange,
  onRemove,
  onMove,
  onAdd,
  onPasteNames,
}: {
  candidates: DraftCandidate[];
  onChange: (key: number, patch: Partial<DraftCandidate>) => void;
  onRemove: (key: number) => void;
  onMove: (key: number, direction: -1 | 1) => void;
  /** Add a blank candidate at the end of the running order. */
  onAdd: () => void;
  /** Names pasted as a list into this candidate's name: it takes the first, and the rest go in the rows after it. */
  onPasteNames: (key: number, names: string[]) => PasteResult;
}) {
  const list = useRef<HTMLOListElement>(null);
  const problems = useFieldProblems();
  const full = candidates.length >= MAX_CANDIDATES;
  // What the last pasted list did, until the list is changed some other way.
  const [pasted, setPasted] = useState<string | null>(null);
  /** Make a change at once, then put focus on a row's name (the last row's, for "last"), so it never drops in between. */
  const thenFocus = (change: () => void, key: number | "last") => {
    flushSync(change);
    (key === "last" ? list.current?.querySelector<HTMLInputElement>("li:last-child input[id^=candidate-]") : document.getElementById(`candidate-${key}`))?.focus();
  };
  // Enter at the last name adds the next row, once the last one has a name.
  const addAfterLast = () => {
    if (full || !candidates.at(-1)?.name.trim()) return;
    thenFocus(onAdd, "last");
  };

  return (
    <div className="space-y-5">
      {candidates.length > 0 && (
        <ol ref={list} aria-label="Candidates" className="divide-y divide-line border-y border-line">
          {candidates.map((c, i) => {
            const label = c.name.trim() || `Candidate ${i + 1}`;
            return (
              <li
                key={c.key}
                // On phones the row's buttons go under the name, so the name keeps the width. From sm up they sit in a
                // column wide enough for "Remove photo" too, right-aligned, so every row's arrows line up.
                className="grid grid-cols-[2.5rem_3rem_minmax(0,1fr)] items-center gap-x-3 gap-y-1 py-2.5 sm:grid-cols-[2.5rem_3rem_minmax(0,28rem)_14rem] sm:pointer-coarse:grid-cols-[2.5rem_3rem_minmax(0,28rem)_17rem]"
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
                    {...NEXT_LINE}
                    value={c.name}
                    maxLength={MAX_CANDIDATE_NAME}
                    onChange={(e) => {
                      setPasted(null);
                      onChange(c.key, { name: e.target.value });
                    }}
                    onKeyDown={(e) => enterToNext(e, list.current, addAfterLast)}
                    onPaste={(e) => {
                      const names = namesFromPaste(e.clipboardData.getData("text"), MAX_CANDIDATE_NAME);
                      // One line pastes as usual; a list fills the rows from here.
                      if (names.length < 2) return;
                      e.preventDefault();
                      let result: PasteResult = { placed: 0, dropped: 0, lastKey: c.key };
                      flushSync(() => {
                        result = onPasteNames(c.key, names);
                        setPasted(
                          `Pasted ${result.placed} names${result.dropped ? `. ${result.dropped} more didn't fit: a pageant can have up to ${MAX_CANDIDATES} candidates` : ""}.`,
                        );
                      });
                      // On to the last name pasted, ready for the next.
                      document.getElementById(`candidate-${result.lastKey}`)?.focus();
                    }}
                    placeholder="Name"
                    aria-invalid={problems.has(`candidate-${c.key}`) || undefined}
                    aria-describedby={describedBy(problems.has(`candidate-${c.key}`) && problemId(`candidate-${c.key}`))}
                    className={`field ${problems.has(`candidate-${c.key}`) ? "border-danger" : ""}`}
                  />
                  <FieldProblem fieldId={`candidate-${c.key}`} />
                </div>
                <div className="col-start-3 flex items-center justify-end sm:col-start-auto">
                  {c.photo && (
                    <button type="button" className="btn btn-sm text-prussian/80 hover:bg-wash" onClick={() => onChange(c.key, { photo: null, preview: null })}>
                      Remove photo<span className="sr-only"> of {label}</span>
                    </button>
                  )}
                  {/* One Tab stop for the three, so Tab goes from name to name; the arrow keys move between them. */}
                  <div role="toolbar" aria-label={`Move or remove ${label}`} className="flex items-center" onKeyDown={roveToolbar}>
                    <button
                      type="button"
                      className="btn btn-sm px-2 text-prussian/75 hover:bg-wash pointer-coarse:min-w-11"
                      onClick={() => moveKeepingFocus(c.key, -1, () => onMove(c.key, -1))}
                      disabled={i === 0}
                      tabIndex={i === 0 ? -1 : 0}
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
                      // The first button that can be used is the toolbar's Tab stop.
                      tabIndex={i === 0 && i !== candidates.length - 1 ? 0 : -1}
                      aria-label={`Move ${label} down`}
                      {...moveButton(c.key, 1)}
                    >
                      <Arrow />
                    </button>
                    {/* Apart from the arrows, so a tap meant for moving doesn't remove. */}
                    <span aria-hidden className="mx-1.5 h-5 w-px bg-line" />
                    <button
                      type="button"
                      className="btn btn-sm px-2 text-prussian/75 hover:bg-danger/10 hover:text-danger pointer-coarse:min-w-11"
                      onClick={() => {
                        setPasted(null);
                        onRemove(c.key);
                      }}
                      tabIndex={candidates.length === 1 ? 0 : -1}
                      aria-label={`Remove ${label}`}
                    >
                      <svg viewBox="0 0 16 16" className="size-4" aria-hidden>
                        <path d="M4 4l8 8M12 4l-8 8" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
                      </svg>
                    </button>
                  </div>
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
            setPasted(null);
            // Straight to the new candidate's name.
            thenFocus(onAdd, "last");
          }}
          disabled={full}
        >
          Add a candidate
        </button>
        <p className="hint tabular" aria-live="polite">
          {pasted && <span className="font-semibold text-regal">{pasted} </span>}
          {candidates.length} {candidates.length === 1 ? "candidate" : "candidates"}, in running order. Each keeps their number through every cut.
        </p>
        <FieldProblem fieldId="add-candidate" className="basis-full" />
      </div>
    </div>
  );
}
