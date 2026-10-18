"use client";

import { useActionState } from "react";
import { SubmitButton } from "@/components/submit-button";
import { MAX_PASSWORD_LENGTH } from "@/lib/password-rules";
import { openTally, type FormResult } from "../../../actions";
import { FormMessage } from "../../form-message";

/** The private tally, locked: the admin's own password opens it on this browser for 10 minutes. */
export function TallyLock({ activityId, name, superAdmin }: { activityId: string; name: string; superAdmin: boolean }) {
  const [state, action] = useActionState<FormResult, FormData>(openTally.bind(null, activityId), null);
  return (
    <div className="mt-6 max-w-xl rounded-2xl border border-line bg-white px-6 py-8">
      <p className="text-sm font-bold tracking-wide text-danger uppercase">Partial and unofficial</p>
      <h1 className="mt-1 text-2xl font-bold">Private tally: {name}</h1>
      <p className="mt-2 text-[15px] leading-relaxed text-prussian/80">
        Every score the judges have submitted so far, judge by judge and criterion by criterion, to tabulate by hand if something fails during
        judging. It isn&apos;t the results: only the results the judges sign are official.
      </p>
      <p className="mt-2 text-[15px] leading-relaxed text-prussian/80">
        Your password opens it on this device for 10 minutes. The link opens it for no one else, and every opening is recorded.
      </p>
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
