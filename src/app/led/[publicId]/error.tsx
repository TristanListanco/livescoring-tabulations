"use client";

import { useSyncExternalStore } from "react";
import { OperatorPanel, useOperatorAwake } from "@/components/led/operator-panel";
import { useAutoRetry } from "@/components/reconnecting";
import { KEY_GREEN, LED_MODE } from "@/lib/led";

/**
 * The LED wall, when it couldn't load. It's on air, so nothing shows: the key colour (which the video switcher takes
 * out, so the camera shot shows through) or, on a full-screen wall, its plain background. It reconnects by itself.
 * Someone at its computer who moves the mouse or presses a key is told so, which tells this apart from a working wall
 * that's waiting for its first entry.
 */
export default function LedError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  useAutoRetry(retry, error);
  const fullscreen = useSyncExternalStore(noUpdates, lastShownFullscreen, () => false);
  const awake = useOperatorAwake();
  return (
    <main className={`fixed inset-0 ${awake ? "" : "cursor-none"} ${fullscreen ? "bg-prussian" : ""}`} style={fullscreen ? undefined : { backgroundColor: KEY_GREEN }}>
      <p role="status" className="sr-only">
        Reconnecting
      </p>
      {awake && (
        <OperatorPanel>
          <p className="inline-flex items-center gap-2 font-semibold">
            <span aria-hidden className="size-2.5 shrink-0 rounded-full bg-danger-soft" />
            Can&apos;t reach Tabulous. Trying again by itself.
          </p>
        </OperatorPanel>
      )}
    </main>
  );
}

const noUpdates = () => () => {};
const lastShownFullscreen = () => {
  try {
    return sessionStorage.getItem(LED_MODE) === "full";
  } catch {
    return false;
  }
};
