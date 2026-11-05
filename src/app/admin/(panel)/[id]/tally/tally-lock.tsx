"use client";

import { useActionState } from "react";
import { SubmitButton } from "@/components/submit-button";
import { MAX_PASSWORD_LENGTH } from "@/lib/password-rules";
import { openTally, type FormResult } from "../../../actions";
import { FormMessage } from "../../form-message";

/** The private tally, locked: the admin's own password opens it on this browser for 10 minutes. */
export function TallyLock({ activityId, name, superAdmin, official }: { activityId: string; name: string; superAdmin: boolean; official: boolean }) {
  const [state, action] = useActionState<FormResult, FormData>(openTally.bind(null, activityId), null);
  return (
    <div className="card mt-6 max-w-xl px-6 py-8">
      <p className={`text-sm font-bold tracking-wide uppercase ${official ? "text-regal" : "text-danger"}`}>{official ? "Official" : "Partial and unofficial"}</p>
      <h1 className="title mt-1">Private tally: {name}</h1>
      <form action={action} className="mt-6 space-y-4">
        <div>
          <label htmlFor="tally-password" className="label">
            {superAdmin ? "Super admin password" : "Your password"}
          </label>
          <input
            id="tally-password"
            name="password"
            type="password"
            required
            maxLength={MAX_PASSWORD_LENGTH}
            autoComplete="current-password"
            className="field max-w-md"
          />
        </div>
        <div className="flex flex-wrap items-center gap-4">
          <SubmitButton>Open the tally</SubmitButton>
          <FormMessage state={state} />
        </div>
      </form>
    </div>
  );
}
