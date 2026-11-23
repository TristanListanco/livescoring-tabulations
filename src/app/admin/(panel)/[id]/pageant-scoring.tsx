"use client";

import { useId, useState } from "react";
import { judgingOrder, roundLabel, unitOf } from "@/lib/pageant";
import { segmentLabel } from "@/lib/pageant-setup";
import { formatBound, rangeLabel } from "@/lib/scoring";
import type { Criterion, Round } from "@/lib/types";

/** Criteria with their points, and the 100 they add up to. */
export function CriteriaTable({ criteria }: { criteria: Criterion[] }) {
  return (
    <table className="w-full max-w-sm text-left">
      <thead className="sr-only">
        <tr>
          <th scope="col">Criterion</th>
          <th scope="col">Max points</th>
        </tr>
      </thead>
      <tbody className="tabular">
        {criteria.map((c) => (
          <tr key={c.id} className="border-b border-line">
            <td className="py-1.5 pr-4">{c.name}</td>
            <td className="py-1.5 text-right">{c.min ? `${formatBound(c.min)} to ${formatBound(c.max)}` : formatBound(c.max)}</td>
          </tr>
        ))}
      </tbody>
      <tfoot className="tabular font-semibold text-prussian">
        <tr>
          <th scope="row" className="pt-1.5 pr-4 font-semibold">
            Total
          </th>
          <td className="pt-1.5 text-right">100</td>
        </tr>
      </tfoot>
    </table>
  );
}

/**
 * A pageant's scoring, one sub-activity (or part) at a time: chosen from the program, in its order, and shown as an
 * event's is (its range or its criteria, decimal places, timer), with how its results come out. In Settings, and on
 * the Session tab, where it starts on the sub-activity on judges' screens (`initialId`). `compact`: the live desk's
 * narrow column, terms over their values.
 */
export function PageantScoring({
  rounds,
  initialId,
  compact = false,
  edit,
}: {
  rounds: Round[];
  initialId?: string;
  compact?: boolean;
  /**
   * In Settings: the controls for what can still change of the one shown (its decimal places and how its totals show),
   * or null once it's fixed. Shown under the rest, in place of those rows.
   */
  edit?: (round: Round) => React.ReactNode;
}) {
  const id = useId();
  const judged = judgingOrder(rounds);
  const [chosen, setChosen] = useState(initialId ?? judged[0]?.id ?? "");
  // A sub-activity judged candidate by candidate is on screens as a whole: its first part.
  const round = judged.find((r) => r.id === chosen) ?? judged.find((r) => r.parentId === chosen) ?? judged[0];
  if (!round) return null;
  const places = (n: number) => (n === 0 ? "Whole numbers" : `${n} decimal place${n > 1 ? "s" : ""}`);
  const criteria = round.scoringMode === "criteria";
  const editor = edit?.(round) ?? null;
  const rows: [string, React.ReactNode][] = [
    ["Method", criteria ? "Criteria" : `Simple, scores from ${rangeLabel(round)}`],
    ...(criteria ? ([["Criteria", <CriteriaTable key="criteria" criteria={round.criteria} />]] as [string, React.ReactNode][]) : []),
    ...(editor ? [] : ([[criteria ? "Judges give points in" : "Judges score with", places(round.decimals)]] as [string, React.ReactNode][])),
    ...(criteria && !editor ? ([["Totals shown", round.criteriaDisplay === "ten" ? "Scaled to 10" : "As a percentage"]] as [string, React.ReactNode][]) : []),
    ["Time limit", round.timerSeconds ? `${round.timerSeconds} seconds per candidate` : "None"],
    ...(unitOf(rounds, round).candidateOrder ? ([["Judging order", "Candidate by candidate, each scored on every part"]] as [string, React.ReactNode][]) : []),
    [
      "Results",
      round.liveScoring
        ? `Live, as each score comes in${round.ledOutOfTen ? "; out of 10 on the LED wall" : ""}`
        : round.independentScoring
          ? "After a deliberation; judges score at their own pace"
          : "After a deliberation",
    ],
  ];
  return (
    <div>
      <label htmlFor={`${id}-round`} className="label">
        Scoring of
      </label>
      <select id={`${id}-round`} className="field max-w-sm" value={round.id} onChange={(e) => setChosen(e.target.value)}>
        {(["preliminary", "proper"] as const).map((segment) => (
          <optgroup key={segment} label={segmentLabel(segment)}>
            {judged
              .filter((r) => r.segment === segment)
              .map((r) => (
                <option key={r.id} value={r.id}>
                  {roundLabel(rounds, r)}
                </option>
              ))}
          </optgroup>
        ))}
      </select>
      <dl aria-live="polite" className={compact ? "mt-3 space-y-2" : "mt-4 grid gap-x-8 gap-y-3 sm:grid-cols-[11rem_1fr]"}>
        {rows.map(([term, value]) => (
          <div key={term} className={compact ? "" : "contents"}>
            <dt className={compact ? "text-xs font-semibold text-prussian/70" : "font-semibold"}>{term}</dt>
            <dd className="text-prussian/80">{value}</dd>
          </div>
        ))}
      </dl>
      {editor}
    </div>
  );
}
