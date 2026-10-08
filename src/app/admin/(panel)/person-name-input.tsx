"use client";

import { useState, type InputHTMLAttributes } from "react";
import { MAX_NAME_PART, personNameProblem } from "@/lib/names";

type Props = Omit<InputHTMLAttributes<HTMLInputElement>, "type" | "maxLength" | "onChange"> & {
  id: string;
  part: "first" | "last";
  onValueChange?: (value: string) => void;
};

/**
 * A judge's first or last name. Names are letters, so a digit or symbol is pointed out as soon as it's typed,
 * and the browser holds the form back with the same sentence until it's fixed. The server checks it again.
 */
export function PersonNameInput({ id, part, onValueChange, className = "field", ...rest }: Props) {
  const [problem, setProblem] = useState<string | null>(null);
  const errorId = `${id}-error`;
  return (
    <>
      <input
        {...rest}
        id={id}
        maxLength={MAX_NAME_PART}
        autoComplete="off"
        aria-invalid={problem ? true : undefined}
        aria-describedby={problem ? errorId : undefined}
        className={`${className} ${problem ? "border-danger" : ""}`}
        onChange={(e) => {
          const next = personNameProblem(e.target.value, part);
          e.target.setCustomValidity(next ?? "");
          setProblem(next);
          onValueChange?.(e.target.value);
        }}
      />
      {problem && (
        <p id={errorId} role="alert" className="mt-1 text-sm font-semibold text-danger">
          {problem}
        </p>
      )}
    </>
  );
}
