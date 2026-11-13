"use client";

import { useContext, useEffect, useId, useRef, useState, useTransition } from "react";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { TimerBar, useScoringTimer } from "@/components/scoring-timer";
import {
  awaitingSignoff,
  cutPlan,
  deductionsOpen,
  deliberatingRound,
  finalCutRound,
  judgesFor,
  roundDeliberating,
  roundReleased,
  judgingOrder,
  partsOf,
  placeTitle,
  preliminaryComplete,
  programOrder,
  roundLabel,
  roundPool,
  roundProgress,
  segmentClosed,
  unitOf,
  type CutPlan,
  type TieGroup,
} from "@/lib/pageant";
import { Avatar } from "@/components/avatar";
import { SignaturePad } from "@/components/signature-pad";
import { cleanSignature } from "@/lib/deliberation";
import { runningSegment } from "@/lib/lifecycle";
import { listNames } from "@/lib/names";
import { useMediaQuery } from "@/lib/use-media-query";
import { MAX_REASON, segmentLabel } from "@/lib/pageant-setup";
import { reach } from "@/lib/reach";
import { newRequestId } from "@/lib/request-id";
import { formatBound } from "@/lib/scoring";
import { ordinal } from "@/lib/ties";
import type { ActionResult, Activity, Board, JudgeSignature, Round } from "@/lib/types";
import { addDeduction, confirmCut, extendScoring, removeDeduction, setCurrentRound, signOffRound, startRoundDeliberation, undoCut } from "../../actions";
import { FormMessage } from "../form-message";
import { toast } from "../toaster";
import { ExportMenu, HeldLink, PdfHold, sheetOptions } from "./export-menu";

/** A weight or share: "30%", "33.33%". */
const percent = (n: number) => `${formatBound(Math.round(n * 100) / 100)}%`;
const cutName = (plan: Pick<CutPlan, "final" | "round" | "size">) => (plan.final ? "the final cut" : `the Top ${plan.size}`);


/** A pageant results PDF. The time zone goes along so the sheet's printed time matches the venue's clock. */
export function PdfLink({ activityId, query, className, children }: { activityId: string; query: string; className: string; children: React.ReactNode }) {
  const held = useContext(PdfHold);
  const href = `/admin/${activityId}/export?${query}`;
  if (held) {
    return (
      <HeldLink reason={held} className={className}>
        {children}
      </HeldLink>
    );
  }
  return (
    <a
      href={href}
      onClick={(e) => {
        e.currentTarget.href = `${href}&tz=${encodeURIComponent(Intl.DateTimeFormat().resolvedOptions().timeZone)}`;
        toast("Downloading the PDF");
      }}
      className={className}
      download
    >
      {children}
    </a>
  );
}

/**
 * What comes after the sub-activity (or part) being judged, in the segment running now: its cut, once its last part
 * is judged and the cut is still to confirm, or the next thing to judge. Null once the segment is all judged (the
 * desk then offers its end). A part comes back with its full name ("Interview · Q&A").
 */
export function nextUp(board: Board, round: Round | null): { kind: "cut" | "round" | "deliberate"; round: Round } | null {
  const segment = runningSegment(board.activity);
  const order = judgingOrder(board.rounds).filter((r) => r.segment === segment);
  const labelled = (r: Round) => ({ ...r, name: roundLabel(board.rounds, r) });
  // A fully scored one whose results wait for a deliberation not started yet: that comes first.
  const toDeliberate = (r: Round) => !roundReleased(r) && !r.deliberationStartedAt && roundProgress(board, r).complete;
  // The cut that comes right after this part (or sub-activity), if it's still to confirm.
  const cutAfter = (r: Round) => {
    const unit = unitOf(board.rounds, r);
    const parts = partsOf(board.rounds, unit.id);
    const last = parts.length ? parts[parts.length - 1] : unit;
    return last.id === r.id && unit.cutSize !== null && unit.cutEntryIds === null ? unit : null;
  };
  if (!round) {
    // Between sub-activities: the first one not done yet, or the cut holding it back.
    for (const r of order) {
      if (roundProgress(board, r).complete) {
        if (toDeliberate(r)) return { kind: "deliberate", round: labelled(r) };
        const cut = cutAfter(r);
        if (cut) return { kind: "cut", round: cut };
        continue;
      }
      const { blockedBy } = roundPool(board, r.id);
      return blockedBy ? { kind: "cut", round: blockedBy } : { kind: "round", round: labelled(r) };
    }
    return null;
  }
  const now = board.rounds.find((r) => r.id === round.id) ?? round;
  if (toDeliberate(now)) return { kind: "deliberate", round: labelled(now) };
  const cut = cutAfter(now);
  if (cut) return { kind: "cut", round: cut };
  const next = order[order.findIndex((r) => r.id === round.id) + 1];
  if (next) return { kind: "round", round: labelled(next) };
  // The segment's last: whatever of it was skipped and still has scores to come.
  const open = order.find((r) => r.id !== round.id && !roundProgress(board, r).complete && !roundPool(board, r.id).blockedBy);
  return open ? { kind: "round", round: labelled(open) } : null;
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
  const found = board.rounds.find((r) => r.id === activity.currentRoundId) ?? null;
  const current = found && { ...found, name: roundLabel(board.rounds, found) };
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
 * the results PDFs as they become ready. While a segment runs, any of its sub-activities can be put on judges'
 * screens, a judged one again too, except one waiting on a cut that isn't confirmed yet. The other segment's say why
 * they're closed. A pageant with deductions records them from here too.
 */
export function ProgramPanel({ board, live, compact = false, onReviewCut }: { board: Board; live: boolean; compact?: boolean; onReviewCut: (roundId: string) => void }) {
  const { activity } = board;
  const order = programOrder(board.rounds);
  const [result, setResult] = useState<ActionResult | null>(null);
  const action = compact
    ? "inline-flex h-7 items-center rounded px-1.5 text-sm font-semibold text-regal hover:bg-wash pointer-coarse:h-11 pointer-coarse:px-2.5"
    : "btn btn-quiet btn-sm";
  const prelimDone = preliminaryComplete(board);
  const running = runningSegment(activity);
  const deductionCount = board.deductions?.length ?? 0;
  // The break between the segments has its own deductions step on the desk.
  const inBreak = activity.sessionState === "live" && running === null && activity.preliminaryEndedAt !== null;
  // Once the final cut is confirmed the placements are decided: nothing is "judging now", and nothing goes back on
  // judges' screens (undo the cut first).
  const placed = !!finalCutRound(board.rounds)?.cutEntryIds;
  const isCurrent = (r: Round) => !placed && r.id === activity.currentRoundId && activity.sessionState === "live";
  // One being deliberated keeps the judges' screens until it's signed off.
  const deliberating = deliberatingRound(board);
  // Before the start every row would say "Not started", as the activity's status does once: nothing until then.
  const started = activity.sessionState !== "draft";
  const status = (r: Round, judged: boolean) => {
    if (!started) return null;
    const progress = roundProgress(board, r);
    // A sub-activity in parts is "judging now" while one of its parts is.
    const current = judged ? isCurrent(r) : partsOf(board.rounds, r.id).some(isCurrent);
    // What judges score here, for a deliberation's state: the sub-activity, or each of its parts.
    const judgedHere = judged ? [r] : partsOf(board.rounds, r.id);
    return judged && roundDeliberating(r) ? (
      <span className="inline-flex items-center rounded-md bg-regal px-2 py-0.5 text-xs font-semibold text-mint">Deliberating</span>
    ) : current ? (
      <span className="inline-flex items-center rounded-md bg-regal px-2 py-0.5 text-xs font-semibold text-mint">Judging now</span>
    ) : progress.complete && judgedHere.some((p) => !roundReleased(p)) ? (
      <span className="text-xs font-semibold text-regal">{judgedHere.some((p) => p.deliberationStartedAt && !p.signedOffAt) ? "Deliberating" : "To deliberate"}</span>
    ) : progress.complete ? (
      <span className="flex items-center gap-1 text-xs font-semibold text-regal">{check}Done</span>
    ) : progress.blockedBy ? (
      <span className="text-xs text-prussian/70">After the {progress.blockedBy.name} cut</span>
    ) : r.segment === "proper" && running !== "proper" ? (
      <span className="text-xs text-prussian/70">After the preliminary</span>
    ) : (
      <span className="tabular text-xs text-prussian/70">{progress.submitted > 0 ? `${progress.submitted} of ${progress.possible} scores` : "Not started"}</span>
    );
  };
  /**
   * A sub-activity or part that judges score: how far it has got, judging it, its results PDF and the judges' score
   * sheets that go with it. `label`: its full name.
   */
  const row = (r: Round, label: string, part: boolean) => {
    const progress = roundProgress(board, r);
    const current = isCurrent(r);
    return (
      <div className={`flex flex-wrap items-center gap-x-2 gap-y-1 ${compact ? "py-1.5" : "px-5 py-2.5"} ${current ? "bg-wash" : ""}`}>
        <span className={`min-w-0 flex-1 truncate ${part ? "" : "font-semibold"}`} title={label}>
          {r.name}
          <span className="tabular ml-1.5 font-normal text-prussian/75">{percent(r.weight)}</span>
        </span>
        {status(r, true)}
        {live && !placed && !current && !progress.blockedBy && !segmentClosed(activity, r) && !deliberating && (
          <JudgeRoundButton
            board={board}
            round={{ ...r, name: label }}
            className={action}
            onDone={setResult}
            label={
              <>
                {progress.complete ? "Show again" : progress.submitted > 0 ? "Resume" : "Judge now"}
                <span className="sr-only"> {label}</span>
              </>
            }
          />
        )}
        {progress.complete && roundReleased(r) && (
          <ExportMenu activityId={activity.id} options={sheetOptions(`round=${r.id}`, { judges: true })} className={action} context={label} align="right" />
        )}
      </div>
    );
  };

  return (
    <section aria-labelledby="program" className={compact ? "card shrink-0 px-5 py-4 text-sm" : ""}>
      <h2 id="program" className="sr-only">
        Program
      </h2>
      <FormMessage state={result} small className="mt-1" />
      {(["preliminary", "proper"] as const).map((segment) => {
        const rounds = order.filter((r) => r.segment === segment);
        const share = segment === "preliminary" ? activity.preliminaryWeight : 100 - activity.preliminaryWeight;
        return (
          <div key={segment} className={compact ? "mt-2" : "mt-4"}>
            <div className="flex flex-wrap items-center gap-x-2">
              <h3 className={`flex items-center gap-2 font-semibold text-prussian/70 ${compact ? "text-xs" : "text-sm"}`}>
                {segmentLabel(segment)}
                <span className="tabular">{percent(share)}</span>
              </h3>
              {segment === "preliminary" && (
                <div className="ml-auto flex items-center gap-1">
                  {activity.violations !== null && !inBreak && (
                    <DeductionsButton board={board} className={action}>
                      Deductions
                      {deductionCount > 0 && <span className="tabular ml-1 font-normal text-prussian/75">{deductionCount}</span>}
                    </DeductionsButton>
                  )}
                  {prelimDone && awaitingSignoff(board, rounds).length === 0 && (
                    <ExportMenu activityId={activity.id} options={sheetOptions("segment=preliminary", { noun: "Standings" })} className={action} context="the preliminary" align="right" />
                  )}
                </div>
              )}
            </div>
            <ol className={`mt-1 divide-y divide-line ${compact ? "border-y border-line" : "card overflow-hidden"}`}>
              {rounds.map((round) => {
                const parts = partsOf(board.rounds, round.id);
                const plan = round.cutSize !== null ? cutPlan(board, round) : null;
                return (
                  <li key={round.id}>
                    {parts.length === 0 ? (
                      row(round, round.name, false)
                    ) : (
                      <>
                        {/* A sub-activity in parts: its own line is a summary; judges score each part below it. */}
                        <div className={`flex flex-wrap items-center gap-x-2 gap-y-1 ${compact ? "py-1.5" : "px-3 py-2.5"}`}>
                          <span className="min-w-0 flex-1 truncate font-semibold" title={round.name}>
                            {round.name}
                            <span className="tabular ml-1.5 font-normal text-prussian/75">{percent(round.weight)}</span>
                          </span>
                          {status(round, false)}
                          {roundProgress(board, round).complete && parts.every(roundReleased) && (
                            <ExportMenu
                              activityId={activity.id}
                              // Its standings, and each judge's sheets for every part in one PDF.
                              options={[...sheetOptions(`round=${round.id}`, { noun: "Standings" }), { label: "Judges' score sheets (PDF)", query: `round=${round.id}&sheet=judges` }]}
                              className={action}
                              context={round.name}
                              align="right"
                            />
                          )}
                        </div>
                        <ol aria-label={`Parts of ${round.name}`} className="border-l-2 border-line ml-1 pl-2">
                          {parts.map((part) => (
                            <li key={part.id}>{row(part, `${round.name} · ${part.name}`, true)}</li>
                          ))}
                        </ol>
                      </>
                    )}
                    {plan && (
                      <div className={`flex flex-wrap items-center gap-x-2 gap-y-1 border-t border-dashed border-line ${compact ? "py-1.5" : "px-3 py-2"}`}>
                        {scissors}
                        <span className="min-w-0 flex-1 font-semibold">{plan.final ? `Final cut: Top ${plan.size}` : `Cut: Top ${plan.size}`}</span>
                        {/* Nothing to say or review before anyone has scored. */}
                        {started && (
                          <>
                            <span className={`text-xs ${round.cutEntryIds ? "font-semibold text-regal" : "text-prussian/70"}`}>
                              {round.cutEntryIds
                                ? "Confirmed"
                                : plan.ready
                                  ? "Ready to confirm"
                                  : plan.rows.every((r) => r.complete) && plan.awaiting.length
                                    ? "Waiting for sign-off"
                                    : "Waiting for scores"}
                            </span>
                            <button type="button" className={action} onClick={() => onReviewCut(round.id)}>
                              {round.cutEntryIds ? "View" : "Review"}
                              <span className="sr-only"> {cutName(plan)} after {round.name}</span>
                            </button>
                          </>
                        )}
                        {round.cutEntryIds && (
                          <ExportMenu
                            activityId={activity.id}
                            options={sheetOptions(`cut=${round.id}`)}
                            className={action}
                            context={plan.final ? "the final results" : `the Top ${plan.size}`}
                            align="right"
                          />
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

const pointsText = (n: number) => `${formatBound(n)} ${n === 1 ? "point" : "points"}`;

/** A button that opens the deductions in a dialog: the program's, or the first step of the break on the desk. */
export function DeductionsButton({ board, className, children }: { board: Board; className: string; children: React.ReactNode }) {
  const [shown, setShown] = useState(false);
  return (
    <>
      <button type="button" className={className} onClick={() => setShown(true)}>
        {children}
      </button>
      {shown && <DeductionsDialog board={board} onClose={() => setShown(false)} />}
    </>
  );
}

/** Deductions in a dialog (see DeductionsButton). */
function DeductionsDialog({ board, onClose }: { board: Board; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();

  // Rendered only while open, so it opens once, on mount.
  useEffect(() => {
    if (ref.current && !ref.current.open) ref.current.showModal();
  }, []);

  return (
    <dialog
      ref={ref}
      onClose={onClose}
      aria-labelledby={titleId}
      className="m-auto max-h-[calc(100dvh-2rem)] w-[min(40rem,calc(100vw-2rem))] rounded-2xl bg-mint p-0 text-prussian shadow-2xl"
    >
      <div className="@container p-6">
        <Deductions board={board} titleId={titleId} />
      </div>
      <div className="flex justify-end border-t border-line bg-wash/60 px-6 py-4">
        <button type="button" className="btn btn-quiet" onClick={() => ref.current?.close()}>
          Close
        </button>
      </div>
    </dialog>
  );
}

/**
 * Deductions: points off a candidate's preliminary score for a violation, one from the pageant's list or another
 * with its reason typed here. They can be added and taken back until pageant proper starts; after that they're
 * listed, final. Only the organizer sees them; the results PDFs list them with their reasons. In a dialog from the
 * program, or `inline` on the desk in the break after the preliminary, when they're tallied.
 */
export function Deductions({ board, titleId, inline = false }: { board: Board; titleId?: string; inline?: boolean }) {
  const { activity } = board;
  const id = useId();
  // Inline, the break's step heads it ("Record deductions"), so it has no title of its own.
  const Given = inline ? "h4" : "h3";
  const violations = activity.violations ?? [];
  const open = deductionsOpen(board);
  // Every candidate, with the number they keep through the pageant.
  const candidates = [...board.entries].sort((a, b) => a.position - b.position).map((e, i) => ({ ...e, number: i + 1 }));
  const byId = new Map(candidates.map((c) => [c.id, c]));
  const given = [...(board.deductions ?? [])].sort((a, b) => (byId.get(a.entryId)?.number ?? 0) - (byId.get(b.entryId)?.number ?? 0));
  const [entryId, setEntryId] = useState("");
  const [choice, setChoice] = useState(violations[0]?.id ?? "other");
  const [reason, setReason] = useState("");
  const [points, setPoints] = useState("");
  const [result, setResult] = useState<ActionResult | null>(null);
  const [pending, start] = useTransition();
  // This deduction's id: sent again after a lost reply, it isn't given twice. A new one once it's in.
  const [deductionId, setDeductionId] = useState(newRequestId);

  const add = () =>
    start(async () => {
      const r = await reach(() => addDeduction(activity.id, entryId, choice === "other" ? null : choice, reason, points, deductionId));
      setResult(r);
      // Ready for the next one; the candidate is chosen again, so the same deduction isn't given twice by accident.
      if (r.ok) {
        setDeductionId(newRequestId());
        setEntryId("");
        setReason("");
        setPoints("");
      }
    });
  const remove = (which: string) => start(async () => setResult(await reach(() => removeDeduction(activity.id, which))));

  return (
    <div className="space-y-5">
      {!inline && (
        <div>
          <h2 id={titleId} className="title-sm text-2xl">
            Deductions
          </h2>
          <p className="hint mt-1 max-w-[65ch]">
            {open
              ? "Points off a candidate's preliminary score. They close when pageant proper starts."
              : activity.sessionState === "ended"
                ? "The session has ended, so they're final."
                : "Pageant proper has started, so they're final."}
          </p>
        </div>
      )}

      {open && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            add();
          }}
          // Two columns only where there's room (the dialog); one in the desk's narrow column.
          className="grid gap-x-3 gap-y-4 @lg:grid-cols-2"
        >
          <div>
            <label htmlFor={`${id}-candidate`} className="label">
              Candidate
            </label>
            <select id={`${id}-candidate`} className="field" value={entryId} onChange={(e) => setEntryId(e.target.value)}>
              <option value="">Choose a candidate</option>
              {candidates.map((c) => (
                <option key={c.id} value={c.id}>
                  No. {c.number} {c.name}
                </option>
              ))}
            </select>
          </div>
          {violations.length > 0 && (
            <div>
              <label htmlFor={`${id}-violation`} className="label">
                Violation
              </label>
              <select id={`${id}-violation`} className="field" value={choice} onChange={(e) => setChoice(e.target.value)}>
                {violations.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.reason}, {pointsText(v.points)}
                  </option>
                ))}
                <option value="other">Another violation</option>
              </select>
            </div>
          )}
          {choice === "other" && (
            <>
              <div className={violations.length > 0 ? "" : "@lg:row-start-2"}>
                <label htmlFor={`${id}-reason`} className="label">
                  Reason
                </label>
                <input id={`${id}-reason`} className="field" maxLength={MAX_REASON} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Late for call time" />
              </div>
              <div>
                <label htmlFor={`${id}-points`} className="label">
                  Points off
                </label>
                <input
                  id={`${id}-points`}
                  className="field tabular w-28"
                  inputMode="decimal"
                  value={points}
                  onChange={(e) => setPoints(e.target.value.replace(/[^0-9.]/g, "").slice(0, 6))}
                />
              </div>
            </>
          )}
          <div className="@lg:col-span-2">
            <button type="submit" className="btn btn-primary" disabled={pending || !entryId}>
              {pending ? "Saving…" : "Deduct"}
            </button>
          </div>
        </form>
      )}
      <FormMessage state={result} />

      <section aria-labelledby={`${id}-given`}>
        <Given id={`${id}-given`} className="font-bold">
          Given
        </Given>
        {given.length === 0 ? (
          <p className="hint mt-1">None yet.</p>
        ) : (
          <ul className="mt-2 divide-y divide-line border-y border-line">
            {given.map((d) => {
              const who = byId.get(d.entryId);
              return (
                <li key={d.id} className="flex items-center gap-3 py-2">
                  <span className="tabular w-12 shrink-0 text-sm text-prussian/75">No. {who?.number ?? "—"}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block font-semibold">{who?.name ?? "Removed candidate"}</span>
                    <span className="block text-sm text-prussian/80">{d.reason}</span>
                  </span>
                  <span className="tabular shrink-0 font-semibold">&minus;{formatBound(d.points)}</span>
                  {open && (
                    <button
                      type="button"
                      className="btn btn-sm shrink-0 px-2 text-prussian/75 hover:bg-danger/10 hover:text-danger pointer-coarse:min-w-11"
                      onClick={() => remove(d.id)}
                      disabled={pending}
                      aria-label={who ? `Take back ${who.name}'s deduction for ${d.reason}` : `Take back the deduction for ${d.reason}`}
                    >
                      <svg viewBox="0 0 16 16" className="size-4" aria-hidden>
                        <path d="M4 4l8 8M12 4l-8 8" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
                      </svg>
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}

/**
 * The final cut's placements once it's confirmed, on the desk for the organizer to announce: the winner, then the
 * runners-up. Nothing before then.
 */
export function FinalPlacements({ board, className = "" }: { board: Board; className?: string }) {
  const titleId = useId();
  const placed = finalCutRound(board.rounds)?.cutEntryIds;
  if (!placed?.length) return null;
  // Candidates keep their number from the full running order.
  const numberOf = new Map([...board.entries].sort((a, b) => a.position - b.position).map((e, i) => [e.id, i + 1]));
  const byId = new Map(board.entries.map((e) => [e.id, e]));
  return (
    <div className={`w-full ${className}`}>
      <h3 id={titleId} className="text-sm text-powder">
        Final placements
      </h3>
      <ol aria-labelledby={titleId} className="mt-1 max-w-xl divide-y divide-oxford">
        {placed.map((id, i) => (
          <li key={id} className="flex items-baseline gap-4 py-3">
            <span className={`w-36 shrink-0 text-sm font-semibold ${i === 0 ? "text-mint" : "text-powder"}`}>{placeTitle(i + 1)}</span>
            <span className="min-w-0 flex-1 truncate">
              <span className="tabular text-powder">No. {numberOf.get(id) ?? "—"}</span>{" "}
              {/* Large enough to read out from the desk at the announcement; the winner's own headline is above. */}
              <span className="text-lg font-semibold">{byId.get(id)?.name ?? "Removed candidate"}</span>
            </span>
          </li>
        ))}
      </ol>
    </div>
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

/** Start a sub-activity's (or part's) deliberation, once every judge on its panel has scored every candidate in it. */
export function StartRoundDeliberation({
  board,
  round,
  className,
  onDone,
}: {
  board: Board;
  round: Round;
  className: string;
  onDone?: (result: ActionResult) => void;
}) {
  return (
    <ConfirmDialog
      triggerLabel={
        <>
          Start deliberation<span className="sr-only"> of {round.name}</span>
        </>
      }
      triggerClassName={className}
      title={`Deliberate ${round.name}?`}
      confirmLabel="Start deliberation"
      onConfirm={async () => {
        const result = await reach(() => startRoundDeliberation(board.activity.id, round.id));
        onDone?.(result);
        return result;
      }}
    >
      Every judge has scored every candidate in {round.name}. Their screens switch to their scores in it: each reviews them, corrects any
      that&apos;s wrong (saying why), and signs. Then you sign it off, and its scores go out on the live results and the LED wall.
    </ConfirmDialog>
  );
}

/**
 * The desk while a sub-activity (or part) is deliberated: who has signed, and once every judge on its panel has, the
 * organizer's sign-off (drawn on a touchscreen, or "(Sgd.)") with their password, which sends its scores out.
 * `signatures`: null before migration 040.
 */
export function RoundDeliberationDesk({ board, round, signatures }: { board: Board; round: Round; signatures: JudgeSignature[] | null }) {
  const judges = judgesFor(board, round);
  const signed = new Set((signatures ?? []).map((s) => s.judgeId));
  const waiting = judges.filter((j) => !signed.has(j.id));
  const touch = useMediaQuery("(any-pointer: coarse)");
  const [drawing, setDrawing] = useState("");
  const [agreed, setAgreed] = useState(false);
  const ready = touch ? cleanSignature(drawing) !== null : agreed;

  return (
    <div className="flex min-h-0 flex-1 flex-col items-start gap-4 overflow-y-auto border-t border-oxford px-6 py-5">
      <p className="max-w-xl text-[15px] leading-relaxed text-powder">
        Each judge reviews their scores in {round.name}, corrects any that&apos;s wrong (saying why), then signs. Its scores stay off the live results and
        the LED wall until you sign it off.
      </p>
      {/* As the desk's judge tiles: those done step back, those still reviewing stand out. */}
      <ul aria-label="Judges' signatures" className="grid w-full max-w-xl gap-2">
        {judges.map((j) => (
          <li
            key={j.id}
            className={`flex items-center gap-3 rounded-xl px-3 py-2 ${signed.has(j.id) ? "bg-oxford/45 text-mint/75" : "bg-oxford ring-1 ring-powder/50"}`}
          >
            <Avatar name={j.name} src={j.photoUrl} size={32} />
            <span className="min-w-0 flex-1 truncate font-semibold">{j.name}</span>
            {signed.has(j.id) ? (
              <span className="flex items-center gap-1.5 text-sm font-semibold text-powder">
                {check}
                Signed
              </span>
            ) : (
              <span className="text-sm font-bold text-mint">Reviewing</span>
            )}
          </li>
        ))}
      </ul>
      {signatures === null ? (
        <p className="font-semibold">Signing needs a database update. Run supabase/migrations/040_pageant_segments_and_deliberation.sql.</p>
      ) : waiting.length > 0 ? (
        <p role="status" className="font-semibold">
          Waiting for {listNames(waiting)} to sign.
        </p>
      ) : (
        <div className="w-full max-w-xl">
          {/* The desk's headline says every judge has signed; this says what's left. */}
          <p role="status" className="font-semibold">
            Sign it off to send its scores out.
          </p>
          {touch ? (
            <SignaturePad value={drawing} onChange={setDrawing} />
          ) : (
            <label className="mt-3 flex items-start gap-3 text-[15px]">
              <input type="checkbox" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} className="mt-0.5 size-5 shrink-0" />
              <span>
                I&apos;ve checked the scores in {round.name} and sign them off. Its results PDF shows <span className="font-semibold">(Sgd.)</span> beside
                my name.
              </span>
            </label>
          )}
          <ConfirmDialog
            triggerLabel={`Sign off ${round.name}`}
            triggerClassName="btn mt-4 bg-mint text-prussian hover:bg-white"
            triggerDisabled={!ready}
            title={`Sign off ${round.name}?`}
            confirmLabel={`Sign off ${round.name}`}
            passwordLabel="Your password"
            onConfirm={async (password) => {
              const r = await reach(() => signOffRound(board.activity.id, round.id, touch ? drawing : null, password));
              if (r.ok) toast(`${round.name} signed off`);
              return r;
            }}
          >
            Its scores go out on the live results and the LED wall at once, and its results PDF carries your signature.
          </ConfirmDialog>
        </div>
      )}
    </div>
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
  // Deductions come off the preliminary score, so a cut that counts it shows what they took off.
  const deducting = plan ? plan.rows.some((r) => r.deducted > 0) : false;
  const picksReady = plan ? plan.ties.every((t, i) => (picks[i] ?? []).length === t.places) : false;
  const order = programOrder(board.rounds);
  const nextUnit = round ? order[order.findIndex((r) => r.id === round.id) + 1] : undefined;
  // The next sub-activity is judged from its first part, if it has parts.
  const nextFirst = nextUnit ? (partsOf(board.rounds, nextUnit.id)[0] ?? nextUnit) : undefined;
  const next = nextFirst && { ...nextFirst, name: roundLabel(board.rounds, nextFirst) };
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
              <h2 id="cut-title" className="title-sm text-2xl">
                {plan.final ? `Final cut: Top ${plan.size}` : `Cut: Top ${plan.size}`}
              </h2>
              <p className="hint mt-1">
                Ranked by {plan.weights.map((w) => `${w.round.name} ${percent(w.weight)}`).join(", ")}.
              </p>
            </div>

            {confirmed ? (
              <p role="note" className="note">
                Confirmed. {plan.final ? "The order below is the final placement." : `These ${confirmed.length} candidates go through to ${nextUnit?.name ?? "the next part"}.`}
              </p>
            ) : !plan.ready && incomplete === 0 && plan.awaiting.length > 0 ? (
              <p role="note" className="note">
                {listNames(plan.awaiting)} {plan.awaiting.length === 1 ? "is" : "are"} still to be signed off after {plan.awaiting.length === 1 ? "its" : "their"}{" "}
                deliberation. You can confirm once {plan.awaiting.length === 1 ? "it is" : "they are"}: the cut counts {plan.awaiting.length === 1 ? "it" : "them"}.
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
                    {deducting && (
                      <th scope="col" className="px-2 py-2 text-right font-semibold">
                        Deductions
                      </th>
                    )}
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
                          {confirmed ? (placeOf.has(row.entry.id) ? (plan.final ? placeTitle(placeOf.get(row.entry.id)!) : "Yes") : "—") : (row.rank ?? "—")}
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
                        {deducting && (
                          <td className="tabular px-2 py-1.5 text-right">{row.deducted > 0 ? `\u2212${row.deducted.toFixed(activity.resultDecimals)}` : "—"}</td>
                        )}
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

/**
 * The scoring timer on the desk, with more time or a restart for the entry or candidate on screen. `timerSeconds`: a
 * pageant sub-activity's, or an event's (see eventTimer); null for none.
 */
export function DeskTimer({ activity, timerSeconds, renderedAt }: { activity: Activity; timerSeconds: number | null; renderedAt: number }) {
  const timer = useScoringTimer(activity.currentEntryId ? activity.scoringClosesAt : null, timerSeconds, renderedAt);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  if (!timerSeconds || !activity.currentEntryId) return null;
  const run = (how: "restart" | "more") =>
    start(async () => {
      const r = await reach(() => extendScoring(activity.id, how));
      setError(r.ok ? null : r.error);
    });
  const button = "btn btn-sm border border-oxford text-mint hover:bg-oxford";
  return (
    <div className="flex flex-wrap items-center gap-2 px-6 pt-3">
      <div className="min-w-48 flex-1">{timer && <TimerBar state={timer} timerSeconds={timerSeconds} compact quiet />}</div>
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
