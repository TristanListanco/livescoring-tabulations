"use client";

import { useActionState } from "react";
import { SubmitButton } from "@/components/submit-button";
import { login, type FormResult } from "../actions";

export function LoginForm({ asSuper }: { asSuper: boolean }) {
  const [state, action] = useActionState<FormResult, FormData>(login, null);
  const error = state && !state.ok ? state.error : null;
  const describedBy = error ? "login-error" : undefined;

  return (
    <form action={action} className="mt-8 space-y-5">
      {asSuper ? (
        <input type="hidden" name="as" value="super" />
      ) : (
        <div>
          <label htmlFor="email" className="label">
            Email
          </label>
          <input
            id="email"
            name="email"
            type="email"
            required
            autoFocus
            autoComplete="username"
            className="field"
            aria-invalid={error ? true : undefined}
            aria-describedby={describedBy}
          />
        </div>
      )}
      <div>
        <label htmlFor="password" className="label">
          {asSuper ? "Super admin password" : "Password"}
        </label>
        <input
          id="password"
          name="password"
          type="password"
          required
          autoFocus={asSuper}
          autoComplete="current-password"
          className="field"
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy}
        />
      </div>
      {error && (
        <p id="login-error" role="alert" className="text-sm font-semibold text-danger">
          {error}
        </p>
      )}
      <SubmitButton pendingLabel="Signing in…" className="btn btn-primary w-full">
        Sign in
      </SubmitButton>
    </form>
  );
}
