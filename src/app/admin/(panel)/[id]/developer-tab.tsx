"use client";

import { useState } from "react";
import { ConfirmDialog } from "@/components/confirm-dialog";
import type { Activity } from "@/lib/types";
import { deleteActivityNow, resetScores } from "../../actions";

function Tool({ title, children, action }: { title: string; children: React.ReactNode; action: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-4 py-5">
      <div className="max-w-xl">
        <h3 className="font-bold">{title}</h3>
        <p className="hint mt-1">{children}</p>
      </div>
      {action}
    </div>
  );
}

/**
 * Reset scores and delete at any time, for test sites only: on the Developer tab, and in Settings. Rehearsals can
 * run again from the start, or a test activity can go even mid-session.
 */
export function TestSiteTools({ activity, scoreCount }: { activity: Activity; scoreCount: number }) {
  const [notice, setNotice] = useState<string | null>(null);

  return (
    <>
      {notice && (
        <p role="status" className="note mb-4 font-semibold text-regal">
          {notice}
        </p>
      )}

      <div className="divide-y divide-danger/25 rounded-2xl border border-danger/40 px-5">
        <Tool
          title="Reset scores"
          action={
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
          }
        >
          Deletes all {scoreCount} {scoreCount === 1 ? "score" : "scores"} and the judges&apos; notes, signs every judge out, and puts the session back to
          not started.
        </Tool>
        <Tool
          title="Delete activity"
          action={
            <ConfirmDialog
              triggerLabel="Delete activity"
              triggerClassName="btn btn-danger-quiet"
              title="Delete this activity?"
              tone="danger"
              confirmLabel="Delete activity"
              requireText={activity.name}
              onConfirm={() => deleteActivityNow(activity.id)}
            >
              This permanently deletes <strong>{activity.name}</strong> with its judges, entries, scores and photos. Judge codes and the live results link stop
              working.
              {activity.sessionState === "live" && " Its session is live, so judges' screens and the LED wall stop working right away."}
            </ConfirmDialog>
          }
        >
          Deletes it at any time, even mid-session, so a test can start over.
        </Tool>
      </div>
    </>
  );
}
