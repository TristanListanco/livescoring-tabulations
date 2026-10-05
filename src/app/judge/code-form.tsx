"use client";

import { useActionState } from "react";
import { SubmitButton } from "@/components/submit-button";
import { enterCode, type CodeState } from "./actions";

export function CodeForm({ initialCode, initialError }: { initialCode: string; initialError?: string }) {
  const [state, action] = useActionState<CodeState, FormData>(enterCode, { code: initialCode, error: initialError });

  return (
    <form action={action} className="mt-8">
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
        autoFocus
        autoComplete="off"
        autoCapitalize="characters"
        spellCheck={false}
        placeholder="K7MX2P"
        aria-invalid={state.error ? true : undefined}
        aria-describedby={state.error ? "code-error" : undefined}
        className="tabular h-20 w-full rounded-2xl border-2 border-oxford bg-oxford px-5 text-center text-4xl font-bold tracking-[0.3em] text-mint uppercase placeholder:text-powder/35 focus:border-powder focus:outline-none"
      />
      {state.error && (
        <p id="code-error" role="alert" className="mt-3 font-semibold text-danger-soft">
          {state.error}
        </p>
      )}
      <SubmitButton pendingLabel="Checking…" className="btn mt-6 h-16 w-full rounded-2xl bg-mint text-xl text-prussian hover:bg-white">
        Start judging
      </SubmitButton>
    </form>
  );
}
