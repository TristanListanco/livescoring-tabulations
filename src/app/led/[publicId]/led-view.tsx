"use client";

import { FitStage } from "@/components/led/fit-stage";
import { LedGraphic } from "@/components/led/led-graphic";
import type { Board } from "@/lib/types";
import { useLiveRefresh } from "@/lib/use-live-refresh";

/** Full-screen output for the LED wall or video switcher. No chrome, no cursor: just the graphic on green. */
export function LedView({ board }: { board: Board }) {
  useLiveRefresh(board.activity.id);
  return (
    <main className="fixed inset-0 cursor-none">
      <FitStage className="h-full w-full">
        <LedGraphic board={board} ranked={board.activity.showRank} />
      </FitStage>
    </main>
  );
}
