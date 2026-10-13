"use client";

import { useState, useTransition } from "react";
import { basisWeights, partsOf, programOrder } from "@/lib/pageant";
import { checkPageant, draftFromRounds, segmentLabel, shareScope, type PageantDraft } from "@/lib/pageant-setup";
import { reach } from "@/lib/reach";
import { formatBound, rulesSummary } from "@/lib/scoring";
import type { ActionResult, Board, Round } from "@/lib/types";
import { savePageant } from "../../actions";
import { FormMessage } from "../form-message";
import { SegmentEditor } from "../program-editor";

const percent = (n: number) => `${formatBound(Math.round(n * 100) / 100)}%`;

/** A sub-activity's timer, as set up: read-only once the session has started. */
function timerLine(round: Round): string | null {
  return round.timerSeconds === null ? null : `Judges get ${round.timerSeconds} seconds to score each candidate.`;
}

/**
 * The program once the session has started, and after it ends: what each sub-activity counts for, its scoring,
 * timer and cut, read-only. During the show the desk can still give judges more time.
 */
function LockedProgram({ board }: { board: Board }) {
  const { activity } = board;
  const order = programOrder(board.rounds);
  // Shares as the setup has them (programs saved under older rules fitted to today's), and what each is a share of.
  const program = draftFromRounds(activity.preliminaryWeight, board.rounds, activity.violations);
  const shares = new Map(program.rounds.flatMap((r) => [[r.key, r.weight] as const, ...(r.parts ?? []).map((p) => [p.key, p.weight] as const)]));
  const share = (r: Round, top: Round, overall = "") => {
    const scope = shareScope(program.rounds, { key: top.id, segment: top.segment }).replace(/^of the (overall )?score/, "");
    return `${percent(Number(shares.get(r.id) ?? r.weight))}${scope || overall}`;
  };
  return (
    <>
      <p role="note" className="note mt-3">
        {activity.sessionState === "ended" ? "Judging has ended" : "The session has started"}, so the program is final and can&apos;t be changed.
        {activity.sessionState === "live" && " To give judges more time while a candidate is up, use the session desk."}
      </p>
      {(["preliminary", "proper"] as const).map((segment) => (
        <section key={segment} className="mt-6">
          <h3 className="font-bold">
            {segmentLabel(segment)}, {percent(segment === "preliminary" ? activity.preliminaryWeight : 100 - activity.preliminaryWeight)} of the overall score
          </h3>
          <ol className="mt-2 divide-y divide-line border-y border-line">
            {order
              .filter((r) => r.segment === segment)
              .map((r) => (
                <li key={r.id} className="space-y-2 py-4">
                  <p>
                    <span className="font-semibold">{r.name}</span> <span className="tabular hint">{share(r, r)}</span>
                  </p>
                  {partsOf(board.rounds, r.id).length === 0 ? (
                    <>
                      <p className="hint">{rulesSummary(r)}</p>
                      {timerLine(r) && <p className="hint">{timerLine(r)}</p>}
                    </>
                  ) : (
                    <ol aria-label={`Parts of ${r.name}`} className="space-y-3 border-l-2 border-line pl-4">
                      {partsOf(board.rounds, r.id).map((part) => (
                        <li key={part.id} className="space-y-1.5">
                          <p>
                            <span className="font-semibold">{part.name}</span> <span className="tabular hint">{share(part, r, " of the overall score")}</span>
                          </p>
                          <p className="hint">{rulesSummary(part)}</p>
                          {timerLine(part) && <p className="hint">{timerLine(part)}</p>}
                        </li>
                      ))}
                    </ol>
                  )}
                  {r.cutSize !== null && (
                    <p className="rounded-lg bg-wash/60 px-3 py-2 text-sm">
                      <span className="font-semibold">Cut: Top {r.cutSize}</span>, ranked by{" "}
                      {basisWeights(board.rounds, activity.preliminaryWeight, r.cutBasis)
                        .map((w) => `${w.round.name} ${percent(w.weight)}`)
                        .join(", ")}
                      {r.cutEntryIds ? ". Confirmed." : "."}
                    </p>
                  )}
                </li>
              ))}
          </ol>
          {segment === "preliminary" && activity.violations !== null && (
            <p className="mt-3 text-sm">
              <span className="font-semibold">Deductions for violations</span>, points off the preliminary score:{" "}
              {activity.violations.length
                ? `${activity.violations.map((v) => `${v.reason} (${formatBound(v.points)} ${v.points === 1 ? "point" : "points"})`).join(", ")}, or another with its reason typed at the desk.`
                : "each with its reason typed at the desk."}
            </p>
          )}
        </section>
      ))}
    </>
  );
}

/**
 * A pageant's program: the preliminary's share of the overall score, and each segment's sub-activities with their
 * scoring, timers and cuts. Editable until the session starts.
 */
export function SegmentsTab({ board }: { board: Board }) {
  const { activity } = board;
  const [draft, setDraft] = useState<PageantDraft>(() => draftFromRounds(activity.preliminaryWeight, board.rounds, activity.violations));
  const [result, setResult] = useState<ActionResult | null>(null);
  const [pending, start] = useTransition();

  if (activity.sessionState !== "draft") {
    return (
      <div className="max-w-3xl">
        <h2 className="text-xl font-bold">Segments</h2>
        <LockedProgram board={board} />
      </div>
    );
  }

  const save = () =>
    start(async () => {
      const checked = checkPageant(draft, board.entries.length, () => "");
      if (!checked.ok) {
        setResult({ ok: false, error: checked.error });
        return;
      }
      setResult(await reach(() => savePageant(activity.id, JSON.stringify(draft))));
    });

  return (
    <div className="max-w-4xl">
      <h2 className="text-xl font-bold">Segments</h2>
      <p className="hint mt-1 max-w-2xl">Change the program until the session starts. After that it&apos;s locked, so nobody&apos;s scores change meaning.</p>
      <section aria-labelledby="segment-preliminary" className="mt-6">
        <h3 id="segment-preliminary" className="mb-3 text-lg font-bold">
          Preliminary
        </h3>
        <SegmentEditor segment="preliminary" draft={draft} onChange={setDraft} />
      </section>
      <section aria-labelledby="segment-proper" className="mt-10">
        <h3 id="segment-proper" className="mb-3 text-lg font-bold">
          Pageant proper
        </h3>
        <SegmentEditor segment="proper" draft={draft} onChange={setDraft} candidates={board.entries.length} />
      </section>
      <div className="mt-8 flex flex-wrap items-center gap-4 border-t border-line pt-6">
        <button type="button" className="btn btn-primary" onClick={save} disabled={pending}>
          {pending ? "Saving…" : "Save program"}
        </button>
        <FormMessage state={result} />
      </div>
    </div>
  );
}
