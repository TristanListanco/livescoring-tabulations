"use client";

import { useActionState } from "react";
import { SubmitButton } from "@/components/submit-button";
import { MAX_PASSWORD_LENGTH } from "@/lib/password-rules";
import type { ActionResult } from "@/lib/types";
import { changeOwnPassword } from "../../account-actions";
import { FormMessage } from "../form-message";
import { PasswordField } from "../password-field";

type Saved = (ActionResult & { saves: number }) | null;

/** An organizer's own password: the current one, then the new one, its rules ticking off as it's typed. */
export function ChangePassword() {
  // Counted, so the fields start empty after each change that goes through.
  const [state, action] = useActionState<Saved, FormData>(async (previous, data) => {
    const result: ActionResult = (await changeOwnPassword(previous, data)) ?? { ok: false, error: "That didn't go through. Try again." };
    return { ...result, saves: (previous?.saves ?? 0) + (result.ok ? 1 : 0) };
  }, null);

  return (
    <form key={state?.saves ?? 0} action={action} className="space-y-4">
      <div>
        <label htmlFor="current" className="label">
          Current password
        </label>
        <input id="current" name="current" type="password" required maxLength={MAX_PASSWORD_LENGTH} autoComplete="current-password" className="field max-w-md" />
      </div>
      <div>
        <PasswordField label="New password" />
      </div>
      <div className="flex flex-wrap items-center gap-4">
        <SubmitButton>Change password</SubmitButton>
        <FormMessage state={state} />
      </div>
    </form>
  );
}
