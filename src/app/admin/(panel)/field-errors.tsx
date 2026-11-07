"use client";

import { createContext, useContext } from "react";

/**
 * A form's problems by the id of the field each is about, set when Continue (or Create) finds them and re-checked
 * as the organizer types, so a message goes away as soon as its field is fixed. Fields read their own: see
 * useFieldProblem and FieldProblem. Outside a provider there are none.
 */
const FieldProblems = createContext<ReadonlyMap<string, string>>(new Map());
export const FieldProblemsProvider = FieldProblems.Provider;

/** The id of a field's problem message, for aria-describedby. */
export const problemId = (fieldId: string) => `${fieldId}-problem`;

/** Ids for aria-describedby, skipping the ones not in use; undefined when none are. */
export const describedBy = (...ids: (string | false | null | undefined)[]) => ids.filter(Boolean).join(" ") || undefined;

/** Every field's problem, for components that render many fields in a loop. */
export function useFieldProblems(): ReadonlyMap<string, string> {
  return useContext(FieldProblems);
}

/** A field's problem, if it has one. */
export function useFieldProblem(fieldId: string): string | null {
  return useContext(FieldProblems).get(fieldId) ?? null;
}

/** The message under a field with a problem, tied to it by problemId: marked, so it reads as a problem at a glance. */
export function FieldProblem({ fieldId, className = "mt-1" }: { fieldId: string; className?: string }) {
  const message = useFieldProblem(fieldId);
  if (!message) return null;
  return (
    <p id={problemId(fieldId)} className={`field-problem flex items-start gap-1.5 text-sm font-semibold text-danger ${className}`}>
      <svg viewBox="0 0 16 16" className="mt-0.5 size-4 shrink-0" aria-hidden>
        <circle cx="8" cy="8" r="6.5" fill="none" stroke="currentColor" strokeWidth="1.5" />
        <path d="M8 4.6v4" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
        <circle cx="8" cy="11.2" r="0.95" fill="currentColor" />
      </svg>
      {message}
    </p>
  );
}
