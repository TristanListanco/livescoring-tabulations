"use client";

import { useState } from "react";
import type { Decimals } from "@/lib/types";

const DECIMAL_OPTIONS: { value: Decimals; label: string; example: string }[] = [
  { value: 0, label: "Whole numbers", example: "9" },
  { value: 1, label: "1 decimal place", example: "9.5" },
  { value: 2, label: "2 decimal places", example: "9.75" },
];

/** Min, max and decimal places. Shared by the create form and the Settings tab. */
export function RulesFields({
  min = 1,
  max = 10,
  decimals = 2,
  locked = false,
}: {
  min?: number;
  max?: number;
  decimals?: Decimals;
  locked?: boolean;
}) {
  const [places, setPlaces] = useState<Decimals>(decimals);
  const step = places === 0 ? 1 : places === 1 ? 0.1 : 0.01;

  return (
    <fieldset disabled={locked} className="space-y-5">
      <div className="flex flex-wrap gap-4">
        <div className="w-36">
          <label htmlFor="min" className="label">
            Min score
          </label>
          <input id="min" name="min" type="number" inputMode="decimal" required min={0} max={9999} step={step} defaultValue={min} className="field tabular" />
        </div>
        <div className="w-36">
          <label htmlFor="max" className="label">
            Max score
          </label>
          <input id="max" name="max" type="number" inputMode="decimal" required min={0} max={9999} step={step} defaultValue={max} className="field tabular" />
        </div>
      </div>

      <fieldset>
        <legend className="label">Judges score with</legend>
        <div className="flex flex-wrap gap-2">
          {DECIMAL_OPTIONS.map((o) => (
            <label
              key={o.value}
              className="flex cursor-pointer items-center gap-2.5 rounded-lg border border-line bg-white px-3.5 py-2.5 has-checked:border-regal has-checked:bg-regal has-checked:text-mint has-disabled:cursor-not-allowed"
            >
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
    </fieldset>
  );
}
