"use client";

import { useState } from "react";
import { ConfirmDialog } from "@/components/confirm-dialog";
import type { Activity } from "@/lib/types";
import { deleteActivityNow, resetScores } from "../../actions";
import { toastOnRedirect } from "../toaster";

/**
 * Reset scores and delete at any time, for test sites only, in Settings: rehearsals can run again from the start, or a
 * test activity can go even mid-session. Two buttons, side by side.
 */
export function TestSiteTools({ activity, scoreCount }: { activity: Activity; scoreCount: number }) {
  const [notice, setNotice] = useState<string | null>(null);

  return (
    <div className="flex flex-wrap items-center gap-3">
      <h3 className="sr-only">Test site tools</h3>
      <ConfirmDialog
        triggerLabel="Reset scores"
        triggerClassName="btn btn-danger-quiet"
        triggerDisabled={scoreCount === 0 && activity.sessionState === "draft"}
        title="Reset all scores?"
        tone="danger"
        confirmLabel="Delete all scores"
        requireText="RESET"
        onConfirm={async () => {
          const result = await resetScores(activity.id);
          if (result.ok) setNotice(result.message ?? null);
          return result;
        }}
      >
        This deletes all {scoreCount} submitted scores and the judges&apos; notes for {activity.name}, signs every judge out of their device,
        and puts the session back to not started. Judges sign in again with their codes and can score every entry again, and the judges and
        running order can be changed.{activity.kind === "pageant" && " Every cut opens again."}
      </ConfirmDialog>
      <ConfirmDialog
        triggerLabel="Delete activity"
        triggerClassName="btn btn-danger-quiet"
        title="Delete this activity?"
        tone="danger"
        confirmLabel="Delete activity"
        requireText={activity.name}
        onConfirm={() => toastOnRedirect(deleteActivityNow(activity.id), `${activity.name} deleted`)}
      >
        This permanently deletes <strong>{activity.name}</strong> with its judges, entries, scores and photos. Judge codes and the live results link stop
        working.
        {activity.sessionState === "live" && " Its session is live, so judges' screens and the LED wall stop working right away."}
      </ConfirmDialog>
      {notice && (
        <p role="status" className="basis-full text-sm font-semibold text-regal">
          {notice}
        </p>
      )}
    </div>
  );
}
