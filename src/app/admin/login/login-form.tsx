"use client";

import { useActionState } from "react";
import { SubmitButton } from "@/components/submit-button";
import { login, type FormResult } from "../actions";
import { SIGNED_IN_KEY } from "../(panel)/fit-after-sign-in";

export function LoginForm({ asSuper }: { asSuper: boolean }) {
  const [state, action] = useActionState<FormResult, FormData>(login, null);
  const error = state && !state.ok ? state.error : null;
  const describedBy = error ? "login-error" : undefined;

  return (
    <form
      action={action}
      // A phone's keyboard closes as it's sent, so the panel doesn't open zoomed in on the field (see FitAfterSignIn).
      onSubmit={() => {
        (document.activeElement as HTMLElement | null)?.blur();
        try {
          sessionStorage.setItem(SIGNED_IN_KEY, "1");
        } catch {}
      }}
      className="mt-8 space-y-5"
    >
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
            enterKeyHint="next"
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
          enterKeyHint="go"
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
