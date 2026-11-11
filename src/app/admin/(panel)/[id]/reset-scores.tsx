"use client";

import { useState } from "react";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { canReset, type ResetScope } from "@/lib/lifecycle";
import type { Activity } from "@/lib/types";
import { resetScores } from "../../actions";
import { toast } from "../toaster";

const scored = (n: number) => (n === 1 ? "1 submitted score" : `${n} submitted scores`);

/**
 * Start judging over, from Settings: with the organizer's password, as ending the session asks, since it can't be
 * undone. Says what goes, what stays, and what judges have to do. A pageant can start over one segment at a time
 * (see canReset): its choices say which, and why one isn't open.
 */
export function ResetScoresButton({
  activity,
  scoreCount,
  segmentScores = { preliminary: 0, proper: 0 },
}: {
  activity: Activity;
  scoreCount: number;
  /** A pageant's scores so far in each segment. */
  segmentScores?: { preliminary: number; proper: number };
}) {
  const pageant = activity.kind === "pageant";
  const [scope, setScope] = useState<ResetScope>("all");
  const chosen = canReset(activity, scope) ? scope : "all";
  const choices: { value: ResetScope; label: string; why: string | null }[] = [
    { value: "all", label: "Both segments", why: null },
    {
      value: "preliminary",
      label: "The preliminary only",
      why: canReset(activity, "preliminary")
        ? null
        : activity.sessionState === "draft"
          ? "It hasn't started."
          : "Pageant proper has started, so the preliminary resets only with it.",
    },
    { value: "proper", label: "Pageant proper only", why: canReset(activity, "proper") ? null : "It hasn't started." },
  ];
  const what = chosen === "preliminary" ? "the preliminary's scores" : chosen === "proper" ? "pageant proper's scores" : "every score";

  return (
    <ConfirmDialog
      triggerLabel="Reset scores"
      triggerClassName="btn btn-danger-quiet"
      title={chosen === "preliminary" ? "Reset the preliminary?" : chosen === "proper" ? "Reset pageant proper?" : "Reset every score?"}
      tone="danger"
      confirmLabel={chosen === "preliminary" ? "Reset the preliminary" : chosen === "proper" ? "Reset pageant proper" : "Reset scores"}
      passwordLabel="Your password"
      onConfirm={async (password) => {
        const result = await resetScores(activity.id, password, chosen);
        if (result.ok) toast(`${activity.name}: ${what} were reset`);
        return result;
      }}
    >
      {pageant && (
        <fieldset className="mb-4">
          <legend className="font-semibold text-prussian">What to reset</legend>
          <div className="mt-2 space-y-2">
            {choices.map((c) => (
              <label key={c.value} className={`flex items-start gap-3 ${c.why ? "text-prussian/70" : "text-prussian"}`}>
                <input
                  type="radio"
                  name="reset-scope"
                  className="mt-0.5 size-5 shrink-0 accent-regal"
                  checked={chosen === c.value}
                  disabled={c.why !== null}
                  onChange={() => setScope(c.value)}
                />
                <span>
                  {c.label}
                  {c.why && <span className="block text-sm">{c.why}</span>}
                </span>
              </label>
            ))}
          </div>
        </fieldset>
      )}
      {chosen === "preliminary" ? (
        <>
          <p>
            This deletes the preliminary&apos;s {scored(segmentScores.preliminary)}, its deductions, and any cut confirmed so far. It can&apos;t be
            undone.
          </p>
          <p className="mt-2">The preliminary starts over and its judges stay signed in. Pageant proper is untouched.</p>
        </>
      ) : chosen === "proper" ? (
        <>
          <p>This deletes pageant proper&apos;s {scored(segmentScores.proper)} and opens its cuts again. It can&apos;t be undone.</p>
          <p className="mt-2">
            Pageant proper goes back to not started and its judges stay signed in: start it again from the Session tab. The preliminary&apos;s scores
            stay.
          </p>
        </>
      ) : (
        <>
          <p>
            {scoreCount === 0 ? (
              <>
                No scores have been submitted for <strong>{activity.name}</strong> yet. Resetting deletes the judges&apos; notes
                {pageant ? ", its deductions, and opens every cut again" : ""}.
              </>
            ) : (
              <>
                This deletes {scoreCount === 1 ? "the 1 submitted score" : `all ${scoreCount} submitted scores`} for <strong>{activity.name}</strong>, with
                the judges&apos; notes{pageant ? ", its deductions, and opens every cut again" : ""}. It can&apos;t be undone.
              </>
            )}
          </p>
          <p className="mt-2">
            The session goes back to not started and every judge is signed out: they sign in again with their codes. The judges stay as they are, and
            you can still change the running order.
          </p>
        </>
      )}
    </ConfirmDialog>
  );
}
