"use client";

import { useState, useTransition } from "react";
import { reach } from "@/lib/reach";
import type { Activity, ActionResult } from "@/lib/types";
import { setShowRank } from "../../actions";
import { FormMessage } from "../form-message";
import { toastSaved } from "../toaster";
import { Switch } from "../switch";

/**
 * Ranks on or off on the public live results page, with the activity's other settings (on unless turned off): the
 * entries sorted by average, the top three standing out, or kept in running order. Saved at once, with a toast.
 */
export function RankingSwitch({ activity, editable = true }: { activity: Activity; editable?: boolean }) {
  const [on, setOn] = useState(activity.showRank);
  const [result, setResult] = useState<ActionResult | null>(null);
  const [pending, startTransition] = useTransition();

  const toggle = () => {
    const next = !on;
    setOn(next);
    startTransition(async () => {
      const r = toastSaved(await reach(() => setShowRank(activity.id, next)));
      setResult(r);
      if (!r.ok) setOn(!next);
    });
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-4">
        <Switch checked={on} onChange={toggle} labelledBy="rank-label" disabled={pending || !editable} />
        <p id="rank-label" className="font-semibold">
          Show ranks on the live results page
        </p>
        {!editable && <span className="ml-auto shrink-0 text-sm text-prussian/70">Locked</span>}
      </div>
      <p className="hint pl-16">
        Ranked by average once every judge has scored, the top three standing out; those still being scored follow. Off, the entries stay
        in running order.
      </p>
      <FormMessage state={result?.ok ? null : result} small className="pl-16" />
    </div>
  );
}
