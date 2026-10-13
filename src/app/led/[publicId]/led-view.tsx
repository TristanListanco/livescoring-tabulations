"use client";

import { LedOutput } from "@/components/led/led-graphic";
import type { Board } from "@/lib/types";
import { useLiveRefresh } from "@/lib/use-live-refresh";

/** Full-screen output for the LED wall or video switcher. No chrome, no cursor: just the graphic. */
export function LedView({ board }: { board: Board }) {
  // The wall is on air: it follows changes at once, like the judges' screens.
  useLiveRefresh(board.activity.id);
  return (
    <main className="fixed inset-0 cursor-none">
      <LedOutput board={board} className="h-full w-full" />
    </main>
  );
}
