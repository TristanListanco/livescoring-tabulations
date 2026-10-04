"use client";

import { useState, useTransition } from "react";
import { Avatar } from "@/components/avatar";
import type { ActionResult, Judge, JudgeDevice } from "@/lib/types";
import { approveDevice, revokeDevice } from "../../actions";

/**
 * Every device that signed in with a judge's code waits here. The organizer approves the one whose
 * pairing code the judge reads out; only that device can score, and approving it signs out the rest.
 */
export function JudgeDevices({ judges, devices }: { judges: Judge[]; devices: JudgeDevice[] }) {
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<ActionResult | null>(null);
  const act = (fn: () => Promise<ActionResult>) =>
    startTransition(async () => {
      const r = await fn();
      setResult(r.ok ? null : r);
    });
  const waiting = devices.filter((d) => d.status === "pending").length;

  return (
    <section aria-labelledby="judge-devices">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="judge-devices" className="font-bold">
          Judge devices
        </h2>
        <p className="hint">
          {waiting ? `${waiting} waiting for approval. ` : ""}Approve the device whose code the judge reads to you.
        </p>
      </div>
      {result && !result.ok && (
        <p role="alert" className="mt-2 text-sm font-semibold text-danger">
          {result.error}
        </p>
      )}
      <ul className="mt-3 divide-y divide-line border-y border-line">
        {judges.map((judge) => {
          const mine = devices.filter((d) => d.judgeId === judge.id);
          const approved = mine.find((d) => d.status === "approved");
          const requests = mine.filter((d) => d.status === "pending");
          // Newest first, so this is the device most recently signed out, denied or replaced.
          const lastSignedOut = mine.find((d) => d.status === "revoked");
          return (
            <li key={judge.id} className="flex flex-wrap items-start gap-x-4 gap-y-3 py-4">
              <div className="flex min-w-48 flex-1 items-center gap-3">
                <Avatar name={judge.name} src={judge.photoUrl} size={40} />
                <div className="min-w-0">
                  <p className="truncate font-semibold">{judge.name}</p>
                  {approved ? (
                    <p className="flex items-center gap-1.5 text-sm text-regal">
                      <svg viewBox="0 0 16 16" className="size-4 shrink-0" aria-hidden>
                        <path d="M3 8.5l3 3 7-7" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                      <span className="truncate">Approved: {approved.label}</span>
                    </p>
                  ) : (
                    <p className="hint">
                      No device approved
                      {lastSignedOut && requests.length === 0 && <>. Last device signed out: {lastSignedOut.label}</>}
                    </p>
                  )}
                </div>
                {approved && (
                  <button
                    type="button"
                    className="btn btn-sm ml-auto text-danger hover:bg-danger/10"
                    onClick={() => act(() => revokeDevice(approved.id))}
                    disabled={pending}
                    aria-label={`Sign out ${judge.name}'s device`}
                  >
                    Sign out
                  </button>
                )}
              </div>
              {requests.length > 0 && (
                <ul className="w-full space-y-2 sm:pl-[3.25rem]">
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
            </li>
          );
        })}
      </ul>
    </section>
  );
}
