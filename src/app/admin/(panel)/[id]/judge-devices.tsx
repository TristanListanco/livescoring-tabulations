"use client";

import { useState, useTransition } from "react";
import type { ActionResult, Judge, JudgeDevice } from "@/lib/types";
import { useLiveRefresh } from "@/lib/use-live-refresh";
import { approveDevice, revokeDevice } from "../../actions";

/** Keeps the Access tab current, so a judge's request for approval appears within seconds. */
export function LiveRefresh({ activityId }: { activityId: string }) {
  useLiveRefresh(activityId);
  return null;
}

/**
 * One judge's devices. Every device that signs in with the judge's code waits here; the organizer approves
 * the one whose pairing code the judge reads out. Only that device can score, and approving it signs out
 * the rest.
 */
export function DeviceApproval({ judge, devices }: { judge: Judge; devices: JudgeDevice[] }) {
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<ActionResult | null>(null);
  const act = (fn: () => Promise<ActionResult>) =>
    startTransition(async () => {
      const r = await fn();
      setResult(r.ok ? null : r);
    });

  const approved = devices.find((d) => d.status === "approved");
  const requests = devices.filter((d) => d.status === "pending");
  // Newest first, so this is the device most recently signed out, denied or replaced.
  const lastSignedOut = devices.find((d) => d.status === "revoked");

  return (
    <div className="mt-3 space-y-2 sm:pl-14">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        {approved ? (
          <>
            <p className="flex min-w-0 items-center gap-1.5 text-sm text-regal">
              <svg viewBox="0 0 16 16" className="size-4 shrink-0" aria-hidden>
                <path d="M3 8.5l3 3 7-7" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              <span className="truncate">Approved: {approved.label}</span>
            </p>
            <button
              type="button"
              className="btn btn-sm text-danger hover:bg-danger/10"
              onClick={() => act(() => revokeDevice(approved.id))}
              disabled={pending}
              aria-label={`Sign out ${judge.name}'s device`}
            >
              Sign out
            </button>
          </>
        ) : (
          <p className="hint text-sm">
            No device approved
            {lastSignedOut && requests.length === 0 && <>. Last device signed out: {lastSignedOut.label}</>}
          </p>
        )}
      </div>
      {result && !result.ok && (
        <p role="alert" className="text-sm font-semibold text-danger">
          {result.error}
        </p>
      )}
      {requests.length > 0 && (
        <ul className="space-y-2">
          {requests.map((d) => (
            <li key={d.id} className="flex flex-wrap items-center gap-3 rounded-xl border border-field bg-white px-3 py-2.5">
              <span className="tabular rounded-md bg-prussian px-2.5 py-1 text-lg font-bold tracking-[0.2em] text-mint">
                <span className="sr-only">Pairing code </span>
                {d.pairingCode}
              </span>
              <span className="min-w-0 flex-1 truncate text-sm">{d.label}</span>
              <button
                type="button"
                className="btn btn-primary btn-sm"
                onClick={() => act(() => approveDevice(d.id))}
                disabled={pending}
                aria-label={`Approve ${judge.name}'s device ${d.pairingCode}`}
              >
                Approve
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
            </li>
          ))}
          {approved && <li className="hint text-sm">Approving another device signs out {approved.label}.</li>}
        </ul>
      )}
    </div>
  );
}
