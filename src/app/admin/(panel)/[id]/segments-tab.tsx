"use client";

import { useState, useTransition } from "react";
import { basisWeights, programOrder } from "@/lib/pageant";
import { checkPageant, draftFromRounds, segmentLabel, type PageantDraft } from "@/lib/pageant-setup";
import { reach } from "@/lib/reach";
import { formatBound, rulesSummary } from "@/lib/scoring";
import type { ActionResult, Board, Round } from "@/lib/types";
import { savePageant, setRoundTimer } from "../../actions";
import { FormMessage } from "../form-message";
import { SegmentEditor } from "../program-editor";

const percent = (n: number) => `${formatBound(Math.round(n * 100) / 100)}%`;

/** A sub-activity's timer, which can change at any time, even mid-show. */
function TimerSetting({ round }: { round: Round }) {
  const [value, setValue] = useState(round.timerSeconds === null ? "" : String(round.timerSeconds));
  const [result, setResult] = useState<ActionResult | null>(null);
  const [pending, start] = useTransition();
  const save = (seconds: number | null) =>
    start(async () => {
      const r = await reach(() => setRoundTimer(round.id, seconds));
      setResult(r);
      if (r.ok && seconds === null) setValue("");
    });
  const id = `timer-${round.id}`;
  return (
    <form
      className="flex flex-wrap items-center gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        save(value === "" ? null : Number(value));
      }}
    >
      <label htmlFor={id} className="text-sm">
        Seconds to score<span className="sr-only"> each candidate in {round.name}</span>
      </label>
      <input
        id={id}
        value={value}
        onChange={(e) => setValue(e.target.value.replace(/[^0-9]/g, "").slice(0, 4))}
        inputMode="numeric"
        placeholder="Off"
        className="field tabular h-9 w-20"
      />
      <button type="submit" className="btn btn-quiet btn-sm" disabled={pending}>
        Save<span className="sr-only"> timer for {round.name}</span>
      </button>
      {round.timerSeconds !== null && (
        <button type="button" className="btn btn-sm text-prussian/80 hover:bg-wash" onClick={() => save(null)} disabled={pending}>
          Turn off<span className="sr-only"> the timer for {round.name}</span>
        </button>
      )}
      <FormMessage state={result} small />
    </form>
  );
}

/** The program once the session has started: what each sub-activity counts for, and its timer. */
function LockedProgram({ board }: { board: Board }) {
  const { activity } = board;
  const order = programOrder(board.rounds);
  return (
    <>
      <p role="note" className="note mt-3">
        The session has started, so the program is locked. Timers can still change.
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
                    <span className="font-semibold">{r.name}</span> <span className="tabular hint">{percent(r.weight)}</span>
                  </p>
                  <p className="hint">{rulesSummary(r)}</p>
                  <TimerSetting round={r} />
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
  const [draft, setDraft] = useState<PageantDraft>(() => draftFromRounds(activity.preliminaryWeight, programOrder(board.rounds)));
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
        <SegmentEditor segment="proper" draft={draft} onChange={setDraft} />
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
