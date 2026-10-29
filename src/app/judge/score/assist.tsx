"use client";

import { useState, useTransition } from "react";
import { ConfirmDialog } from "@/components/confirm-dialog";
import type { JudgeAssistance } from "@/lib/assistance";
import { cancelAssistance, requestAssistance } from "../actions";

/** A raised hand. */
function HandIcon() {
  return (
    <svg viewBox="0 0 24 24" className="size-5 shrink-0" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M8 13V5.5a1.5 1.5 0 0 1 3 0V12M11 11.5v-8a1.5 1.5 0 0 1 3 0V12M14 12V5.5a1.5 1.5 0 0 1 3 0V14M17 9.5a1.5 1.5 0 0 1 3 0V15a7 7 0 0 1-7 7h-1a7 7 0 0 1-5.6-2.8L3.6 15.4a1.6 1.6 0 0 1 2.5-2l1.9 2" />
    </svg>
  );
}

/**
 * Assist me, in the judge's header: the organizer is alerted wherever they are in the admin panel, and comes over.
 * Asked first, so a stray tap mid-show doesn't call them. Not while a call is waiting (the bar under the header says
 * so, with Cancel).
 */
export function AssistButton({ current }: { current: JudgeAssistance | null }) {
  if (current?.status === "open") return null;
  return (
    <ConfirmDialog
      triggerLabel={
        <>
          <HandIcon />
          <span className="max-sm:sr-only">Assist me</span>
        </>
      }
      triggerClassName="btn btn-sm gap-1.5 border border-oxford text-powder hover:bg-oxford hover:text-mint max-sm:px-2.5"
      title="Ask the organizer for help?"
      confirmLabel="Ask for help"
      onConfirm={() => requestAssistance()}
    >
      The organizer is alerted on their screen and comes to you. Keep this page open.
    </ConfirmDialog>
  );
}

/** Under the header: the judge's call is waiting (with Cancel), or the organizer has answered it and is on the way. */
export function AssistStatus({ current }: { current: JudgeAssistance | null }) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  if (!current) return null;
  return (
    <div role="status" className="mx-4 mt-3 flex shrink-0 items-center gap-3 rounded-xl border-2 border-mint/70 px-4 py-3 sm:mx-6">
      <HandIcon />
      <p className="min-w-0 flex-1 text-[15px] font-semibold">
        {current.status === "open" ? "You've asked the organizer for help. They'll come to you." : "The organizer is on the way."}
        {error && <span className="mt-1 block text-sm font-normal text-powder">{error}</span>}
      </p>
      {current.status === "open" && (
        <button
          type="button"
          disabled={pending}
          onClick={() =>
            start(async () => {
              const result = await cancelAssistance().catch(() => ({ ok: false as const, error: "That didn't go through. Try again." }));
              setError(result.ok ? null : result.error);
            })
          }
          className="btn btn-sm shrink-0 border border-oxford text-powder hover:bg-oxford hover:text-mint"
        >
          Cancel<span className="sr-only"> your call for help</span>
        </button>
      )}
    </div>
  );
}
