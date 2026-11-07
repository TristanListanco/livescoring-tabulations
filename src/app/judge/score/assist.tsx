"use client";

import { useState, useSyncExternalStore, useTransition } from "react";
import { ConfirmDialog } from "@/components/confirm-dialog";
import type { JudgeAssistance } from "@/lib/assistance";
import { cancelAssistance, requestAssistance } from "../actions";

/** A raised hand. `wave`: it waves once as it appears (see .wave). */
function HandIcon({ wave = false }: { wave?: boolean }) {
  return (
    <svg viewBox="0 0 24 24" className={`size-5 shrink-0 ${wave ? "wave" : ""}`} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M8 13V5.5a1.5 1.5 0 0 1 3 0V12M11 11.5v-8a1.5 1.5 0 0 1 3 0V12M14 12V5.5a1.5 1.5 0 0 1 3 0V14M17 9.5a1.5 1.5 0 0 1 3 0V15a7 7 0 0 1-7 7h-1a7 7 0 0 1-5.6-2.8L3.6 15.4a1.6 1.6 0 0 1 2.5-2l1.9 2" />
    </svg>
  );
}

/** Kept on this device once its judge has asked for help: from then on, Assist me asks straight away. */
const ASKED = "tabulous:assist-asked";
const askedBefore = () => {
  try {
    return localStorage.getItem(ASKED) !== null;
  } catch {
    return false;
  }
};
const onStorage = (onChange: () => void) => {
  window.addEventListener("storage", onChange);
  return () => window.removeEventListener("storage", onChange);
};

/**
 * Assist me, in the judge's header: the organizer is alerted wherever they are in the admin panel, and comes over.
 * The one filled button in the header, its hand waving once as the screen opens, so a judge who needs help finds it
 * without looking. The first time on a device it says what it does and asks, so a stray tap mid-show doesn't call
 * anyone unawares; after that a tap asks at once (the bar under the header says so, with Cancel), and the question
 * comes up only if the call didn't go through. Not while a call is waiting.
 */
export function AssistButton({ current }: { current: JudgeAssistance | null }) {
  const known = useSyncExternalStore(onStorage, askedBefore, () => false);
  if (current?.status === "open") return null;
  return (
    <ConfirmDialog
      skipAsking={known}
      triggerLabel={
        <>
          <HandIcon wave />
          Assist me
        </>
      }
      triggerClassName="btn btn-sm gap-1.5 bg-mint text-prussian shadow-[0_0_0_4px_rgb(238_244_237/0.14)] hover:bg-white max-sm:px-3"
      title="Ask the organizer for help?"
      confirmLabel="Ask for help"
      onConfirm={async () => {
        const result = await requestAssistance();
        if (result.ok) {
          try {
            localStorage.setItem(ASKED, "1");
          } catch {
            // Without storage it asks each time; that's all.
          }
        }
        return result;
      }}
    >
      The organizer is alerted on their screen and comes to you. Keep this page open.
    </ConfirmDialog>
  );
}

/**
 * Under the header: the judge's call is waiting (with Cancel), or the organizer has answered it and is on the way, which
 * the judge can put away once they've seen it (it goes by itself after a while too).
 */
export function AssistStatus({ current }: { current: JudgeAssistance | null }) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  // The answer put away, by when it was given: a later answer shows again.
  const [dismissed, setDismissed] = useState<string | null>(null);
  if (!current || (current.status === "answered" && dismissed === current.at)) return null;
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
      {current.status === "answered" && (
        <button
          type="button"
          onClick={() => setDismissed(current.at)}
          aria-label="Dismiss"
          className="btn btn-sm -mr-1.5 shrink-0 px-2.5 text-powder hover:bg-oxford hover:text-mint pointer-coarse:min-w-11"
        >
          <svg viewBox="0 0 16 16" className="size-4" aria-hidden>
            <path d="M4 4l8 8M12 4l-8 8" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
          </svg>
        </button>
      )}
    </div>
  );
}
