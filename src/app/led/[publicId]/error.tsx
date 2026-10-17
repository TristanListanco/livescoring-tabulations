"use client";

import { useSyncExternalStore } from "react";
import { useAutoRetry } from "@/components/reconnecting";
import { KEY_GREEN, LED_MODE } from "@/lib/led";

/**
 * The LED wall, when it couldn't load. It's on air, so nothing shows: the key colour (which the video switcher takes
 * out, so the camera shot shows through) or, on a full-screen wall, its plain background. It reconnects by itself.
 */
export default function LedError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  useAutoRetry(retry, error);
  const fullscreen = useSyncExternalStore(noUpdates, lastShownFullscreen, () => false);
  return (
    <main className={`fixed inset-0 cursor-none ${fullscreen ? "bg-prussian" : ""}`} style={fullscreen ? undefined : { backgroundColor: KEY_GREEN }}>
      <p role="status" className="sr-only">
        Reconnecting
      </p>
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
