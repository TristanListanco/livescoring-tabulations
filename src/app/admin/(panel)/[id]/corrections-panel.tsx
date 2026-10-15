"use client";

import { useState, useTransition } from "react";
import type { CorrectionView } from "@/lib/corrections";
import type { ActionResult } from "@/lib/types";
import { decideCorrection } from "../../actions";

const settledLabel: Record<Exclude<CorrectionView["status"], "open">, string> = {
  approved: "Corrected",
  rejected: "Turned down",
  withdrawn: "Withdrawn",
};

/**
 * Score corrections for the organizer: each open one with how the vote stands, and the settled ones under it. The
 * judges decide them; only a judge alone on their panel, with no one to agree, needs the organizer to approve or turn
 * it down. `onDark`: on the control desk.
 */
export function CorrectionsPanel({ activityId, corrections, onDark = false }: { activityId: string; corrections: CorrectionView[]; onDark?: boolean }) {
  const open = corrections.filter((c) => c.status === "open");
  const settled = corrections.filter((c) => c.status !== "open").reverse();
  if (corrections.length === 0) return null;
  const muted = onDark ? "text-powder" : "text-prussian/75";
  return (
    <section
      aria-label="Score corrections"
      className={onDark ? "shrink-0 border-t border-oxford px-6 py-3" : "rounded-2xl border border-line bg-white/60 px-5 py-4"}
    >
      <h2 className={`text-sm font-semibold ${muted}`}>
        Score corrections{open.length > 0 && <span className={onDark ? "text-mint" : "text-prussian"}> · {open.length} waiting</span>}
      </h2>
      {open.length > 0 && (
        <ul className="mt-2 space-y-2">
          {open.map((c) => (
            <OpenCorrection key={c.id} activityId={activityId} correction={c} onDark={onDark} />
          ))}
        </ul>
      )}
      {settled.length > 0 && (
        <details className="mt-2">
          <summary className={`tap-target cursor-pointer text-sm font-semibold ${onDark ? "text-mint" : "text-regal"}`}>
            {settled.length} settled
          </summary>
          <ul className="mt-2 space-y-1.5 text-sm">
            {settled.map((c) => (
              <li key={c.id}>
                <span className="font-semibold">{settledLabel[c.status as Exclude<CorrectionView["status"], "open">]}:</span> {c.judgeName}, No. {c.entryNumber}{" "}
                {c.entryName}
                {c.roundName && ` (${c.roundName})`}, <span className="tabular whitespace-nowrap">{c.from}</span> to <span className="tabular whitespace-nowrap">{c.to}</span>
                <span className={muted}>
                  {c.status === "approved" && (c.decidedBy === "organizer" ? ". Approved by the organizer." : ". Every other judge agreed.")}
                  {c.status === "rejected" && (c.decidedBy === "organizer" ? ". Turned down by the organizer." : ". A judge disagreed.")}
                </span>
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}

function OpenCorrection({ activityId, correction: c, onDark }: { activityId: string; correction: CorrectionView; onDark: boolean }) {
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<ActionResult | null>(null);
  const lone = c.voters === 0;
  const decide = (approve: boolean) =>
    startTransition(async () => {
      setResult(await decideCorrection(activityId, c.id, approve).catch(() => ({ ok: false as const, error: "That didn't go through. Try again." })));
    });
  return (
    <li className={`rounded-xl px-4 py-3 ${onDark ? "bg-oxford" : "bg-wash"}`}>
      <p className="font-semibold">
        {c.judgeName} asks to change their score for No. {c.entryNumber} {c.entryName}
        {c.roundName && ` (${c.roundName})`}: <span className="tabular whitespace-nowrap">{c.from}</span> to <span className="tabular whitespace-nowrap">{c.to}</span>
      </p>
      <p className={`mt-0.5 text-sm ${onDark ? "text-powder" : "text-prussian/75"}`}>
        &ldquo;{c.reason}&rdquo;{" "}
        {lone
          ? "No other judge is on their panel, so you decide."
          : `${c.agreed} of ${c.voters} ${c.voters === 1 ? "judge has" : "judges have"} agreed; it changes only if every one of them does.`}
      </p>
      {lone && (
        <div className="mt-2 flex flex-wrap gap-2">
          <button
            type="button"
            disabled={pending}
            onClick={() => decide(true)}
            className={`btn btn-sm ${onDark ? "bg-mint text-prussian hover:bg-white" : "btn-primary"}`}
          >
            Approve the correction
          </button>
          <button
            type="button"
            disabled={pending}
            onClick={() => decide(false)}
            className={`btn btn-sm ${onDark ? "border border-regal text-mint hover:bg-regal" : "btn-quiet"}`}
          >
            Turn it down
          </button>
        </div>
      )}
      {result && !result.ok && (
        <p role="alert" className={`mt-2 text-sm font-semibold ${onDark ? "text-danger-soft" : "text-danger"}`}>
          {result.error}
        </p>
      )}
    </li>
  );
}
