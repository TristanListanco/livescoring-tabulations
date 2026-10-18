"use client";

import { useEffect } from "react";
import { LedOutput } from "@/components/led/led-graphic";
import { OperatorPanel, useOperatorAwake } from "@/components/led/operator-panel";
import { LiveStatusBadge } from "@/components/live-status";
import { LED_MODE } from "@/lib/led";
import type { Board } from "@/lib/types";
import { showingBoard } from "@/lib/pageant";
import { useLiveRefresh } from "@/lib/use-live-refresh";

/**
 * Full-screen output for the LED wall or video switcher. No chrome, no cursor: just the graphic, until someone at its
 * computer moves the mouse, taps or presses a key, which shows them whether it's connected and what it's showing.
 */
export function LedView({ board }: { board: Board }) {
  // The wall is on air: it follows changes at once, like the judges' screens.
  // On air: a notice that doesn't arrive is put right within 3 seconds.
  const status = useLiveRefresh(board.activity.id, { pollMs: 3_000 });
  const awake = useOperatorAwake();
  // Remembered for its error screen, which then shows the same kind of background (see error.tsx).
  const mode = board.activity.ledFullscreen ? "full" : "key";
  useEffect(() => {
    try {
      sessionStorage.setItem(LED_MODE, mode);
    } catch {}
  }, [mode]);
  const shown = showingBoard(board).board;
  const onWall = shown.entries.find((e) => e.id === shown.activity.ledEntryId);
  const noun = board.activity.kind === "pageant" ? "candidate" : "entry";
  return (
    <main className={`fixed inset-0 ${awake ? "" : "cursor-none"}`}>
      <LedOutput board={board} className="h-full w-full" />
      {awake && (
        <OperatorPanel>
          <LiveStatusBadge status={status} labels={{ live: "Connected", polling: "Updating every 3 seconds" }} className="text-mint" />
          <p>{onWall ? `Showing ${onWall.name}` : `Ready: the first ${noun} shows here when the organizer shows it`}</p>
        </OperatorPanel>
      )}
    </main>
  );
}
