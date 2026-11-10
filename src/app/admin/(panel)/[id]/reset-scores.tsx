"use client";

import { ConfirmDialog } from "@/components/confirm-dialog";
import type { Activity } from "@/lib/types";
import { resetScores } from "../../actions";
import { toast } from "../toaster";

/**
 * Start judging over, from Settings: with the organizer's password, as ending the session asks, since it can't be
 * undone. Says what goes, what stays, and what judges have to do.
 */
export function ResetScoresButton({ activity, scoreCount }: { activity: Activity; scoreCount: number }) {
  return (
    <ConfirmDialog
      triggerLabel="Reset scores"
      triggerClassName="btn btn-danger-quiet"
      title="Reset every score?"
      tone="danger"
      confirmLabel="Reset scores"
      passwordLabel="Your password"
      onConfirm={async (password) => {
        const result = await resetScores(activity.id, password);
        if (result.ok) toast(`${activity.name}'s scores were reset`);
        return result;
      }}
    >
      <p>
        {scoreCount === 0 ? (
          <>
            No scores have been submitted for <strong>{activity.name}</strong> yet. Resetting deletes the judges&apos; notes
            {activity.kind === "pageant" ? " and opens every cut again" : ""}.
          </>
        ) : (
          <>
            This deletes {scoreCount === 1 ? "the 1 submitted score" : `all ${scoreCount} submitted scores`} for <strong>{activity.name}</strong>, with
            the judges&apos; notes{activity.kind === "pageant" ? ", and opens every cut again" : ""}. It can&apos;t be undone.
          </>
        )}
      </p>
      <p className="mt-2">
        The session goes back to not started and every judge is signed out: they sign in again with their codes. The judges
        stay as they are, and you can still change the running order.
      </p>
    </ConfirmDialog>
  );
}
