"use client";

import { useState, useTransition } from "react";
import { reach } from "@/lib/reach";
import type { Activity, ActionResult } from "@/lib/types";
import { setShowRank } from "../../actions";
import { FormMessage } from "../form-message";
import { Switch } from "../switch";

/** Ranks on or off on the public live results page: something an organizer flips during the show, before the reveal. */
export function RankingSwitch({ activity, compact = false }: { activity: Activity; compact?: boolean }) {
  const [on, setOn] = useState(activity.showRank);
  const [result, setResult] = useState<ActionResult | null>(null);
  const [pending, startTransition] = useTransition();

  const toggle = () => {
    const next = !on;
    setOn(next);
    startTransition(async () => {
      const r = await reach(() => setShowRank(activity.id, next));
      setResult(r);
      if (!r.ok) setOn(!next);
    });
  };

  return (
    <div className="space-y-2">
      <div className={`flex items-center ${compact ? "gap-3" : "gap-4"}`}>
        <Switch checked={on} onChange={toggle} labelledBy="rank-label" disabled={pending} />
        {/* The live desk's narrow column shows the short label; the switch's name stays the full sentence. */}
        <p id="rank-label" className="font-semibold">
          Show ranks
          <span className={compact ? "sr-only" : undefined}> on the live results page</span>
        </p>
      </div>
      <FormMessage state={result} small />
    </div>
  );
}
