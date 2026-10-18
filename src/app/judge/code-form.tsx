"use client";

import { useActionState } from "react";
import { SubmitButton } from "@/components/submit-button";
import { enterCode, type CodeState } from "./actions";

export function CodeForm({
  initialCode,
  initialError,
  submitLabel = "Start judging",
  quiet = false,
  autoFocus = !quiet,
}: {
  initialCode: string;
  initialError?: string;
  submitLabel?: string;
  /** A secondary choice (switching judge): no autofocus, and a quieter button. */
  quiet?: boolean;
  /** Focus the code field (and so open the keyboard) as the page opens. */
  autoFocus?: boolean;
}) {
  const [state, action] = useActionState<CodeState, FormData>(enterCode, { code: initialCode, error: initialError });

  return (
    <form action={action} className={quiet ? "mt-3" : "mt-8"}>
      <label htmlFor="code" className="sr-only">
        Judge code
      </label>
      <input
        id="code"
        name="code"
        defaultValue={state.code}
        key={state.code}
        required
        maxLength={7}
        autoFocus={autoFocus}
        autoComplete="off"
        autoCapitalize="characters"
        spellCheck={false}
        // A hint at the format, not an example code, which looked already typed in.
        placeholder="6 letters or numbers"
        aria-invalid={state.error ? true : undefined}
        aria-describedby={state.error ? "code-error" : undefined}
        className="tabular h-20 w-full rounded-2xl border-2 border-oxford bg-oxford px-5 text-center text-4xl font-bold tracking-[0.3em] text-mint uppercase placeholder:text-xl placeholder:font-normal placeholder:tracking-normal placeholder:text-powder placeholder:normal-case focus:border-powder focus:outline-none"
      />
      {state.error && (
        <p id="code-error" role="alert" className="mt-3 font-semibold text-danger-soft">
          {state.error}
        </p>
      )}
      <SubmitButton
        pendingLabel="Checking…"
        className={`btn mt-6 h-16 w-full rounded-2xl text-xl ${quiet ? "border-2 border-oxford text-mint hover:bg-oxford" : "bg-mint text-prussian hover:bg-white"}`}
      >
        {submitLabel}
      </SubmitButton>
    </form>
  );
}
