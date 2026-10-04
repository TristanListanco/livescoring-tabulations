"use client";

import { useState } from "react";
import type { CriteriaDisplay, Criterion, Decimals, ResultDecimals, ScoringMode } from "@/lib/types";

const DECIMAL_OPTIONS: { value: Decimals; label: string; example: string }[] = [
  { value: 0, label: "Whole numbers", example: "9" },
  { value: 1, label: "1 decimal place", example: "9.5" },
  { value: 2, label: "2 decimal places", example: "9.75" },
];

const choice =
  "flex cursor-pointer gap-2.5 rounded-lg border border-line bg-white px-3.5 py-2.5 has-checked:border-regal has-checked:bg-regal has-checked:text-mint has-disabled:cursor-not-allowed";

export type ScoringValues = {
  mode: ScoringMode;
  min: number;
  max: number;
  decimals: Decimals;
  criteria: Criterion[];
  display: CriteriaDisplay;
  resultDecimals: ResultDecimals;
};

export const DEFAULT_SCORING: ScoringValues = { mode: "simple", min: 1, max: 10, decimals: 2, criteria: [], display: "percent", resultDecimals: 2 };

/** How many decimal places averages and totals show. Not part of the scoring rules, so it can change at any time. */
function ResultDecimalsField({ initial }: { initial: ResultDecimals }) {
  const [value, setValue] = useState(String(initial));
  const valid = /^[0-4]$/.test(value);
  const example = valid ? (8.66667).toFixed(Number(value)) : null;
  return (
    <div>
      <label htmlFor="result_decimals" className="label">
        Decimal places shown in results
      </label>
      <div className="flex flex-wrap items-center gap-3">
        <input
          id="result_decimals"
          name="result_decimals"
          type="number"
          inputMode="numeric"
          required
          min={0}
          max={4}
          step={1}
          // Uncontrolled, so the form's reset after saving shows the saved value; keyed on it by the caller.
          defaultValue={initial}
          onChange={(e) => setValue(e.target.value)}
          aria-invalid={!valid}
          aria-describedby="result_decimals-hint"
          className={`field tabular w-20 ${valid ? "" : "border-danger ring-2 ring-danger/30"}`}
        />
        {example && <span className="tabular hint">Average of 8, 9 and 9: {example}</span>}
      </div>
      <p id="result_decimals-hint" className={`mt-1.5 text-sm ${valid ? "hint" : "font-semibold text-danger"}`} role={valid ? undefined : "alert"}>
        {valid
          ? "0 to 4. For averages and criteria totals on the live results, LED wall and PDF. Equal averages at this many places share a rank. You can change it at any time."
          : "Enter a whole number from 0 to 4."}
      </p>
    </div>
  );
}

type Row = { key: number; id: string; name: string; max: string };
let nextKey = 0;
const toRows = (criteria: Criterion[]): Row[] =>
  criteria.length
    ? criteria.map((c) => ({ key: nextKey++, id: c.id, name: c.name, max: String(c.max) }))
    : [0, 1, 2].map(() => ({ key: nextKey++, id: "", name: "", max: "" }));

/**
 * How judges score: simple (one score from min to max) or criteria (points per criterion, adding up
 * to 100). Shared by the create form and the Settings tab. Submits scoring_mode, min, max, decimals,
 * criteria (JSON) and criteria_display.
 */
export function ScoringFields({
  initial = DEFAULT_SCORING,
  locked = false,
  showDisplay = true,
}: {
  initial?: ScoringValues;
  locked?: boolean;
  /** The create form picks the display here; Settings has its own instant switch for it. */
  showDisplay?: boolean;
}) {
  const [mode, setMode] = useState<ScoringMode>(initial.mode);
  const [places, setPlaces] = useState<Decimals>(initial.decimals);
  const [rows, setRows] = useState<Row[]>(() => toRows(initial.criteria));
  const [display, setDisplay] = useState<CriteriaDisplay>(initial.display);
  const step = places === 0 ? 1 : places === 1 ? 0.1 : 0.01;

  const total = rows.reduce((sum, r) => sum + (Number(r.max) || 0), 0);
  const criteriaJson = JSON.stringify(rows.filter((r) => r.name.trim() || r.max).map((r) => ({ id: r.id, name: r.name.trim(), max: Number(r.max) })));
  const update = (key: number, patch: Partial<Row>) => setRows((list) => list.map((r) => (r.key === key ? { ...r, ...patch } : r)));

  return (
    <>
      {/* Disabled fields aren't submitted, so a locked form sends the current values instead. */}
      <input type="hidden" name="scoring_mode" value={mode} />
      <input type="hidden" name="criteria" value={mode === "criteria" ? criteriaJson : "[]"} />
      {showDisplay && <input type="hidden" name="criteria_display" value={display} />}
      {locked && (
        <>
          <input type="hidden" name="min" value={initial.min} />
          <input type="hidden" name="max" value={initial.max} />
          <input type="hidden" name="decimals" value={initial.decimals} />
        </>
      )}

      <fieldset disabled={locked} className="space-y-6">
        <fieldset>
          <legend className="label">Scoring</legend>
          <div className="grid gap-2 sm:grid-cols-2">
            {(
              [
                { value: "simple", label: "Simple", hint: "One score per judge, from a minimum to a maximum." },
                { value: "criteria", label: "Criteria", hint: "Judges score each criterion. The criteria add up to 100 points." },
              ] as const
            ).map((o) => (
              <label key={o.value} className={choice}>
                <input
                  type="radio"
                  name="scoring-mode-choice"
                  className="mt-1 accent-mint"
                  checked={mode === o.value}
                  onChange={() => setMode(o.value)}
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
              <label htmlFor="min" className="label">
                Min score
              </label>
              <input
                id="min"
                name="min"
                type="number"
                inputMode="decimal"
                required
                min={0}
                max={9999}
                step={step}
                defaultValue={initial.min}
                className="field tabular"
              />
            </div>
            <div className="w-36">
              <label htmlFor="max" className="label">
                Max score
              </label>
              <input
                id="max"
                name="max"
                type="number"
                inputMode="decimal"
                required
                min={0}
                max={9999}
                step={step}
                defaultValue={initial.max}
                className="field tabular"
              />
            </div>
          </div>
        ) : (
          <fieldset>
            <legend className="label">Criteria and their max points</legend>
            <ol className="space-y-2">
              {rows.map((r, i) => (
                <li key={r.key} className="flex flex-wrap items-center gap-2">
                  <label htmlFor={`criterion-${r.key}`} className="sr-only">
                    Criterion {i + 1} name
                  </label>
                  <input
                    id={`criterion-${r.key}`}
                    value={r.name}
                    onChange={(e) => update(r.key, { name: e.target.value })}
                    maxLength={60}
                    placeholder={["Innovativeness", "Design", "Impact"][i] ?? `Criterion ${i + 1}`}
                    className="field max-w-xs flex-1"
                  />
                  <label htmlFor={`criterion-${r.key}-max`} className="sr-only">
                    Criterion {i + 1} max points
                  </label>
                  <input
                    id={`criterion-${r.key}-max`}
                    value={r.max}
                    onChange={(e) => update(r.key, { max: e.target.value.replace(/[^0-9]/g, "").slice(0, 3) })}
                    inputMode="numeric"
                    placeholder="30"
                    className="field tabular w-20"
                  />
                  <span className="hint">points</span>
                  {rows.length > 1 && (
                    <button
                      type="button"
                      className="btn btn-sm text-danger hover:bg-danger/10"
                      onClick={() => setRows((list) => list.filter((x) => x.key !== r.key))}
                      aria-label={`Remove criterion ${i + 1}`}
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
                onClick={() => setRows((list) => [...list, { key: nextKey++, id: "", name: "", max: "" }])}
                disabled={rows.length >= 20}
              >
                Add criterion
              </button>
              <p role="status" className={`tabular text-sm font-semibold ${total === 100 ? "text-regal" : "text-danger"}`}>
                Total {total} of 100 points{total === 100 ? "" : ". The criteria must add up to 100."}
              </p>
            </div>
          </fieldset>
        )}

        <fieldset>
          <legend className="label">{mode === "criteria" ? "Judges give points in" : "Judges score with"}</legend>
          <div className="flex flex-wrap gap-2">
            {DECIMAL_OPTIONS.map((o) => (
              <label key={o.value} className={`${choice} items-center`}>
                <input
                  type="radio"
                  name="decimals"
                  value={o.value}
                  checked={places === o.value}
                  onChange={() => setPlaces(o.value)}
                  className="accent-mint"
                />
                <span className="font-semibold">{o.label}</span>
                <span className="tabular text-sm opacity-75">e.g. {o.example}</span>
              </label>
            ))}
          </div>
        </fieldset>

        {mode === "criteria" && showDisplay && (
          <fieldset>
            <legend className="label">Show totals on the live results and LED wall</legend>
            <div className="flex flex-wrap gap-2">
              {(
                [
                  { value: "percent", label: "As a percentage", example: "87.5%" },
                  { value: "ten", label: "Scaled to 10", example: "8.75" },
                ] as const
              ).map((o) => (
                <label key={o.value} className={`${choice} items-center`}>
                  <input
                    type="radio"
                    name="criteria-display-choice"
                    checked={display === o.value}
                    onChange={() => setDisplay(o.value)}
                    className="accent-mint"
                  />
                  <span className="font-semibold">{o.label}</span>
                  <span className="tabular text-sm opacity-75">e.g. {o.example}</span>
                </label>
              ))}
            </div>
          </fieldset>
        )}
      </fieldset>

      {/* Outside the locked fieldset: how results look can change mid-session. */}
      <div className="mt-6">
        <ResultDecimalsField key={initial.resultDecimals} initial={initial.resultDecimals} />
      </div>
    </>
  );
}
