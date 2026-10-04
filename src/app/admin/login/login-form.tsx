"use client";

import { useActionState } from "react";
import { SubmitButton } from "@/components/submit-button";
import { login, type FormResult } from "../actions";

export function LoginForm() {
  const [state, action] = useActionState<FormResult, FormData>(login, null);
  const error = state && !state.ok ? state.error : null;

  return (
    <form action={action} className="mt-8 space-y-5">
      <div>
        <label htmlFor="password" className="label">
          Password
        </label>
        <input
          id="password"
          name="password"
          type="password"
          required
          autoFocus
          autoComplete="current-password"
          className="field"
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? "password-error" : undefined}
        />
        {error && (
          <p id="password-error" role="alert" className="mt-2 text-sm font-semibold text-danger">
            {error}
          </p>
        )}
      </div>
      <SubmitButton pendingLabel="Signing in…" className="btn btn-primary w-full">
        Sign in
      </SubmitButton>
    </form>
  );
}
