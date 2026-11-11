"use client";

import { ConfirmDialog } from "@/components/confirm-dialog";
import { archiveActivity, deleteActivity } from "../actions";
import { toast, toastOnRedirect } from "./toaster";

/**
 * Archive an activity whose session has ended, from its ended desk or its Settings. Asks first, with the organizer's
 * password (as ending the session does): it can't be undone, and the activity can't be reopened or changed after it.
 * `blocked`: why its results can't be downloaded (see archiveBlocked in lifecycle.ts), which archiving makes permanent.
 */
export function ArchiveButton({
  activityId,
  name,
  blocked = null,
  className = "btn btn-quiet",
}: {
  activityId: string;
  name: string;
  blocked?: string | null;
  className?: string;
}) {
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
      passwordLabel="Your password"
      onConfirm={async (password) => {
        const result = await archiveActivity(activityId, password);
        if (result.ok) toast(`${name} archived`);
        return result;
      }}
    >
      <p>
        <strong>{name}</strong> moves to Archived activities for good. It can&apos;t be reopened, deliberated again or changed after this.
      </p>
      <p className="mt-2">Judges are signed out and their codes stop working, and the live results page and LED wall close.</p>
      {blocked ? (
        <p role="note" className="note mt-3 font-semibold">
          Its results can&apos;t be downloaded: {blocked}. Once it&apos;s archived, they never can be.
        </p>
      ) : (
        <p className="mt-2">You can still open it to download its results and score sheets, or delete it.</p>
      )}
    </ConfirmDialog>
  );
}

/** Delete an archived activity: the one change it still allows. As on Settings, typing its name confirms, and a toast says it's gone. */
export function DeleteArchivedButton({ activityId, name, className = "btn btn-danger-quiet" }: { activityId: string; name: string; className?: string }) {
  return (
    <ConfirmDialog
      triggerLabel={
        <>
          Delete activity<span className="sr-only"> {name}</span>
        </>
      }
      triggerClassName={className}
      title="Delete this activity?"
      tone="danger"
      confirmLabel="Delete activity"
      requireText={name}
      onConfirm={() => toastOnRedirect(deleteActivity(activityId), `${name} deleted`)}
    >
      This permanently deletes <strong>{name}</strong> with its judges, entries, scores and photos. Its results can&apos;t be downloaded after this,
      and the live results link stops working.
    </ConfirmDialog>
  );
}
