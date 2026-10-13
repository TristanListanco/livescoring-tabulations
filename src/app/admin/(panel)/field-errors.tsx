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

/** The message under a field with a problem, tied to it by problemId. */
export function FieldProblem({ fieldId, className = "mt-1" }: { fieldId: string; className?: string }) {
  const message = useFieldProblem(fieldId);
  if (!message) return null;
  return (
    <p id={problemId(fieldId)} className={`text-sm font-semibold text-danger ${className}`}>
      {message}
    </p>
  );
}
