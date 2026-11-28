"use client";

import { useRouter } from "next/navigation";
import { useEffect, type ReactNode } from "react";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { reach } from "@/lib/reach";
import { browserClient } from "@/lib/supabase/browser";
import type { Judge, JudgeDevice } from "@/lib/types";
import { JUDGING_OVER, useLiveRefresh } from "@/lib/use-live-refresh";
import { revokeDevice } from "../../actions";
import { REVIEW_DEVICES } from "../assistance-alerts";

/** Keeps the Judges tab current, so a judge's request for approval appears within seconds. */
export function LiveRefresh({ activityId, ended = false }: { activityId: string; ended?: boolean }) {
  useLiveRefresh(activityId, ended ? JUDGING_OVER : {});
  return null;
}

/**
 * For a tab that doesn't keep itself live (Entries, Settings): one check as it opens, reloading only if the activity
 * changed after the server read it (`since`, see activityChangedAt), as a tab shown again from the browser's cache may
 * have. Offline, it leaves the tab as it is rather than reload into an error.
 */
export function CatchUp({ activityId, since }: { activityId: string; since: string | null | undefined }) {
  const router = useRouter();
  useEffect(() => {
    let stopped = false;
    void browserClient()
      .from("activity_changes")
      .select("changed_at")
      .eq("activity_id", activityId)
      .maybeSingle()
      .then(({ data, error }) => {
        if (stopped || (error && !error.code)) return;
        if (error || since === undefined || ((data as { changed_at: string } | null)?.changed_at ?? null) !== since) router.refresh();
      });
    return () => {
      stopped = true;
    };
  }, [activityId, since, router]);
  return null;
}

/**
 * Brings back the panel's dialog of devices waiting for approval (see AssistanceAlerts), after Later put it away: the
 * dialog is the one place a device is approved.
 */
export function ReviewDevicesButton({ judge, className = "btn btn-quiet btn-sm" }: { judge: Judge; className?: string }) {
  return (
    <button type="button" className={className} onClick={() => window.dispatchEvent(new Event(REVIEW_DEVICES))}>
      Review<span className="sr-only"> {judge.name}&apos;s waiting device</span>
    </button>
  );
}

/**
 * One judge's devices, as the Judges tab's Device column: approved, waiting (with Review, which brings back the panel's
 * dialog, the one place a device is approved), or none. Only the approved device can score; approving one signs out the
 * rest. `end`: the row's last action (Remove), at the foot of the column.
 */
export function DeviceApproval({ judge, devices, end }: { judge: Judge; devices: JudgeDevice[]; end?: ReactNode }) {
  const approved = devices.find((d) => d.status === "approved");
  const requests = devices.filter((d) => d.status === "pending");
  // Newest first, so this is the device most recently signed out, denied or replaced.
  const lastSignedOut = devices.find((d) => d.status === "revoked");

  return (
    <div className="space-y-2.5 text-sm">
      {/* Where the judge's device is, in a word and a mark: approved, waiting for you, or none yet. */}
      {approved ? (
        <p className="min-w-0">
          <span className="flex items-center gap-2 font-semibold text-regal">
            <svg viewBox="0 0 16 16" className="size-4 shrink-0" aria-hidden>
              <path d="M3 8.5l3 3 7-7" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            Approved<span className="sr-only">: </span>
          </span>
          <span className="block pl-6 break-words text-prussian/80">{approved.label}</span>
        </p>
      ) : requests.length > 0 ? (
        <p className="flex items-center gap-2 font-semibold text-prussian">
          <span aria-hidden className="relative flex size-4 shrink-0 items-center justify-center">
            <span className="absolute size-2.5 rounded-full bg-caution motion-safe:animate-ping" />
            <span className="size-2.5 rounded-full bg-caution ring-1 ring-prussian/25" />
          </span>
          Waiting for you to approve
        </p>
      ) : (
        <p className="min-w-0 text-prussian/75">
          <span className="flex items-center gap-2">
            <span aria-hidden className="flex size-4 shrink-0 items-center justify-center">
              <span className="size-2.5 rounded-full border-[1.5px] border-prussian/45" />
            </span>
            <span>No device approved</span>
          </span>
          {lastSignedOut && requests.length === 0 && (
            <span className="block pl-6 break-words">
              <span className="sr-only">. </span>Last device signed out: {lastSignedOut.label}
            </span>
          )}
        </p>
      )}
      {requests.length > 0 && (
        <ul className="space-y-2.5">
          {requests.map((d) => (
            // The pairing code the judge reads out, as in the dialog that approves it.
            <li key={d.id} className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <span className="tabular rounded-md bg-prussian px-2 py-0.5 font-bold tracking-[0.15em] text-mint">{d.pairingCode}</span>
              <span className="min-w-0 break-words text-prussian/75">{d.label}</span>
            </li>
          ))}
          <li>
            <ReviewDevicesButton judge={judge} />
          </li>
        </ul>
      )}
      {(approved || end) && (
        <div className="flex flex-wrap items-center gap-2">
          {approved && (
            <ConfirmDialog
              triggerLabel={
                <>
                  Sign out<span className="sr-only"> {judge.name}&apos;s device</span>
                </>
              }
              triggerClassName="btn btn-quiet btn-sm"
              title={`Sign out ${judge.name}'s device?`}
              tone="danger"
              confirmLabel="Sign out device"
              onConfirm={() => reach(() => revokeDevice(approved.id))}
            >
              {approved.label} can&apos;t score from now on. {judge.name} signs in again with their code, and you approve the new device here. Scores
              they&apos;ve already submitted stay.
            </ConfirmDialog>
          )}
          {end && <span className="ml-auto">{end}</span>}
        </div>
      )}
    </div>
  );
}
