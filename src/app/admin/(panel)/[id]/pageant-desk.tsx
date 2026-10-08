"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { TimerBar, useScoringTimer } from "@/components/scoring-timer";
import { cutPlan, programOrder, roundPool, roundProgress, type CutPlan, type TieGroup } from "@/lib/pageant";
import { segmentLabel } from "@/lib/pageant-setup";
import { reach } from "@/lib/reach";
import { formatBound } from "@/lib/scoring";
import type { ActionResult, Activity, Board, Round } from "@/lib/types";
import { confirmCut, extendScoring, setCurrentRound, undoCut } from "../../actions";
import { FormMessage } from "../form-message";

const ordinal = (n: number) => {
  const suffix = n % 100 >= 11 && n % 100 <= 13 ? "th" : ["th", "st", "nd", "rd"][n % 10] ?? "th";
  return `${n}${suffix}`;
};
/** A weight or share: "30%", "33.33%". */
const percent = (n: number) => `${formatBound(Math.round(n * 100) / 100)}%`;
const cutName = (plan: Pick<CutPlan, "final" | "round" | "size">) => (plan.final ? "the final cut" : `the Top ${plan.size}`);

/** A pageant results PDF. The time zone goes along so the sheet's printed time matches the venue's clock. */
export function PdfLink({ activityId, query, className, children }: { activityId: string; query: string; className: string; children: React.ReactNode }) {
  const href = `/admin/${activityId}/export?${query}`;
  return (
    <a
      href={href}
      onClick={(e) => {
        e.currentTarget.href = `${href}&tz=${encodeURIComponent(Intl.DateTimeFormat().resolvedOptions().timeZone)}`;
      }}
      className={className}
      download
    >
      {children}
    </a>
  );
}

/** What comes after the sub-activity being judged: its cut, if it's still to confirm, or the next sub-activity. */
export function nextUp(board: Board, round: Round | null): { kind: "cut"; round: Round } | { kind: "round"; round: Round } | null {
  const order = programOrder(board.rounds);
  if (round && round.cutSize !== null && round.cutEntryIds === null) return { kind: "cut", round };
  if (!round) {
    // Between sub-activities: the first one not done yet, or the cut holding it back.
    for (const r of order) {
      if (roundProgress(board, r).complete) {
        if (r.cutSize !== null && r.cutEntryIds === null) return { kind: "cut", round: r };
        continue;
      }
      const { blockedBy } = roundPool(board, r.id);
      return blockedBy ? { kind: "cut", round: blockedBy } : { kind: "round", round: r };
    }
    return null;
  }
  const next = order[order.findIndex((r) => r.id === round.id) + 1];
  return next ? { kind: "round", round: next } : null;
}

/** Switch judging to a sub-activity, asking first when the one being judged still has scores to come. */
export function JudgeRoundButton({
  board,
  round,
  label,
  className,
  onDone,
}: {
  board: Board;
  round: Round;
  label: React.ReactNode;
  className: string;
  onDone?: (result: ActionResult) => void;
}) {
  const { activity } = board;
  const current = board.rounds.find((r) => r.id === activity.currentRoundId) ?? null;
  const go = async () => {
    const result = await reach(() => setCurrentRound(activity.id, round.id));
    onDone?.(result);
    return result;
  };
  const progress = current ? roundProgress(board, current) : null;
  const missing = progress && !progress.complete ? progress.possible - progress.submitted : 0;
  if (!current || missing === 0) {
    return <InstantButton label={label} className={className} onClick={go} />;
  }
  return (
    <ConfirmDialog triggerLabel={label} triggerClassName={className} title={`Judge ${round.name} now?`} confirmLabel={`Judge ${round.name}`} onConfirm={go}>
      {current.name} still has {missing} {missing === 1 ? "score" : "scores"} to come. Judges&apos; screens will switch to {round.name}, and you can come
      back to {current.name} later.
    </ConfirmDialog>
  );
}

function InstantButton({ label, className, onClick }: { label: React.ReactNode; className: string; onClick: () => Promise<ActionResult> }) {
  const [pending, start] = useTransition();
  return (
    <button type="button" className={className} disabled={pending} onClick={() => start(async () => void (await onClick()))}>
      {label}
    </button>
  );
}

const scissors = (
  <svg viewBox="0 0 16 16" className="size-4 shrink-0" aria-hidden>
    <circle cx="4" cy="4" r="2" fill="none" stroke="currentColor" strokeWidth="1.5" />
    <circle cx="4" cy="12" r="2" fill="none" stroke="currentColor" strokeWidth="1.5" />
    <path d="M5.6 5.2L14 12M5.6 10.8L14 4" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
  </svg>
);
const check = (
  <svg viewBox="0 0 16 16" className="size-4 shrink-0" aria-hidden>
    <path d="M3 8.5l3 3 7-7" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

/**
 * The pageant's program on the desk: each sub-activity with how far judging has got, the cuts between them, and
 * the results PDFs as they become ready. While the session is live, any sub-activity can be put on judges'
 * screens, except one waiting on a cut that isn't confirmed yet.
 */
export function ProgramPanel({ board, live, compact = false, onReviewCut }: { board: Board; live: boolean; compact?: boolean; onReviewCut: (roundId: string) => void }) {
  const { activity } = board;
  const order = programOrder(board.rounds);
  const [result, setResult] = useState<ActionResult | null>(null);
  const action = compact
    ? "inline-flex h-7 items-center rounded px-1.5 text-sm font-semibold text-regal hover:bg-wash pointer-coarse:h-11 pointer-coarse:px-2.5"
    : "btn btn-quiet btn-sm";
  const prelimDone = order.filter((r) => r.segment === "preliminary").every((r) => roundProgress(board, r).complete);

  return (
    <section aria-labelledby="program" className={compact ? "shrink-0 rounded-2xl border border-line bg-white/60 px-4 py-3 text-sm" : ""}>
      <h2 id="program" className={compact ? "text-base font-bold" : "font-bold"}>
        Program
      </h2>
      <FormMessage state={result} small className="mt-1" />
      {(["preliminary", "proper"] as const).map((segment) => {
        const rounds = order.filter((r) => r.segment === segment);
        const share = segment === "preliminary" ? activity.preliminaryWeight : 100 - activity.preliminaryWeight;
        return (
          <div key={segment} className={compact ? "mt-2" : "mt-4"}>
            <h3 className={`flex items-center gap-2 font-semibold text-prussian/70 ${compact ? "text-xs" : "text-sm"}`}>
              {segmentLabel(segment)}
              <span className="tabular">{percent(share)}</span>
              {segment === "preliminary" && prelimDone && (
                <PdfLink activityId={activity.id} query="segment=preliminary" className={`${action} ml-auto`}>
                  Standings PDF<span className="sr-only"> for the preliminary</span>
                </PdfLink>
              )}
            </h3>
            <ol className={`mt-1 divide-y divide-line border-y border-line ${compact ? "" : "bg-white/40"}`}>
              {rounds.map((round) => {
                const progress = roundProgress(board, round);
                const current = round.id === activity.currentRoundId && activity.sessionState === "live";
                const plan = round.cutSize !== null ? cutPlan(board, round) : null;
                return (
                  <li key={round.id}>
                    <div className={`flex flex-wrap items-center gap-x-2 gap-y-1 ${compact ? "py-1.5" : "px-3 py-2.5"} ${current ? "bg-white" : ""}`}>
                      <span className="min-w-0 flex-1 truncate font-semibold" title={round.name}>
                        {round.name}
                        <span className="tabular ml-1.5 font-normal text-prussian/75">{percent(round.weight)}</span>
                      </span>
                      {current ? (
                        <span className="inline-flex items-center rounded-md bg-regal px-2 py-0.5 text-xs font-semibold text-mint">Judging now</span>
                      ) : progress.complete ? (
                        <span className="flex items-center gap-1 text-xs font-semibold text-regal">{check}Done</span>
                      ) : progress.blockedBy ? (
                        <span className="text-xs text-prussian/70">After the {progress.blockedBy.name} cut</span>
                      ) : (
                        <span className="tabular text-xs text-prussian/70">
                          {progress.submitted > 0 ? `${progress.submitted} of ${progress.possible} scores` : "Not started"}
                        </span>
                      )}
                      {live && !current && !progress.blockedBy && (
                        <JudgeRoundButton
                          board={board}
                          round={round}
                          className={action}
                          onDone={setResult}
                          label={
                            <>
                              {progress.complete ? "Judge again" : progress.submitted > 0 ? "Resume" : "Judge now"}
                              <span className="sr-only"> {round.name}</span>
                            </>
                          }
                        />
                      )}
                      {progress.complete && (
                        <PdfLink activityId={activity.id} query={`round=${round.id}`} className={action}>
                          PDF<span className="sr-only"> of {round.name} results</span>
                        </PdfLink>
                      )}
                    </div>
                    {plan && (
                      <div className={`flex flex-wrap items-center gap-x-2 gap-y-1 border-t border-dashed border-line ${compact ? "py-1.5" : "px-3 py-2"}`}>
                        {scissors}
                        <span className="min-w-0 flex-1 font-semibold">{plan.final ? `Final cut: Top ${plan.size}` : `Cut: Top ${plan.size}`}</span>
                        <span className={`text-xs ${round.cutEntryIds ? "font-semibold text-regal" : "text-prussian/70"}`}>
                          {round.cutEntryIds ? "Confirmed" : plan.ready ? "Ready to confirm" : "Waiting for scores"}
                        </span>
                        <button type="button" className={action} onClick={() => onReviewCut(round.id)}>
                          {round.cutEntryIds ? "View" : "Review"}
                          <span className="sr-only"> {cutName(plan)} after {round.name}</span>
                        </button>
                        {round.cutEntryIds && (
                          <PdfLink activityId={activity.id} query={`cut=${round.id}`} className={action}>
                            PDF<span className="sr-only"> of {plan.final ? "the final results" : `the Top ${plan.size}`}</span>
                          </PdfLink>
                        )}
                      </div>
                    )}
                  </li>
                );
              })}
            </ol>
          </div>
        );
      })}
    </section>
  );
}

/** One tie the organizer breaks: tap the tied candidates in the order they place (or the ones who go through). */
function TieBreaker({ group, picks, onChange, size }: { group: TieGroup; picks: string[]; onChange: (picks: string[]) => void; size: number }) {
  const total = group.rows[0].total ?? 0;
  const rank = group.rows[0].rank ?? 0;
  const prompt = group.onTheLine
    ? `${group.rows.length} candidates are tied at ${percent(total)} on the Top ${size} line. Choose the ${group.places === 1 ? "one" : group.places} who go${group.places === 1 ? "es" : ""} through.`
    : `${group.rows.length} candidates are tied for ${ordinal(rank)} at ${percent(total)}. Tap them in the order they place.`;
  const toggle = (id: string) => {
    if (picks.includes(id)) onChange(picks.filter((p) => p !== id));
    else if (picks.length < group.places) onChange([...picks, id]);
  };
  return (
    <fieldset className="rounded-xl border border-caution bg-caution/15 p-4">
      <legend className="sr-only">Break the tie at {percent(total)}</legend>
      <p className="font-semibold">{prompt}</p>
      <div className="mt-3 flex flex-wrap gap-2">
        {group.rows.map((row) => {
          const at = picks.indexOf(row.entry.id);
          return (
            <button
              key={row.entry.id}
              type="button"
              aria-pressed={at >= 0}
              onClick={() => toggle(row.entry.id)}
              className={`btn btn-sm gap-2 border ${at >= 0 ? "border-regal bg-regal text-mint" : "border-field bg-white text-prussian hover:bg-wash"}`}
            >
              {at >= 0 && <span className="tabular text-xs font-bold">{group.onTheLine ? "Through" : ordinal(rank + at)}</span>}
              No. {row.number} {row.entry.name}
            </button>
          );
        })}
      </div>
      <p className="hint tabular mt-2">
        {picks.length} of {group.places} chosen
      </p>
    </fieldset>
  );
}

/**
 * Reviewing a cut: the candidates ranked by its basis, the line, and any tie the organizer has to break. Confirming
 * decides who is judged from the next sub-activity on (for the final cut, the placements). Render it keyed by the
 * cut's round id, so each review starts with no picks.
 */
export function CutDialog({ board, roundId, onClose }: { board: Board; roundId: string | null; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const round = board.rounds.find((r) => r.id === roundId) ?? null;
  const [picks, setPicks] = useState<string[][]>([]);
  const [result, setResult] = useState<ActionResult | null>(null);
  const [pending, start] = useTransition();
  const { activity } = board;

  // The desk renders a fresh dialog (keyed by cut) each time one is reviewed, so it opens once, on mount.
  const opens = round !== null;
  useEffect(() => {
    if (opens && ref.current && !ref.current.open) ref.current.showModal();
  }, [opens]);

  const plan = round && round.cutSize !== null ? cutPlan(board, round) : null;
  const confirmed = round?.cutEntryIds ?? null;
  const placeOf = new Map((confirmed ?? []).map((id, i) => [id, i + 1]));
  const tied = new Set(plan?.ties.flatMap((t) => t.rows.map((r) => r.entry.id)) ?? []);
  const incomplete = plan ? plan.rows.filter((r) => !r.complete).length : 0;
  const picksReady = plan ? plan.ties.every((t, i) => (picks[i] ?? []).length === t.places) : false;
  const order = programOrder(board.rounds);
  const next = round ? order[order.findIndex((r) => r.id === round.id) + 1] : undefined;
  const rows = plan
    ? confirmed
      ? [...plan.rows].sort((a, b) => (placeOf.get(a.entry.id) ?? Infinity) - (placeOf.get(b.entry.id) ?? Infinity))
      : plan.rows
    : [];

  const confirm = () =>
    start(async () => {
      if (!round) return;
      const r = await reach(() => confirmCut(activity.id, round.id, plan?.ties.map((_, i) => picks[i] ?? []) ?? []));
      setResult(r);
    });

  return (
    <dialog
      ref={ref}
      onClose={onClose}
      aria-labelledby="cut-title"
      className="m-auto max-h-[calc(100dvh-2rem)] w-[min(60rem,calc(100vw-2rem))] rounded-2xl bg-mint p-0 text-prussian shadow-2xl"
    >
      {round && plan && (
        <>
          <div className="space-y-4 p-6">
            <div>
              <p className="text-sm font-semibold text-regal">After {round.name}</p>
              <h2 id="cut-title" className="text-2xl font-bold">
                {plan.final ? `Final cut: Top ${plan.size}` : `Cut: Top ${plan.size}`}
              </h2>
              <p className="hint mt-1">
                Ranked by {plan.weights.map((w) => `${w.round.name} ${percent(w.weight)}`).join(", ")}. Each counts as a candidate&apos;s average as a
                percentage of its maximum score.
              </p>
            </div>

            {confirmed ? (
              <p role="note" className="note">
                Confirmed. {plan.final ? "The order below is the final placement." : `These ${confirmed.length} candidates go through to ${next?.name ?? "the next part"}.`}
              </p>
            ) : !plan.ready ? (
              <p role="note" className="note">
                {incomplete} {incomplete === 1 ? "candidate is" : "candidates are"} still missing scores. You can confirm once every judge has scored every
                candidate in the sub-activities this cut counts.
              </p>
            ) : null}

            <div className="max-h-[45dvh] overflow-auto rounded-xl border border-line bg-white">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-prussian text-left text-mint">
                  <tr>
                    <th scope="col" className="px-3 py-2 font-semibold">
                      {confirmed ? (plan.final ? "Place" : "Through") : "Rank"}
                    </th>
                    <th scope="col" className="px-2 py-2 font-semibold">
                      No.
                    </th>
                    <th scope="col" className="px-2 py-2 font-semibold">
                      Candidate
                    </th>
                    {plan.weights.map((w) => (
                      <th key={w.round.id} scope="col" className="px-2 py-2 text-right font-semibold">
                        {w.round.name} <span className="font-normal opacity-80">{percent(w.weight)}</span>
                      </th>
                    ))}
                    <th scope="col" className="px-3 py-2 text-right font-semibold">
                      Total
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row, i) => {
                    const inside = confirmed ? placeOf.has(row.entry.id) : row.rank !== null && row.rank <= plan.size && !tied.has(row.entry.id);
                    const lineAfter = (confirmed ? i === confirmed.length - 1 : i === plan.size - 1) && i < rows.length - 1;
                    return (
                      <tr
                        key={row.entry.id}
                        className={`${inside ? "bg-wash/70 font-semibold" : ""} ${lineAfter ? "border-b-2 border-dashed border-regal" : "border-b border-line"}`}
                      >
                        <td className="tabular px-3 py-1.5">
                          {confirmed ? (placeOf.has(row.entry.id) ? (plan.final ? placeOf.get(row.entry.id) : "Yes") : "—") : (row.rank ?? "—")}
                          {!confirmed && tied.has(row.entry.id) && <span className="ml-1.5 text-xs font-bold text-danger">Tie</span>}
                        </td>
                        <td className="tabular px-2 py-1.5">{row.number}</td>
                        <td className="px-2 py-1.5">{row.entry.name}</td>
                        {plan.weights.map((w) => {
                          const v = row.parts.get(w.round.id);
                          return (
                            <td key={w.round.id} className="tabular px-2 py-1.5 text-right">
                              {v === null || v === undefined ? "—" : `${v.toFixed(activity.resultDecimals)}%`}
                            </td>
                          );
                        })}
                        <td className="tabular px-3 py-1.5 text-right">{row.total === null ? "—" : `${row.total.toFixed(activity.resultDecimals)}%`}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {!confirmed &&
              plan.ready &&
              plan.ties.map((group, i) => (
                <TieBreaker
                  key={group.rows[0].entry.id}
                  group={group}
                  size={plan.size}
                  picks={picks[i] ?? []}
                  onChange={(p) => setPicks((all) => plan.ties.map((_, k) => (k === i ? p : (all[k] ?? []))))}
                />
              ))}

            <FormMessage state={result} />
          </div>

          <div className="flex flex-wrap items-center justify-end gap-2 border-t border-line bg-wash/60 px-6 py-4">
            {confirmed && (
              <ConfirmDialog
                triggerLabel="Undo the cut"
                triggerClassName="btn btn-danger-quiet mr-auto"
                title="Undo this cut?"
                tone="danger"
                confirmLabel="Undo the cut"
                onConfirm={async () => {
                  const r = await reach(() => undoCut(activity.id, round.id));
                  if (r.ok) setResult(r);
                  return r;
                }}
              >
                Who goes through is open again, and judging can&apos;t move past this cut until you confirm it again. This only works until judges score
                anything after it.
              </ConfirmDialog>
            )}
            {confirmed && plan.final === false && (
              <PdfLink activityId={activity.id} query={`cut=${round.id}`} className="btn btn-quiet">
                Download PDF
              </PdfLink>
            )}
            {confirmed && plan.final && (
              <PdfLink activityId={activity.id} query={`cut=${round.id}`} className="btn btn-quiet">
                Download final results PDF
              </PdfLink>
            )}
            <button type="button" className="btn btn-quiet" onClick={() => ref.current?.close()}>
              Close
            </button>
            {!confirmed && (
              <button type="button" className="btn btn-primary" onClick={confirm} disabled={!plan.ready || !picksReady || pending}>
                {pending ? "Confirming…" : plan.final ? "Confirm the final results" : `Confirm the Top ${plan.size}`}
              </button>
            )}
            {confirmed && next && activity.sessionState === "live" && activity.currentRoundId !== next.id && (
              <JudgeRoundButton board={board} round={next} className="btn btn-primary" label={`Judge ${next.name}`} onDone={(r) => (r.ok ? ref.current?.close() : setResult(r))} />
            )}
          </div>
        </>
      )}
    </dialog>
  );
}

/** The scoring timer on the desk, with more time or a restart for the candidate on screen. */
export function DeskTimer({ activity, round, renderedAt }: { activity: Activity; round: Round; renderedAt: number }) {
  const timer = useScoringTimer(activity.currentEntryId ? activity.scoringClosesAt : null, round.timerSeconds, renderedAt);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  if (!round.timerSeconds || !activity.currentEntryId) return null;
  const run = (how: "restart" | "more") =>
    start(async () => {
      const r = await reach(() => extendScoring(activity.id, how));
      setError(r.ok ? null : r.error);
    });
  const button = "btn btn-sm border border-oxford text-mint hover:bg-oxford";
  return (
    <div className="flex flex-wrap items-center gap-2 px-6 pt-3">
      <div className="min-w-48 flex-1">{timer && <TimerBar state={timer} timerSeconds={round.timerSeconds} compact />}</div>
      <button type="button" className={button} onClick={() => run("more")} disabled={pending}>
        {timer?.phase === "closed" ? "Reopen for 15 s" : "+15 s"}
      </button>
      <button type="button" className={button} onClick={() => run("restart")} disabled={pending}>
        Restart timer
      </button>
      {error && (
        <p role="alert" className="basis-full text-sm font-semibold text-danger-soft">
          {error}
        </p>
      )}
    </div>
  );
}
