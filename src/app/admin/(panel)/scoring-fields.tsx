"use client";

import { useState } from "react";
import type { CriterionDraft, ScoringDraft } from "@/lib/pageant-setup";
import type { CriteriaDisplay, Decimals, ResultDecimals } from "@/lib/types";

const DECIMAL_OPTIONS: { value: Decimals; label: string; example: string }[] = [
  { value: 0, label: "Whole numbers", example: "9" },
  { value: 1, label: "1 decimal place", example: "9.5" },
  { value: 2, label: "2 decimal places", example: "9.75" },
];

const DEFAULT_RESULT_DECIMALS: ResultDecimals = 2;
const RESULT_DECIMAL_OPTIONS: ResultDecimals[] = [0, 1, 2, 3, 4];

/** How many decimal places averages and totals show. The same cards as the judges' decimals, with a rounded example. */
export function ResultDecimalsField() {
  const [value, setValue] = useState<ResultDecimals>(DEFAULT_RESULT_DECIMALS);
  return (
    <fieldset>
      <legend className="label">Decimal places shown in results</legend>
      <div className="flex flex-wrap gap-2">
        {RESULT_DECIMAL_OPTIONS.map((n) => (
          <label key={n} className="choice items-center">
            <input type="radio" name="result_decimals" value={n} checked={value === n} onChange={() => setValue(n)} />
            <span className="font-semibold">{n === 0 ? "Whole numbers" : `${n} decimal place${n > 1 ? "s" : ""}`}</span>
            <span className="tabular text-sm opacity-75">e.g. {(87.4567).toFixed(n)}</span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

const blankCriteria = (from: number): CriterionDraft[] => [0, 1, 2].map((i) => ({ key: from + i, id: "", name: "", max: "" }));

/** Criteria rows as the create form sends them: blank rows dropped. */
export const criteriaJson = (criteria: CriterionDraft[]) =>
  JSON.stringify(criteria.filter((r) => r.name.trim() || r.max).map((r) => ({ id: r.id, name: r.name.trim(), max: Number(r.max) })));

/**
 * How judges score: simple (one score from min to max) or criteria (points per criterion, adding up to 100).
 * Controlled, so an event's form and each pageant sub-activity share it. `idPrefix` keeps ids and radio groups
 * apart when several are on one page; `formNames` names the fields the event form submits (min, max, decimals).
 */
export function ScoringEditor({
  value,
  onChange,
  idPrefix = "",
  formNames = false,
  label,
}: {
  value: ScoringDraft;
  onChange: (next: ScoringDraft) => void;
  idPrefix?: string;
  formNames?: boolean;
  /** What screen readers call this scoring, e.g. "Swimsuit", when several are on one page. */
  label?: string;
}) {
  const { mode, decimals: places, criteria: rows, display } = value;
  const set = (patch: Partial<ScoringDraft>) => onChange({ ...value, ...patch });
  const step = places === 0 ? 1 : places === 1 ? 0.1 : 0.01;
  const nextKey = rows.reduce((max, r) => Math.max(max, r.key), -1) + 1;
  const total = rows.reduce((sum, r) => sum + (Number(r.max) || 0), 0);
  // No verdict on the total until some points have been typed.
  const started = rows.some((r) => r.max !== "");
  const update = (key: number, patch: Partial<CriterionDraft>) => set({ criteria: rows.map((r) => (r.key === key ? { ...r, ...patch } : r)) });
  // With several on a page, screen readers hear whose field it is first: "Swimsuit: Min score".
  const whose = label ? <span className="sr-only">{label}: </span> : null;
  const prefix = label ? `${label}: ` : "";

  return (
    <div className="space-y-6">
      <fieldset>
        <legend className="label">
          {whose}Method
        </legend>
        <div className="grid gap-2 sm:grid-cols-2">
          {(
            [
              { value: "simple", label: "Simple", hint: "One score per judge, from a minimum to a maximum." },
              { value: "criteria", label: "Criteria", hint: "Judges score each criterion. The criteria add up to 100 points." },
            ] as const
          ).map((o) => (
            <label key={o.value} className="choice">
              <input
                type="radio"
                name={`${idPrefix}scoring-mode-choice`}
                className="mt-1"
                checked={mode === o.value}
                onChange={() => set({ mode: o.value, criteria: o.value === "criteria" && rows.length === 0 ? blankCriteria(0) : rows })}
              />
              <span>
                <span className="block font-semibold">{o.label}</span>
                <span className="block text-sm opacity-80">{o.hint}</span>
              </span>
            </label>
          ))}
        </div>
      </fieldset>

      {mode === "simple" ? (
        <div className="flex flex-wrap gap-4">
          <div className="w-36">
            <label htmlFor={`${idPrefix}min`} className="label">
              {whose}Min score
            </label>
            <input
              id={`${idPrefix}min`}
              name={formNames ? "min" : undefined}
              type="number"
              inputMode="decimal"
              required
              min={0}
              max={9999}
              step={step}
              value={value.min}
              onChange={(e) => set({ min: e.target.value })}
              className="field tabular"
            />
          </div>
          <div className="w-36">
            <label htmlFor={`${idPrefix}max`} className="label">
              {whose}Max score
            </label>
            <input
              id={`${idPrefix}max`}
              name={formNames ? "max" : undefined}
              type="number"
              inputMode="decimal"
              required
              min={0}
              max={9999}
              step={step}
              value={value.max}
              onChange={(e) => set({ max: e.target.value })}
              className="field tabular"
            />
          </div>
        </div>
      ) : (
        <fieldset>
          {/* On phones the legend names the list and each number has its "points" unit; from sm up, column headings do. */}
          <legend className="label sm:sr-only">
            {whose}Criteria and their max points
          </legend>
          <div aria-hidden className="mb-1.5 hidden grid-cols-[minmax(0,20rem)_5rem_auto] gap-x-2 sm:grid">
            <span className="label mb-0">Criterion</span>
            <span className="label mb-0">Max points</span>
          </div>
          <ol className="space-y-2">
            {rows.map((r, i) => (
              <li key={r.key} className="flex flex-wrap items-center gap-2 sm:grid sm:grid-cols-[minmax(0,20rem)_5rem_auto]">
                <label htmlFor={`${idPrefix}criterion-${r.key}`} className="sr-only">
                  {prefix}Criterion {i + 1} name
                </label>
                <input
                  id={`${idPrefix}criterion-${r.key}`}
                  value={r.name}
                  onChange={(e) => update(r.key, { name: e.target.value })}
                  maxLength={60}
                  placeholder={["e.g. Innovativeness", "e.g. Design", "e.g. Impact"][i] ?? `Criterion ${i + 1}`}
                  className="field max-w-xs flex-1 sm:max-w-none"
                />
                <label htmlFor={`${idPrefix}criterion-${r.key}-max`} className="sr-only">
                  {prefix}Criterion {i + 1} max points
                </label>
                <input
                  id={`${idPrefix}criterion-${r.key}-max`}
                  value={r.max}
                  onChange={(e) => update(r.key, { max: e.target.value.replace(/[^0-9]/g, "").slice(0, 3) })}
                  inputMode="numeric"
                  className="field tabular w-20"
                />
                <span className="hint sm:hidden">points</span>
                {rows.length > 1 && (
                  <button
                    type="button"
                    className="btn btn-sm justify-self-start text-danger hover:bg-danger/10"
                    onClick={() => set({ criteria: rows.filter((x) => x.key !== r.key) })}
                    aria-label={`${prefix}Remove criterion ${i + 1}`}
                  >
                    Remove
                  </button>
                )}
              </li>
            ))}
          </ol>
          <div className="mt-3 flex flex-wrap items-center gap-4">
            <button
              type="button"
              className="btn btn-quiet btn-sm"
              onClick={() => set({ criteria: [...rows, { key: nextKey, id: "", name: "", max: "" }] })}
              disabled={rows.length >= 20}
            >
              Add criterion
            </button>
            <p role="status" className={`tabular text-sm font-semibold ${total === 100 ? "text-regal" : started ? "text-danger" : "text-prussian/70"}`}>
              Total {total} of 100 points{total === 100 || !started ? "" : ". The criteria must add up to 100."}
            </p>
          </div>
        </fieldset>
      )}

      <fieldset>
        <legend className="label">
          {whose}
          {mode === "criteria" ? "Judges give points in" : "Judges score with"}
        </legend>
        <div className="flex flex-wrap gap-2">
          {DECIMAL_OPTIONS.map((o) => (
            <label key={o.value} className="choice items-center">
              <input
                type="radio"
                name={formNames ? "decimals" : `${idPrefix}decimals`}
                value={o.value}
                checked={places === o.value}
                onChange={() => set({ decimals: o.value })}
              />
              <span className="font-semibold">{o.label}</span>
              <span className="tabular text-sm opacity-75">e.g. {o.example}</span>
            </label>
          ))}
        </div>
      </fieldset>

      {mode === "criteria" && (
        <fieldset>
          <legend className="label">
            {whose}Show totals on the live results and LED wall
          </legend>
          <div className="flex flex-wrap gap-2">
            {(
              [
                { value: "percent", label: "As a percentage", example: "87.50%" },
                { value: "ten", label: "Scaled to 10", example: "8.75" },
              ] as const
            ).map((o) => (
              <label key={o.value} className="choice items-center">
                <input
                  type="radio"
                  name={`${idPrefix}criteria-display-choice`}
                  checked={display === o.value}
                  onChange={() => set({ display: o.value as CriteriaDisplay })}
                />
                <span className="font-semibold">{o.label}</span>
                <span className="tabular text-sm opacity-75">e.g. {o.example}</span>
              </label>
            ))}
          </div>
        </fieldset>
      )}
    </div>
  );
}

/**
 * How judges score, for the event create form. It can't change once the activity exists. Submits scoring_mode,
 * min, max, decimals, criteria (JSON), criteria_display and result_decimals.
 */
export function ScoringFields() {
  const [value, setValue] = useState<ScoringDraft>(() => ({ mode: "simple", min: "1", max: "10", decimals: 2, criteria: blankCriteria(0), display: "percent" }));
  return (
    <>
      <input type="hidden" name="scoring_mode" value={value.mode} />
      <input type="hidden" name="criteria" value={value.mode === "criteria" ? criteriaJson(value.criteria) : "[]"} />
      <input type="hidden" name="criteria_display" value={value.display} />
      <div className="space-y-6">
        <ScoringEditor value={value} onChange={setValue} formNames />
        <ResultDecimalsField />
      </div>
    </>
  );
}
