"use client";

import { useEffect, useState } from "react";

/** How long the operator's panel stays up after the last mouse move, tap or key. */
const AWAKE_MS = 4_000;

/**
 * Whether someone is at the LED wall's computer: true from a mouse move, tap or key press until four seconds after the
 * last one. The wall is on air, so anything that isn't the graphic shows only while they are.
 */
export function useOperatorAwake(): boolean {
  const [awake, setAwake] = useState(false);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const wake = () => {
      setAwake(true);
      clearTimeout(timer);
      timer = setTimeout(() => setAwake(false), AWAKE_MS);
    };
    window.addEventListener("pointermove", wake);
    window.addEventListener("pointerdown", wake);
    window.addEventListener("keydown", wake);
    return () => {
      clearTimeout(timer);
      window.removeEventListener("pointermove", wake);
      window.removeEventListener("pointerdown", wake);
      window.removeEventListener("keydown", wake);
    };
  }, []);
  return awake;
}

/**
 * For the person at the LED wall's computer, never the audience: what the wall is doing (`children`: connected and
 * showing an entry, waiting for the first one, or failing to load) and a button to go full screen. An idle wall and a
 * dead one are both plain green on air, so this is how to tell them apart. Show it while useOperatorAwake is true.
 */
export function OperatorPanel({ children }: { children: React.ReactNode }) {
  const [full, setFull] = useState(false);
  useEffect(() => {
    const update = () => setFull(!!document.fullscreenElement);
    update();
    document.addEventListener("fullscreenchange", update);
    return () => document.removeEventListener("fullscreenchange", update);
  }, []);
  // Feature-detected: some browsers (and embedded webviews) have no full screen.
  const canFull = typeof document !== "undefined" && document.fullscreenEnabled;
  const toggle = () => {
    const change = full ? document.exitFullscreen() : document.documentElement.requestFullscreen();
    change.catch(() => {});
  };
  return (
    <div className="fixed top-4 right-4 z-50 flex max-w-[calc(100vw-2rem)] flex-wrap items-center gap-x-5 gap-y-2 rounded-xl bg-prussian px-4 py-3 text-sm text-mint shadow-[0_8px_28px_rgb(0_0_0/0.35)]">
      {children}
      {canFull && (
        <button type="button" onClick={toggle} className="btn btn-sm bg-mint text-prussian hover:bg-white">
          {full ? "Exit full screen" : "Full screen"}
        </button>
      )}
    </div>
  );
}
