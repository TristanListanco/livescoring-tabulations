"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition, type ReactNode } from "react";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { reach } from "@/lib/reach";
import { browserClient } from "@/lib/supabase/browser";
import type { ActionResult, Judge, JudgeDevice } from "@/lib/types";
import { JUDGING_OVER, useLiveRefresh } from "@/lib/use-live-refresh";
import { approveDevice, revokeDevice } from "../../actions";

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
 * One judge's devices, as the Judges tab's Device column. Every device that signs in with the judge's code waits here;
 * the organizer approves the one whose pairing code the judge reads out. Only that device can score, and approving it
 * signs out the rest. `end`: the row's last action (Remove), at the foot of the column.
 */
export function DeviceApproval({ judge, devices, end }: { judge: Judge; devices: JudgeDevice[]; end?: ReactNode }) {
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<ActionResult | null>(null);
  const act = (fn: () => Promise<ActionResult>) =>
    startTransition(async () => {
      const r = await reach(fn);
      setResult(r.ok ? null : r);
    });

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
            <li key={d.id} className="space-y-1">
              {/* The pairing code on the button, as on the judge's screen, so the two can be matched at a glance. */}
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  className="btn btn-primary btn-sm"
                  onClick={() => act(() => approveDevice(d.id))}
                  disabled={pending}
                  aria-label={`Approve ${judge.name}'s device ${d.pairingCode}`}
                >
                  Approve <span className="tabular tracking-[0.15em]">{d.pairingCode}</span>
                </button>
                <button
                  type="button"
                  className="btn btn-quiet btn-sm"
                  onClick={() => act(() => revokeDevice(d.id))}
                  disabled={pending}
                  aria-label={`Deny ${judge.name}'s device ${d.pairingCode}`}
                >
                  Deny
                </button>
              </div>
              <p className="break-words text-prussian/75">{d.label}</p>
            </li>
          ))}
          {approved && <li className="hint text-sm">Approving another device signs out {approved.label}.</li>}
        </ul>
      )}
      {result && !result.ok && (
        <p role="alert" className="font-semibold text-danger">
          {result.error}
        </p>
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
              triggerDisabled={pending}
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

/**
 * Approve a judge's waiting device without leaving the session desk: the judge reads out the pairing code
 * on their screen, and the organizer approves the button showing the same code.
 */
export function ApproveDeviceButton({ judge, device, className }: { judge: Judge; device: JudgeDevice; className: string }) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const approve = () =>
    startTransition(async () => {
      const r = await reach(() => approveDevice(device.id));
      setError(r.ok ? null : r.error);
    });

  return (
    <>
      <button type="button" className={className} onClick={approve} disabled={pending} aria-label={`Approve ${judge.name}'s device ${device.pairingCode}`}>
        Approve <span className="tabular tracking-[0.15em]">{device.pairingCode}</span>
      </button>
      {error && (
        <span role="alert" className="basis-full text-sm font-semibold text-danger-soft">
          {error}
        </span>
      )}
    </>
  );
}
