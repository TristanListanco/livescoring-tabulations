"use client";

import { useEffect } from "react";
import { LedOutput } from "@/components/led/led-graphic";
import { LED_MODE } from "@/lib/led";
import type { Board } from "@/lib/types";
import { useLiveRefresh } from "@/lib/use-live-refresh";

/** Full-screen output for the LED wall or video switcher. No chrome, no cursor: just the graphic. */
export function LedView({ board }: { board: Board }) {
  // The wall is on air: it follows changes at once, like the judges' screens.
  // On air: a notice that doesn't arrive is put right within 3 seconds.
  useLiveRefresh(board.activity.id, { pollMs: 3_000 });
  // Remembered for its error screen, which then shows the same kind of background (see error.tsx).
  const mode = board.activity.ledFullscreen ? "full" : "key";
  useEffect(() => {
    try {
      sessionStorage.setItem(LED_MODE, mode);
    } catch {}
  }, [mode]);
  return (
    <main className="fixed inset-0 cursor-none">
      <LedOutput board={board} className="h-full w-full" />
    </main>
  );
}
