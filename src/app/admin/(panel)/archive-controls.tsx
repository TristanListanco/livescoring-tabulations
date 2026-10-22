"use client";

import { ConfirmDialog } from "@/components/confirm-dialog";
import { archiveActivity, deleteActivity } from "../actions";

/**
 * Archive an activity whose session has ended, from the list of activities or its ended desk. Asks first: it can't be
 * undone, and the activity can't be reopened or changed after it. In the list it sits above the row's link, so it's a
 * button of its own.
 */
export function ArchiveButton({ activityId, name, className = "btn btn-sm btn-quiet relative z-10" }: { activityId: string; name: string; className?: string }) {
  return (
    <ConfirmDialog
      triggerLabel={
        <>
          Archive<span className="sr-only"> {name}</span>
        </>
      }
      triggerClassName={className}
      title="Archive this activity?"
      confirmLabel="Archive"
      onConfirm={() => archiveActivity(activityId)}
    >
      <p>
        <strong>{name}</strong> moves to Archived activities for good. It can&apos;t be reopened, deliberated again or changed after this.
      </p>
      <p className="mt-2">
        Judges are signed out and their codes stop working, the private tally closes, and the live results stay as they are. You can still open it
        to download its results and score sheets, or delete it.
      </p>
    </ConfirmDialog>
  );
}

/** Delete an archived activity: the one change it still allows. As on Settings, typing its name confirms. */
export function DeleteArchivedButton({ activityId, name, className = "btn btn-danger-quiet" }: { activityId: string; name: string; className?: string }) {
  return (
    <ConfirmDialog
      triggerLabel={
        <>
          Delete<span className="sr-only"> {name}</span>
        </>
      }
      triggerClassName={className}
      title="Delete this activity?"
      tone="danger"
      confirmLabel="Delete activity"
      requireText={name}
      onConfirm={() => deleteActivity(activityId)}
    >
      This permanently deletes <strong>{name}</strong> with its judges, entries, scores and photos. Its results can&apos;t be downloaded after this,
      and the live results link stops working.
    </ConfirmDialog>
  );
}
