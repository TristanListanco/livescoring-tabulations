"use client";

import { useState } from "react";
import { MAX_PASSWORD_LENGTH, PASSWORD_RULES, passwordProblem } from "@/lib/password-rules";

/**
 * A new organizer password, with the rules it has to meet ticking off as they're typed. The browser holds the
 * form back with the same sentence the server would send, so a weak password never makes the round trip.
 * `optional`: blank keeps the current password (the edit form).
 */
export function PasswordField({ label, optional = false }: { label: string; optional?: boolean }) {
  const [value, setValue] = useState("");
  const checking = value !== "" || !optional;

  return (
    <>
      <label htmlFor="password" className="label">
        {label}
      </label>
      <input
        id="password"
        name="password"
        type="password"
        required={!optional}
        maxLength={MAX_PASSWORD_LENGTH}
        autoComplete="new-password"
        className="field max-w-md"
        aria-describedby="password-rules"
        value={value}
        onChange={(e) => {
          setValue(e.target.value);
          const problem = e.target.value === "" ? null : passwordProblem(e.target.value);
          e.target.setCustomValidity(problem ?? "");
        }}
      />
      <ul id="password-rules" className="mt-2 space-y-1 text-sm">
        {PASSWORD_RULES.map((rule) => {
          const met = rule.test(value);
          return (
            <li key={rule.id} className={`flex items-center gap-2 ${met ? "font-semibold text-regal" : "text-prussian/75"}`}>
              {met ? (
                <svg viewBox="0 0 16 16" className="size-4 shrink-0" aria-hidden>
                  <path d="M3 8.5l3 3 7-7" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              ) : (
                <span aria-hidden className="inline-flex size-4 shrink-0 items-center justify-center">
                  <span className="size-1.5 rounded-full bg-current" />
                </span>
              )}
              {rule.label}
              {checking && <span className="sr-only">{met ? " (done)" : " (not yet)"}</span>}
            </li>
          );
        })}
      </ul>
    </>
  );
}
