"use client";

import { useEffect, useRef, useState } from "react";
import { createTiltGuard } from "@/lib/tilt";
import { useMediaQuery } from "@/lib/use-media-query";

type OrientationPermission = { requestPermission?: () => Promise<"granted" | "denied"> };

/** iOS asks before a page can read the device's orientation, and only from a tap. Elsewhere there's nothing to ask. */
const askForPermission = () =>
  typeof DeviceOrientationEvent === "undefined" ? undefined : (DeviceOrientationEvent as unknown as OrientationPermission).requestPermission;

/**
 * The privacy screen on a judge's phone or tablet while judging, unless the organizer turned it off in Settings: turning
 * the screen away from the judge (toward a neighbour, away from them, or face up on the table) hides it behind a blur
 * until it's turned back, or the judge carries on where it is (see createTiltGuard). The device's orientation is read
 * on the device only: nothing about it is sent. Where the browser asks first (iOS), a banner offers to turn it on.
 */
export function PrivacyScreen({ active }: { active: boolean }) {
  // Phones and tablets: a laptop on the judges' table has no sensor to read, and no one tilts it.
  const touch = useMediaQuery("(pointer: coarse)");
  const on = active && touch;
  // Where the browser asks first: null until the judge has answered.
  const [allowed, setAllowed] = useState<boolean | null>(null);
  const [hidden, setHidden] = useState(false);
  const guard = useRef<ReturnType<typeof createTiltGuard> | null>(null);
  const asks = typeof askForPermission() === "function";

  // Where the browser asks first, asked straight away: some answer without a tap (Chrome on Android). iOS needs one, so
  // it refuses here, and the banner below asks.
  useEffect(() => {
    if (!on || !asks || allowed !== null) return;
    let stopped = false;
    askForPermission()?.()
      .then((answer) => {
        if (!stopped && answer === "granted") setAllowed(true);
      })
      .catch(() => {});
    return () => {
      stopped = true;
    };
  }, [on, asks, allowed]);

  useEffect(() => {
    if (!on || typeof DeviceOrientationEvent === "undefined" || (asks && !allowed)) return;
    // Where the judge holds it now is where it's held: a fresh start each time judging (re)opens.
    const tilt = createTiltGuard();
    guard.current = tilt;
    const onReading = (e: DeviceOrientationEvent) => setHidden(tilt.reading(e.alpha, e.beta, e.gamma, e.timeStamp));
    window.addEventListener("deviceorientation", onReading);
    return () => {
      window.removeEventListener("deviceorientation", onReading);
      guard.current = null;
      // Judging closed (or the option was turned off): nothing stays hidden.
      setHidden(false);
    };
  }, [on, asks, allowed]);

  const ask = async () => {
    const answer = await askForPermission()?.().catch(() => "denied" as const);
    setAllowed(answer === "granted");
  };

  return (
    <>
      {on && asks && allowed === null && (
        // In the page, under the header, so it never covers the keypad or a signature box.
        <div className="mx-4 mt-3 flex shrink-0 items-center gap-3 rounded-xl bg-mint px-4 py-3 text-prussian sm:mx-6">
          <p className="min-w-0 flex-1 text-sm">Turn on the privacy screen: it hides your screen when your device is turned away from you.</p>
          <button type="button" onClick={ask} className="btn btn-sm shrink-0 bg-prussian text-mint hover:bg-regal">
            Turn on
          </button>
        </div>
      )}
      {on && hidden && (
        <div
          role="alert"
          className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-3 bg-prussian/90 px-8 text-center text-mint backdrop-blur-2xl"
        >
          <svg viewBox="0 0 24 24" className="size-12 text-powder" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden>
            <path d="M3 3l18 18M10.6 5.1A10.9 10.9 0 0 1 12 5c5 0 9 4.5 10 7a13.7 13.7 0 0 1-3.2 4.3M6.6 6.6C4.3 8 2.7 10.2 2 12c1 2.5 5 7 10 7 1.9 0 3.6-.6 5.1-1.5M9.9 9.9a3 3 0 0 0 4.2 4.2" />
          </svg>
          <p className="text-2xl font-bold">Privacy screen</p>
          <p className="max-w-xs text-powder">Turn your device back toward you to see your screen.</p>
          <button
            type="button"
            onClick={() => {
              guard.current?.hold();
              setHidden(false);
            }}
            className="btn mt-3 border border-oxford text-mint hover:bg-oxford"
          >
            Carry on in this position
          </button>
        </div>
      )}
    </>
  );
}
