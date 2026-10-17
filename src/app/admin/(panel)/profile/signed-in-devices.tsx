"use client";

import { useState, useSyncExternalStore, useTransition } from "react";
import type { AdminSessionInfo } from "@/lib/session";
import type { ActionResult } from "@/lib/types";
import { signOutOtherDevices } from "../../account-actions";
import { FormMessage } from "../form-message";

const signedInFormat = new Intl.DateTimeFormat("en", { dateStyle: "medium", timeStyle: "short" });
const noSubscription = () => () => {};

/** When a browser signed in, in this device's time zone (the server's could differ), so the server render leaves it out. */
function SignedInAt({ at }: { at: string }) {
  const onDevice = useSyncExternalStore(
    noSubscription,
    () => true,
    () => false,
  );
  return onDevice ? <time dateTime={at}>Signed in {signedInFormat.format(new Date(at))}</time> : <>Signed in</>;
}

/**
 * The browsers signed in to your account, this one first: sign any other out, or all of them. Signing one out ends its
 * session there and then, whoever holds it, so a forgotten laptop at a venue, or a copied cookie, stops working.
 */
export function SignedInDevices({ sessions }: { sessions: AdminSessionInfo[] }) {
  const [result, setResult] = useState<ActionResult | null>(null);
  const [pending, startTransition] = useTransition();
  const others = sessions.filter((s) => !s.current);
  const ordered = [...sessions.filter((s) => s.current), ...others];
  const signOut = (sessionId: string | null) =>
    startTransition(async () => {
      setResult(await signOutOtherDevices(sessionId).catch(() => ({ ok: false as const, error: "That didn't go through. Try again." })));
    });

  return (
    <div className="max-w-2xl">
      <ul className="divide-y divide-line border-y border-line">
        {ordered.map((s) => (
          <li key={s.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 py-3">
            <div className="min-w-0 flex-1">
              <p className="font-semibold">
                {s.label}
                {s.current && <span className="ml-2 rounded-full bg-wash px-2 py-0.5 text-xs font-semibold">This device</span>}
              </p>
              <p className="hint">
                <SignedInAt at={s.createdAt} />
              </p>
            </div>
            {!s.current && (
              <button type="button" className="btn btn-quiet btn-sm" disabled={pending} onClick={() => signOut(s.id)}>
                Sign out<span className="sr-only"> {s.label}</span>
              </button>
            )}
          </li>
        ))}
      </ul>
      <div className="mt-4 flex flex-wrap items-center gap-4">
        {others.length > 1 && (
          <button type="button" className="btn btn-danger-quiet" disabled={pending} onClick={() => signOut(null)}>
            Sign out of every other device
          </button>
        )}
        <FormMessage state={result} />
      </div>
    </div>
  );
}
