"use client";

import { ConfirmDialog } from "@/components/confirm-dialog";
import type { Activity } from "@/lib/types";
import { deleteActivityNow } from "../../actions";
import { toastOnRedirect } from "../toaster";

/**
 * Deleting an activity at any time, even mid-session, for test sites only, in Settings: a test activity can go
 * without ending it first. (Resetting the scores is for every site: see ResetScoresButton.)
 */
export function TestSiteTools({ activity }: { activity: Activity }) {
  return (
    <>
      <h3 className="sr-only">Test site tools</h3>
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
    </>
  );
}
