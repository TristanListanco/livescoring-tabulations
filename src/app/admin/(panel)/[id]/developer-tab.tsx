"use client";

import { useState } from "react";
import { ConfirmDialog } from "@/components/confirm-dialog";
import type { Activity } from "@/lib/types";
import { resetScores } from "../../actions";

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

export function DeveloperTab({ activity, scoreCount }: { activity: Activity; scoreCount: number }) {
  const [notice, setNotice] = useState<string | null>(null);

  return (
    <div className="max-w-3xl">
      <h2 className="text-xl font-bold">Developer tools</h2>
      <p className="hint mt-1">For testing and rehearsals. Not available on the live site.</p>
      {notice && (
        <p role="status" className="note mt-4 font-semibold text-regal">
          {notice}
        </p>
      )}

      <div className="mt-4 divide-y divide-danger/25 rounded-2xl border border-danger/40 px-5">
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
              This deletes all {scoreCount} submitted scores for {activity.name} and puts the session back to not started. Judges can score every
              entry again, and the judges and running order can be changed.
            </ConfirmDialog>
          }
        >
          Deletes all {scoreCount} submitted {scoreCount === 1 ? "score" : "scores"} and puts the session back to not started. Judges, entries and
          access codes stay as they are.
        </Tool>
      </div>
    </div>
  );
}
