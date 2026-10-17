"use client";

import { Fragment, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { basisWeights } from "@/lib/pageant";
import {
  afterCut,
  aloneAfterCut,
  basisChoices,
  basisOf,
  blankScoring,
  fitShares,
  hasCut,
  MAX_PARTS,
  MAX_ROUND_NAME,
  MAX_ROUNDS,
  segmentLabel,
  evenShares,
  parseShare,
  rescaleShares,
  roundShare,
  properStages,
  segmentShare,
  shareGroups,
  shareScope,
  sharesWithOneMore,
  shareText,
  typedShare,
  MAX_REASON,
  MAX_VIOLATIONS,
  type PageantDraft,
  type ViolationDraft,
  type PartDraft,
  type RoundDraft,
  type ScoringDraft,
} from "@/lib/pageant-setup";
import { formatBound } from "@/lib/scoring";
import type { Round, Segment } from "@/lib/types";
import { describedBy, FieldProblem, problemId, useFieldProblems } from "./field-errors";
import { moveButton, moveKeepingFocus } from "./move-focus";
import { ScoringEditor } from "./scoring-fields";

/** The cut's basis as weights, in percent, for the preview under its checkboxes. */
function previewWeights(draft: PageantDraft, basis: string[]): { key: string; name: string; weight: number }[] {
  const rounds = draft.rounds.map(
    (r, position): Round => ({
      id: r.key,
      segment: r.segment,
      name: r.name.trim() || "Untitled",
      position,
      weight: Number(r.weight) || 0,
      scoringMode: "simple",
      min: 0,
      max: 10,
      decimals: 0,
      criteria: [],
      criteriaDisplay: "percent",
      timerSeconds: null,
      cutSize: null,
      cutBasis: [],
      cutEntryIds: null,
      parentId: null,
    }),
  );
  const share = Number(draft.preliminaryWeight) || 0;
  return basisWeights(rounds, share, basis).map((w) => ({ key: w.round.id, name: w.round.name, weight: w.weight }));
}

/** A field's problem props: marked invalid and tied to its message (see FieldProblem), plus any other descriptions. */
function problemProps(problems: ReadonlyMap<string, string>, fieldId: string, ...others: (string | false | null | undefined)[]) {
  const has = problems.has(fieldId);
  return { "aria-invalid": has || undefined, "aria-describedby": describedBy(has && problemId(fieldId), ...others) };
}
const problemBorder = (problems: ReadonlyMap<string, string>, fieldId: string) => (problems.has(fieldId) ? "border-danger" : "");

/** "30%", "33.33%". */
const percent = (n: number) => `${formatBound(Math.round(n * 100) / 100)}%`;

const JUDGE_DECIMALS = ["whole numbers", "1 decimal place", "2 decimal places", "3 decimal places"] as const;

/**
 * A sub-activity's (or part's) scoring and timer in one line, worded as Review words it: "Scores 1 to 10 · 2 decimal
 * places · 60 s to score", or "Poise 28 to 40, Beauty up to 30 · whole numbers".
 */
function scoringLine(s: ScoringDraft, timer: string): string {
  const named = s.criteria.filter((c) => c.name.trim());
  const how =
    s.mode === "simple"
      ? `Scores ${s.min || "?"} to ${s.max || "?"}`
      : named.map((c) => `${c.name.trim()} ${c.min.trim() ? `${c.min.trim()} to` : "up to"} ${c.max || "?"}`).join(", ") || "Criteria";
  return [how, JUDGE_DECIMALS[s.decimals], timer && `${timer} s to score`].filter(Boolean).join(" · ");
}

function IconButton({
  label,
  onClick,
  disabled,
  move,
  removes,
  blocked,
  onBlocked,
  children,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  /** For a move button: the item it moves and which way, so focus comes back to it after the move. */
  move?: { item: string; direction: -1 | 1 };
  /** For a remove button: the item it removes, so Undo can put focus back on it. */
  removes?: string;
  /** Why it can't be used now, in place of `disabled`: it stays focusable, and pressing it says why (onBlocked). */
  blocked?: string | null;
  onBlocked?: (why: string) => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      className={`btn btn-sm px-2 text-prussian/75 pointer-coarse:min-w-11 ${blocked ? "cursor-not-allowed opacity-50" : "hover:bg-wash"}`}
      onClick={() => (blocked ? onBlocked?.(blocked) : move ? moveKeepingFocus(move.item, move.direction, onClick) : onClick())}
      disabled={disabled}
      aria-disabled={blocked ? true : undefined}
      aria-label={label}
      {...(move && moveButton(move.item, move.direction))}
      {...(removes && { "data-remove": removes })}
    >
      {children}
    </button>
  );
}

/** Between the move arrows and remove, so a tap meant for moving doesn't remove. */
const Gap = () => <span aria-hidden className="mx-1 h-5 w-px self-center bg-line" />;

/** Focus the remove button of the item an Undo has just put back. */
const focusRemove = (key: string) => document.querySelector<HTMLElement>(`[data-remove="${CSS.escape(key)}"]`)?.focus();

/**
 * Where a removed sub-activity or part was, until the next change: what went, and Undo to put it back as it was.
 * Focus moves here from the remove button that's gone.
 */
function Removed({ id, name, what, onUndo, className }: { id: string; name: string; what: string; onUndo: () => void; className: string }) {
  return (
    <li className={`flex flex-wrap items-center gap-x-3 gap-y-2 border border-dashed border-field/60 px-4 py-3 ${className}`}>
      <p role="status" className="min-w-0 flex-1 text-sm">
        <span className="font-semibold">{name}</span> was removed, {what}.
      </p>
      <button id={id} type="button" className="btn btn-quiet btn-sm" onClick={onUndo}>
        Undo<span className="sr-only"> removing {name}</span>
      </button>
    </li>
  );
}

/**
 * How a sub-activity (or one of its parts) is scored and timed, folded to one line until it's opened: most keep the
 * defaults, and the line says what they are. `name` is what screen readers hear it called.
 */
function ScoredFields({
  id,
  name,
  scoring,
  timer,
  onScoring,
  onTimer,
}: {
  id: string;
  name: string;
  scoring: ScoringDraft;
  timer: string;
  onScoring: (scoring: ScoringDraft) => void;
  onTimer: (timer: string) => void;
}) {
  const problems = useFieldProblems();
  const flagged = problems.has(`${id}scoring`) || problems.has(`${id}timer`);
  const timed = timer !== "";
  return (
    <>
      {/* Above the panel, so it shows with the panel's heading when that takes focus. */}
      <FieldProblem fieldId={`${id}scoring`} className="mt-4" />
      <details className={`group rounded-xl border ${flagged ? "border-danger" : "border-line"} ${problems.has(`${id}scoring`) ? "mt-2" : "mt-4"}`}>
        <summary id={`${id}scoring`} className="flex cursor-pointer items-baseline gap-3 px-4 py-3 select-none" {...problemProps(problems, `${id}scoring`)}>
          <span className="font-semibold">
            Scoring<span className="sr-only"> for {name}</span>
          </span>
          <span className="hint tabular min-w-0 flex-1">{scoringLine(scoring, timer)}</span>
          <svg viewBox="0 0 16 16" className="size-4 shrink-0 self-center transition-transform group-open:rotate-180" aria-hidden>
            <path d="M4 6l4 4 4-4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </summary>
        <div className="space-y-6 border-t border-line px-4 py-4">
          <ScoringEditor value={scoring} onChange={onScoring} idPrefix={id} label={name} />
          <div>
            <label className="flex items-center gap-2.5 text-sm font-semibold">
              <input type="checkbox" className="size-5" checked={timed} onChange={(e) => onTimer(e.target.checked ? "60" : "")} />
              Time limit for scoring<span className="sr-only"> {name}</span>
            </label>
            {timed && (
              <div className="mt-2 ml-7.5 flex flex-wrap items-center gap-x-3 gap-y-2">
                <label htmlFor={`${id}timer`} className="text-sm">
                  Judges get<span className="sr-only"> this many seconds per candidate in {name}</span>
                </label>
                <input
                  id={`${id}timer`}
                  value={timer}
                  // Never blank while the timer is on (blank means off): a cleared field reads 0 until a number is typed.
                  onChange={(e) => onTimer(e.target.value.replace(/[^0-9]/g, "").replace(/^0+(?=\d)/, "").slice(0, 4) || "0")}
                  inputMode="numeric"
                  className={`field tabular w-20 ${problemBorder(problems, `${id}timer`)}`}
                  {...problemProps(problems, `${id}timer`, `${id}timer-hint`)}
                />
                <span className="text-sm">seconds per candidate</span>
                <FieldProblem fieldId={`${id}timer`} className="basis-full" />
                <p id={`${id}timer-hint`} className="hint basis-full max-w-[65ch]">
                  It starts when you show each candidate. You can give more time from the session desk.
                </p>
              </div>
            )}
          </div>
        </div>
      </details>
    </>
  );
}

/**
 * "Shares total 30 of 40%": a group's shares against what they must add up to (a segment's share of the overall
 * score, or 100% after a cut), in the danger colour while they're off. `label` and `of` word it for the group.
 */
function SharesTotal({
  total,
  target,
  started,
  of,
  label = "Shares total",
}: {
  total: number;
  target: number | null;
  started: boolean;
  of: string;
  label?: string;
}) {
  const done = target !== null && Math.round(total * 100) === target * 100;
  const off = !done && started && target !== null;
  return (
    <p className={`tabular text-sm font-semibold ${done ? "text-regal" : started ? "text-danger" : "text-prussian/70"}`}>
      {label} {shareText(total)}
      {target !== null && ` of ${target}`}%{off && <span aria-hidden>{`. The ${of} must add up to ${target}%.`}</span>}
      {/* Screen readers hear only when the shares start or stop adding up, not every number typed. */}
      <span role="status" className="sr-only">
        {done ? " They add up." : off ? ` The ${of} must add up to ${target}%.` : ""}
      </span>
    </p>
  );
}

const EVENED = "Shares were split evenly to make room. Change them if they count differently.";

/** A sub-activity with a new share; its parts, if it has any, keep their proportions within it. */
function withShare(round: RoundDraft, share: string): RoundDraft {
  if (!round.parts) return { ...round, weight: share };
  const parts = rescaleShares(round.parts.map((p) => p.weight), parseShare(share) || 0);
  return { ...round, weight: share, parts: round.parts.map((p, i) => ({ ...p, weight: parts[i] })) };
}

/**
 * A sub-activity's parts: each with a name, a share (of the same score as the sub-activity's), scoring and timer. The
 * sub-activity counts for its parts added up. `room`: how much of its group's share is still free.
 */
function PartsEditor({
  round,
  name,
  room,
  scope,
  onChange,
}: {
  round: RoundDraft;
  name: string;
  room: number;
  /** What the shares are of: "of the overall score", or "of the score after the Top 5 cut". */
  scope: string;
  onChange: (parts: PartDraft[]) => void;
}) {
  const parts = round.parts ?? [];
  const problems = useFieldProblems();
  const nextKey = useRef(0);
  const [evened, setEvened] = useState(false);
  const total = roundShare(round);
  const patch = (key: string, p: Partial<PartDraft>) => onChange(parts.map((x) => (x.key === key ? { ...x, ...p } : x)));
  // The part last removed, which Undo puts back while nothing else has changed since.
  const [removed, setRemoved] = useState<{ part: PartDraft; at: number; before: PartDraft[]; after: PartDraft[] } | null>(null);
  const undoable = removed && round.parts === removed.after ? removed : null;
  const [why, setWhy] = useState<{ key: string; text: string } | null>(null);
  // The others take the removed part's share, keeping their proportions, so the sub-activity still counts for what
  // it did (as removing a sub-activity refits its group). Applied at once, so focus goes straight from the remove
  // button that's gone to Undo in its place.
  const remove = (at: number) => {
    const kept = parts.filter((_, i) => i !== at);
    const shares = kept.every((p) => parseShare(p.weight) > 0) ? rescaleShares(kept.map((p) => p.weight), total) : kept.map((p) => p.weight);
    const after = kept.map((p, i) => ({ ...p, weight: shares[i] }));
    flushSync(() => {
      onChange(after);
      setRemoved({ part: parts[at], at, before: parts, after });
    });
    document.getElementById(`undo-part-${round.key}`)?.focus();
  };
  const undo = () => {
    if (!undoable) return;
    flushSync(() => onChange(undoable.before));
    setRemoved(null);
    focusRemove(undoable.part.key);
  };
  const undoRow = (at: number) =>
    undoable?.at === at && (
      <Removed
        id={`undo-part-${round.key}`}
        name={undoable.part.name.trim() || `Part ${at + 1}`}
        what="with its scoring and share"
        onUndo={undo}
        className="rounded-xl"
      />
    );
  const move = (from: number, to: number) => {
    if (to < 0 || to >= parts.length) return;
    const next = [...parts];
    [next[from], next[to]] = [next[to], next[from]];
    onChange(next);
  };
  // A new part takes what's left of the segment's share; when nothing is left, the sub-activity's share is split evenly among its parts.
  const add = () => {
    const { shares, evened: split } = sharesWithOneMore(parts.map((p) => p.weight), Math.round((total + Math.max(0, room)) * 100) / 100);
    const added: PartDraft = { key: `${round.key}-added-${nextKey.current++}-${parts.length}`, name: "", weight: "", scoring: blankScoring(), timer: "" };
    onChange([...parts, added].map((p, i) => ({ ...p, weight: shares[i] })));
    setEvened(split);
  };

  return (
    <div className="mt-5">
      {/* Indented under the sub-activity on a rule, rather than a card inside its card. */}
      <ol className="space-y-6 border-l border-line pl-4 sm:pl-5">
        {parts.map((part, i) => {
          const partName = part.name.trim() || `Part ${i + 1}`;
          const full = `${name} · ${partName}`;
          const id = `part-${part.key}-`;
          return (
            <Fragment key={part.key}>
              {undoRow(i)}
              <li>
                <div className="flex items-start gap-2">
                  <h5 className="min-w-0 flex-1 pt-1.5 font-semibold">
                    <span className="tabular text-prussian/75">Part {i + 1}.</span> {part.name.trim()}
                  </h5>
                  <IconButton label={`Move ${full} up`} onClick={() => move(i, i - 1)} disabled={i === 0} move={{ item: part.key, direction: -1 }}>
                    <svg viewBox="0 0 16 16" className="size-4" aria-hidden>
                      <path d="M4 10l4-4 4 4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  </IconButton>
                  <IconButton label={`Move ${full} down`} onClick={() => move(i, i + 1)} disabled={i === parts.length - 1} move={{ item: part.key, direction: 1 }}>
                    <svg viewBox="0 0 16 16" className="size-4" aria-hidden>
                      <path d="M4 6l4 4 4-4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  </IconButton>
                  <Gap />
                  <IconButton
                    label={`Remove ${full}`}
                    onClick={() => remove(i)}
                    removes={part.key}
                    blocked={parts.length <= 2 ? `A sub-activity in parts has at least two. To score ${name} as a whole, untick Score it in parts.` : null}
                    onBlocked={(text) => setWhy({ key: part.key, text })}
                  >
                    <svg viewBox="0 0 16 16" className="size-4" aria-hidden>
                      <path d="M4 4l8 8M12 4l-8 8" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
                    </svg>
                  </IconButton>
                </div>
                {why?.key === part.key && parts.length <= 2 && (
                  <p role="status" className="hint mt-1 max-w-[65ch]">
                    {why.text}
                  </p>
                )}
                <div className="mt-2 flex flex-wrap items-end gap-3">
                  <div className="min-w-48 flex-1">
                    <label htmlFor={`${id}name`} className="label">
                      Name
                      <span className="sr-only">
                        {" "}
                        of part {i + 1} of {name}
                      </span>
                    </label>
                    <input
                      id={`${id}name`}
                      value={part.name}
                      maxLength={MAX_ROUND_NAME}
                      onChange={(e) => patch(part.key, { name: e.target.value })}
                      placeholder={["e.g. Q&A", "e.g. Advocacy", "e.g. Advocacy video"][i] ?? `Part ${i + 1}`}
                      className={`field ${problemBorder(problems, `${id}name`)}`}
                      {...problemProps(problems, `${id}name`)}
                    />
                  </div>
                  <div className="w-36">
                    <label htmlFor={`${id}weight`} className="label">
                      Share
                      <span className="sr-only">
                        {" "}
                        {scope} for {full}
                      </span>
                    </label>
                    <div className="flex items-center gap-2">
                      <input
                        id={`${id}weight`}
                        value={part.weight}
                        onChange={(e) => patch(part.key, { weight: typedShare(e.target.value) })}
                        inputMode="decimal"
                        className={`field tabular w-20 ${problemBorder(problems, `${id}weight`)}`}
                        {...problemProps(problems, `${id}weight`)}
                      />
                      <span aria-hidden className="font-semibold">
                        %
                      </span>
                    </div>
                  </div>
                  {/* Under the row, at full width: the name's or share's problem. */}
                  <FieldProblem fieldId={`${id}name`} className="basis-full" />
                  <FieldProblem fieldId={`${id}weight`} className="basis-full" />
                </div>
                <ScoredFields
                  id={id}
                  name={full}
                  scoring={part.scoring}
                  timer={part.timer}
                  onScoring={(scoring) => patch(part.key, { scoring })}
                  onTimer={(timer) => patch(part.key, { timer })}
                />
              </li>
            </Fragment>
          );
        })}
        {undoable && undoable.at >= parts.length && undoRow(undoable.at)}
      </ol>
      <button type="button" className="btn btn-quiet btn-sm mt-4" onClick={add} disabled={parts.length >= MAX_PARTS}>
        Add a part<span className="sr-only"> to {name}</span>
      </button>
      {evened && <p className="hint mt-2 max-w-[65ch]">{EVENED}</p>}
    </div>
  );
}

function RoundCard({
  draft,
  round,
  index,
  count,
  candidates,
  onChange,
  onMove,
  onRemove,
}: {
  draft: PageantDraft;
  /** How many candidates the pageant has, so each cut can say how many are left before it. 0 when unknown. */
  candidates: number;
  round: RoundDraft;
  /** Place within its segment. */
  index: number;
  count: number;
  onChange: (patch: Partial<RoundDraft>) => void;
  onMove: (direction: -1 | 1) => void;
  onRemove: () => void;
}) {
  const id = `round-${round.key}-`;
  const name = round.name.trim() || `Sub-activity ${index + 1}`;
  const proper = draft.rounds.filter((r) => r.segment === "proper");
  const final = round.segment === "proper" && proper[proper.length - 1]?.key === round.key;
  const cut = hasCut(draft.rounds, round);
  const basis = basisOf(draft.rounds, round);
  const problems = useFieldProblems();
  // Why remove can't be used, once it's pressed: the segment's only sub-activity.
  const [why, setWhy] = useState<string | null>(null);
  // How much of its group's share (its segment's, or its stage's after a cut) no sub-activity has yet: where a new
  // part's share comes from.
  const group = shareGroups(draft).find((g) => g.rounds.some((r) => r.key === round.key));
  const used = (group?.rounds ?? []).reduce((n, r) => n + roundShare(r), 0);
  const room = group?.target == null ? 0 : Math.round((group.target - used) * 100) / 100;
  const scope = shareScope(draft.rounds, round);
  // Alone after a cut it counts for all of its stage, so there's no share to give.
  const alone = aloneAfterCut(draft.rounds, round);
  // Keys for new parts count up within this card.
  const nextPart = useRef(0);
  const newPart = (weight: string, scoring = blankScoring(), timer = ""): PartDraft => ({
    key: `${round.key}-part-${nextPart.current++}`,
    name: "",
    weight,
    scoring,
    timer,
  });
  // Splitting into parts starts with two sharing the sub-activity's share, the first keeping the scoring set so far.
  // Turning parts off keeps that scoring and the parts' total as the share.
  const toggleParts = (on: boolean) => {
    if (on) {
      const [a, b] = parseShare(round.weight) > 0 ? evenShares(parseShare(round.weight), 2) : ["", ""];
      onChange({ parts: [newPart(a, round.scoring, round.timer), newPart(b)] });
    } else {
      onChange({ parts: null, weight: shareText(roundShare(round)), scoring: round.parts?.[0]?.scoring ?? round.scoring });
    }
  };
  // How many candidates are left when this cut comes: everyone, or the size of the cut before it.
  let left: number | null = candidates > 0 ? candidates : null;
  for (const r of proper) {
    if (r.key === round.key || left === null) break;
    const size = Number(r.cutSize);
    if (hasCut(draft.rounds, r) && Number.isInteger(size) && size >= 1 && size < left) left = size;
  }
  const typedSize = Number(round.cutSize);
  // A cut has to leave fewer than it starts with; the final cut can place everyone left.
  const cutTooBig = left !== null && round.cutSize !== "" && (final ? typedSize > left : typedSize >= left);
  const toggleBasis = (key: string, on: boolean) => onChange({ cutBasis: on ? [...basis, key] : basis.filter((k) => k !== key) });

  return (
    <li className="rounded-2xl border border-line bg-white p-4 sm:p-5">
      <div className="flex items-start gap-2">
        <h4 className="min-w-0 flex-1 pt-1.5 font-bold">
          <span className="tabular text-prussian/75">{index + 1}.</span> {name}
        </h4>
        <IconButton label={`Move ${name} up`} onClick={() => onMove(-1)} disabled={index === 0} move={{ item: round.key, direction: -1 }}>
          <svg viewBox="0 0 16 16" className="size-4" aria-hidden>
            <path d="M4 10l4-4 4 4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </IconButton>
        <IconButton label={`Move ${name} down`} onClick={() => onMove(1)} disabled={index === count - 1} move={{ item: round.key, direction: 1 }}>
          <svg viewBox="0 0 16 16" className="size-4" aria-hidden>
            <path d="M4 6l4 4 4-4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </IconButton>
        <Gap />
        <IconButton
          label={`Remove ${name}`}
          onClick={onRemove}
          removes={round.key}
          blocked={count <= 1 ? `${round.segment === "preliminary" ? "The preliminary" : "Pageant proper"} needs at least one sub-activity.` : null}
          onBlocked={setWhy}
        >
          <svg viewBox="0 0 16 16" className="size-4" aria-hidden>
            <path d="M4 4l8 8M12 4l-8 8" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
          </svg>
        </IconButton>
      </div>
      {why && count <= 1 && (
        <p role="status" className="hint mt-1">
          {why}
        </p>
      )}

      <div className="mt-3 flex flex-wrap items-end gap-3">
        <div className="min-w-56 flex-1">
          <label htmlFor={`${id}name`} className="label">
            Name
            <span className="sr-only">
              {" "}
              of {segmentLabel(round.segment)} sub-activity {index + 1}
            </span>
          </label>
          <input
            id={`${id}name`}
            value={round.name}
            maxLength={MAX_ROUND_NAME}
            onChange={(e) => onChange({ name: e.target.value })}
            placeholder={round.segment === "preliminary" ? "e.g. Closed-door interview" : "e.g. Evening wear"}
            className={`field ${problemBorder(problems, `${id}name`)}`}
            {...problemProps(problems, `${id}name`)}
          />
        </div>
        {alone ? null : round.parts ? (
          // In parts, the share is the parts added up: shown, not typed.
          <div>
            <p className="label">
              Share
              <span className="sr-only">
                {" "}
                {scope} for {name}
              </span>
            </p>
            <p className="flex h-11 items-center gap-2 whitespace-nowrap">
              <span className="tabular font-semibold">{shareText(roundShare(round))}%</span>
              <span className="hint">sum of parts</span>
            </p>
          </div>
        ) : (
          <div className="w-36">
            <label htmlFor={`${id}weight`} className="label">
              Share
              <span className="sr-only">
                {" "}
                {scope} for {name}
              </span>
            </label>
            <div className="flex items-center gap-2">
              <input
                id={`${id}weight`}
                value={round.weight}
                onChange={(e) => onChange({ weight: typedShare(e.target.value) })}
                inputMode="decimal"
                className={`field tabular w-20 ${problemBorder(problems, `${id}weight`)}`}
                {...problemProps(problems, `${id}weight`)}
              />
              <span aria-hidden className="font-semibold">
                %
              </span>
            </div>
          </div>
        )}
        {/* Under the row, at full width: the name's or share's problem. */}
        <FieldProblem fieldId={`${id}name`} className="basis-full" />
        <FieldProblem fieldId={`${id}weight`} className="basis-full" />
      </div>

      <div className="mt-4">
        <label className="flex items-center gap-2.5 font-semibold">
          <input
            id={`${id}parts`}
            type="checkbox"
            className="size-5 shrink-0"
            checked={round.parts !== null}
            onChange={(e) => toggleParts(e.target.checked)}
            {...problemProps(problems, `${id}parts`)}
          />
          Score it in parts<span className="sr-only"> for {name}</span>
        </label>
        <FieldProblem fieldId={`${id}parts`} className="mt-1 ml-7.5" />
      </div>

      {round.parts === null ? (
        <ScoredFields
          id={id}
          name={name}
          scoring={round.scoring}
          timer={round.timer}
          onScoring={(scoring) => onChange({ scoring })}
          onTimer={(timer) => onChange({ timer })}
        />
      ) : (
        <PartsEditor
          round={round}
          name={name}
          room={room}
          scope={scope}
          onChange={(parts) => onChange({ parts, weight: shareText(roundShare({ weight: "", parts })) })}
        />
      )}

      {round.segment === "proper" && (
        <div className={`mt-4 ${cut ? "rounded-xl bg-wash/60 p-4" : ""}`}>
          {final ? (
            <p className="font-semibold">
              Final cut<span className="hint ml-2 font-normal">Its order is the final placement, winner first.</span>
            </p>
          ) : (
            // What a cut does to the scores after it is said once, where its stage starts.
            <label className="flex items-center gap-2.5 font-semibold">
              <input type="checkbox" className="size-5" checked={round.cut} onChange={(e) => onChange({ cut: e.target.checked })} />
              Make a cut after {name}
            </label>
          )}
          {cut && (
            <div className="mt-3 space-y-3">
              <div className="flex flex-wrap items-center gap-3">
                <label htmlFor={`${id}cut`} className="font-semibold">
                  Top
                  <span className="sr-only">
                    {" "}
                    ({final ? `candidates placed in the final cut after ${name}` : `candidates who go through after ${name}`})
                  </span>
                </label>
                <input
                  id={`${id}cut`}
                  value={round.cutSize}
                  onChange={(e) => onChange({ cutSize: e.target.value.replace(/[^0-9]/g, "").slice(0, 3) })}
                  inputMode="numeric"
                  className={`field tabular w-20 ${cutTooBig || problems.has(`${id}cut`) ? "border-danger" : ""}`}
                  aria-invalid={cutTooBig || problems.has(`${id}cut`) || undefined}
                  aria-describedby={cutTooBig ? `${id}cut-error` : describedBy(problems.has(`${id}cut`) && problemId(`${id}cut`))}
                />
                <span className="text-sm">
                  {left === null
                    ? final
                      ? "candidates are placed"
                      : "candidates go through"
                    : `of the ${left} ${left === 1 ? "candidate" : "candidates"} left ${final ? "are placed" : "go through"}`}
                </span>
                {cutTooBig && (
                  <p id={`${id}cut-error`} role="alert" className="basis-full text-sm font-semibold text-danger">
                    {final
                      ? `The final cut can't place more than the ${left} candidates left.`
                      : `Top ${round.cutSize} has to be fewer than the ${left} candidates left before this cut.`}
                  </p>
                )}
                {/* The same size problem already shows above while it's typed. */}
                {!cutTooBig && <FieldProblem fieldId={`${id}cut`} className="basis-full" />}
              </div>
              <fieldset>
                <legend className="text-sm font-semibold">
                  Ranked by<span className="sr-only"> for the cut after {name}</span>
                </legend>
                <div className="mt-1.5 flex flex-wrap gap-x-5 gap-y-1.5 pointer-coarse:gap-y-0">
                  {basisChoices(draft.rounds, round).map((choice) => (
                    <label key={choice.key} className="flex items-center gap-2 text-sm pointer-coarse:min-h-11">
                      <input type="checkbox" className="size-5" checked={basis.includes(choice.key)} onChange={(e) => toggleBasis(choice.key, e.target.checked)} />
                      {choice.label}
                    </label>
                  ))}
                </div>
                {basis.length > 0 && (
                  <p className="hint mt-2 max-w-[65ch]">
                    Counts as{" "}
                    {previewWeights(draft, basis)
                      .map((w) => `${w.name} ${percent(w.weight)}`)
                      .join(", ")}
                    .
                  </p>
                )}
              </fieldset>
            </div>
          )}
        </div>
      )}
    </li>
  );
}

/**
 * Deductions for violations during the preliminary: off, or on with the violations the organizer can pick at the
 * desk (each with its points off the preliminary score). Any other violation can still be typed at the desk.
 */
function DeductionsFields({ violations, onChange }: { violations: ViolationDraft[] | null; onChange: (violations: ViolationDraft[] | null) => void }) {
  const problems = useFieldProblems();
  const nextKey = useRef(0);
  const list = useRef<HTMLOListElement>(null);
  const blank = (): ViolationDraft => ({ key: `violation-new-${nextKey.current++}`, id: "", reason: "", points: "" });
  const patch = (key: string, p: Partial<ViolationDraft>) => violations && onChange(violations.map((v) => (v.key === key ? { ...v, ...p } : v)));
  const columns = "sm:grid-cols-[minmax(0,24rem)_7rem_auto]";
  return (
    <section aria-labelledby="deductions-heading" className="border-t border-line pt-6">
      <h4 id="deductions-heading" className="sr-only">
        Deductions
      </h4>
      <label className="flex items-center gap-2.5 font-semibold">
        <input
          id="deductions-on"
          type="checkbox"
          className="size-5 shrink-0"
          checked={violations !== null}
          onChange={(e) => onChange(e.target.checked ? [blank()] : null)}
          aria-describedby="deductions-hint"
        />
        Deductions for violations
      </label>
      <p id="deductions-hint" className="hint mt-1 ml-7.5 max-w-[65ch]">
        Points off a candidate&apos;s preliminary score, given at the desk until pageant proper starts.
      </p>
      {violations && (
        <div className="mt-4 ml-7.5">
          {violations.length > 0 && (
            <div aria-hidden className={`mb-1.5 hidden gap-x-2 sm:grid ${columns}`}>
              <span className="label mb-0">Violation</span>
              <span className="label mb-0">Points off</span>
            </div>
          )}
          <ol ref={list} className="space-y-4 sm:space-y-2">
            {violations.map((v, i) => {
              const id = `violation-${v.key}-`;
              return (
                <li key={v.key} className={`grid grid-cols-[1fr_auto] items-end gap-x-2 gap-y-2 ${columns}`}>
                  <div>
                    <label htmlFor={`${id}reason`} className="sr-only">
                      Violation {i + 1}
                    </label>
                    <input
                      id={`${id}reason`}
                      value={v.reason}
                      maxLength={MAX_REASON}
                      onChange={(e) => patch(v.key, { reason: e.target.value })}
                      placeholder={["e.g. Late for call time", "e.g. Improper attire"][i] ?? `Violation ${i + 1}`}
                      className={`field ${problemBorder(problems, `${id}reason`)}`}
                      {...problemProps(problems, `${id}reason`)}
                    />
                  </div>
                  <div className="row-start-2 sm:row-start-auto">
                    <label htmlFor={`${id}points`} className="label sm:sr-only">
                      <span className="sr-only">Violation {i + 1} </span>Points off
                    </label>
                    <input
                      id={`${id}points`}
                      value={v.points}
                      onChange={(e) => patch(v.key, { points: e.target.value.replace(/[^0-9.]/g, "").slice(0, 6) })}
                      inputMode="decimal"
                      placeholder="e.g. 1"
                      className={`field tabular w-28 sm:w-full ${problemBorder(problems, `${id}points`)}`}
                      {...problemProps(problems, `${id}points`)}
                    />
                  </div>
                  <button
                    type="button"
                    className="btn btn-sm col-start-2 row-start-1 self-center justify-self-start px-2 text-prussian/75 hover:bg-danger/10 hover:text-danger sm:col-start-auto sm:row-start-auto pointer-coarse:min-w-11"
                    onClick={() => onChange(violations.filter((x) => x.key !== v.key))}
                    aria-label={`Remove violation ${i + 1}${v.reason.trim() ? `, ${v.reason.trim()}` : ""}`}
                  >
                    <svg viewBox="0 0 16 16" className="size-4" aria-hidden>
                      <path d="M4 4l8 8M12 4l-8 8" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
                    </svg>
                  </button>
                  <FieldProblem fieldId={`${id}reason`} className="col-span-2 sm:col-span-3" />
                  <FieldProblem fieldId={`${id}points`} className="col-span-2 sm:col-span-3" />
                </li>
              );
            })}
          </ol>
          <button
            type="button"
            className="btn btn-quiet btn-sm mt-3"
            onClick={() => {
              onChange([...violations, blank()]);
              // Straight to the new violation's name.
              requestAnimationFrame(() => list.current?.querySelector<HTMLInputElement>("li:last-child input")?.focus());
            }}
            disabled={violations.length >= MAX_VIOLATIONS}
          >
            Add a violation
          </button>
          <p className="hint mt-2 max-w-[65ch]">
            {violations.length ? "At the desk you can also deduct for another violation, typing its reason and points." : "With none listed, each deduction's reason and points are typed at the desk."}
          </p>
        </div>
      )}
    </section>
  );
}

/**
 * One segment of a pageant's program: its sub-activities, in order, with their shares (adding up to 100%), scoring,
 * timers and, in pageant proper, cuts. The preliminary segment also sets its share of the overall score.
 */
export function SegmentEditor({
  segment,
  draft,
  onChange,
  candidates = 0,
}: {
  segment: Segment;
  draft: PageantDraft;
  onChange: (next: PageantDraft) => void;
  /** How many candidates there are, for the candidates left before each cut. */
  candidates?: number;
}) {
  // Keys for new sub-activities count up within this editor (never Date.now() during render).
  const nextKey = useRef(0);
  const problems = useFieldProblems();
  const list = draft.rounds.filter((r) => r.segment === segment);
  const target = segmentShare(draft, segment);
  // The preliminary is one group of shares; pageant proper a group per stage, as scores start over after each cut.
  const groups = shareGroups(draft).filter((g) => g.segment === segment);
  const started = (rounds: RoundDraft[]) => rounds.some((r) => r.weight !== "" || r.parts);
  const prelimShare = Number(draft.preliminaryWeight);
  const restShown = prelimShare >= 1 && prelimShare <= 99;
  // The preliminary's percentage when it was last left: changing it rescales the shares that added up to it.
  const committed = useRef(draft.preliminaryWeight);

  const setRounds = (rounds: RoundDraft[]) => {
    // Keep the program in order: the preliminary segment first.
    onChange({ ...draft, rounds: [...rounds.filter((r) => r.segment === "preliminary"), ...rounds.filter((r) => r.segment === "proper")] });
  };
  // Taking a sub-activity away, moving one, or adding or removing a cut changes which shares belong together: each
  // group's are then fitted to its total again, keeping their proportions.
  const refit = (rounds: RoundDraft[]): PageantDraft => {
    const ordered = [...rounds.filter((r) => r.segment === "preliminary"), ...rounds.filter((r) => r.segment === "proper")];
    const next = fitShares({ ...draft, rounds: ordered });
    onChange(next);
    return next;
  };
  const patch = (key: string, p: Partial<RoundDraft>) => {
    const rounds = draft.rounds.map((r) => (r.key === key ? { ...r, ...p } : r));
    if ("cut" in p) refit(rounds);
    else setRounds(rounds);
  };
  // The sub-activity last removed: Undo puts the program back as it was, while nothing else has changed since.
  const [removed, setRemoved] = useState<{ round: RoundDraft; at: number; before: PageantDraft; after: PageantDraft } | null>(null);
  const undoable = removed && removed.after === draft ? removed : null;
  // Applied at once, so focus goes straight from the remove button that's gone to Undo in its place.
  const remove = (key: string) => {
    const at = list.findIndex((r) => r.key === key);
    flushSync(() => {
      const after = refit(draft.rounds.filter((r) => r.key !== key).map((r) => (r.cutBasis ? { ...r, cutBasis: r.cutBasis.filter((k) => k !== key) } : r)));
      setRemoved({ round: list[at], at, before: draft, after });
    });
    document.getElementById(`undo-round-${segment}`)?.focus();
  };
  const undo = () => {
    if (!undoable) return;
    flushSync(() => onChange(undoable.before));
    setRemoved(null);
    focusRemove(undoable.round.key);
  };
  const undoRow = (at: number) =>
    undoable?.at === at && (
      <Removed
        id={`undo-round-${segment}`}
        name={undoable.round.name.trim() || `Sub-activity ${at + 1}`}
        what={`with its ${undoable.round.parts ? "parts" : "scoring"}${hasCut(undoable.before.rounds, undoable.round) ? " and cut" : ""}`}
        onUndo={undo}
        className="rounded-2xl"
      />
    );
  const move = (key: string, direction: -1 | 1) => {
    const keys = list.map((r) => r.key);
    const from = keys.indexOf(key);
    const to = from + direction;
    if (to < 0 || to >= keys.length) return;
    [keys[from], keys[to]] = [keys[to], keys[from]];
    const moved = keys.map((k) => list.find((r) => r.key === k)!);
    refit([...draft.rounds.filter((r) => r.segment !== segment), ...moved]);
  };
  // A new sub-activity takes what's left of its group's share (its segment's, or its stage's after a cut); when
  // nothing is left, the group's share is split evenly to make room.
  const [evened, setEvened] = useState(false);
  const add = () => {
    const key = `new-${segment}-${nextKey.current++}-${list.length}`;
    const added: RoundDraft = { key, segment, name: "", weight: "", scoring: blankScoring(), timer: "", cut: false, cutSize: "", cutBasis: null, parts: null };
    const next = { ...draft, rounds: [...draft.rounds, added] };
    const group = shareGroups(next).find((g) => g.rounds.some((r) => r.key === key))!;
    const others = group.rounds.filter((r) => r.key !== key);
    const { shares, evened: split } = sharesWithOneMore(others.map((r) => shareText(roundShare(r))), group.target ?? 100);
    const weights = new Map([...others, added].map((r, i) => [r.key, shares[i]]));
    setRounds(next.rounds.map((r) => (weights.has(r.key) ? withShare(r, weights.get(r.key)!) : r)));
    setEvened(split);
  };
  const changePreliminary = () => {
    const from = Number(committed.current);
    const to = Number(draft.preliminaryWeight);
    committed.current = draft.preliminaryWeight;
    if (!(from >= 1 && from <= 99 && to >= 1 && to <= 99) || from === to) return;
    // The preliminary's shares and pageant proper's up to its first cut follow their new share, as long as they added
    // up to the old one. After a cut, shares add up to 100% either way.
    const rescale = (rounds: RoundDraft[], own: RoundDraft[], oldShare: number, newShare: number) => {
      if (Math.round(own.reduce((n, r) => n + roundShare(r), 0) * 100) !== oldShare * 100) return rounds;
      const scaled = new Map(own.map((r, i) => [r.key, rescaleShares(own.map((x) => shareText(roundShare(x))), newShare)[i]]));
      return rounds.map((r) => (scaled.has(r.key) ? withShare(r, scaled.get(r.key)!) : r));
    };
    const preliminary = draft.rounds.filter((r) => r.segment === "preliminary");
    const firstStage = properStages(draft.rounds)[0] ?? [];
    const rounds = rescale(rescale(draft.rounds, preliminary, from, to), firstStage, 100 - from, 100 - to);
    if (rounds !== draft.rounds) onChange({ ...draft, rounds });
  };

  return (
    <div className="space-y-4">
      {segment === "preliminary" && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <label htmlFor="preliminary-weight" className="font-semibold">
            The preliminary counts for
          </label>
          {/* The number keeps its % beside it when the line wraps on a phone. */}
          <span className="flex items-center gap-2 font-semibold">
            <input
              id="preliminary-weight"
              value={draft.preliminaryWeight}
              onChange={(e) => onChange({ ...draft, preliminaryWeight: e.target.value.replace(/[^0-9]/g, "").slice(0, 2) })}
              onBlur={changePreliminary}
              inputMode="numeric"
              className={`field tabular w-20 font-normal ${problemBorder(problems, "preliminary-weight")}`}
              {...problemProps(problems, "preliminary-weight", restShown && "preliminary-weight-hint")}
            />
            %
          </span>
          <span className="font-semibold">of the overall score</span>
          <FieldProblem fieldId="preliminary-weight" className="basis-full" />
          {restShown && (
            <p id="preliminary-weight-hint" className="hint basis-full">
              Pageant proper counts for the other {100 - prelimShare}%.
            </p>
          )}
        </div>
      )}

      {groups.map((group, g) => {
        const last = g === groups.length - 1;
        const total = group.rounds.reduce((sum, r) => sum + roundShare(r), 0);
        // After a cut, its stage: worded by the cut that starts it. Alone there, a sub-activity is simply 100%.
        const cut = group.stage ? groups[g - 1].rounds.at(-1)! : null;
        const lone = cut !== null && group.rounds.length === 1 && !group.rounds[0].parts;
        const sharesTotal = lone ? null : cut ? (
          <SharesTotal
            total={total}
            target={group.target}
            started={started(group.rounds)}
            label={`Shares ${afterCut(cut)} total`}
            of={`shares ${afterCut(cut)}`}
          />
        ) : (
          <SharesTotal
            total={total}
            target={target}
            started={started(group.rounds)}
            of={`${segment === "preliminary" ? "preliminary" : "pageant proper"} shares${groups.length > 1 ? " up to the first cut" : ""}`}
          />
        );
        const ranks = last ? "the final cut" : "the next cut";
        return (
          <div key={group.rounds[0]?.key ?? g} className={cut ? "space-y-4 border-t-2 border-dashed border-line pt-5" : "space-y-4"}>
            {cut && (
              <div>
                <p className="font-bold">{`${afterCut(cut)[0].toUpperCase()}${afterCut(cut).slice(1)}, scores start over`}</p>
                <p className="hint mt-1 max-w-[65ch]">
                  Only those who go through are judged from here.{" "}
                  {lone
                    ? `${group.rounds[0].name.trim() || "This sub-activity"} counts for 100% and ranks ${ranks}.`
                    : `These shares add up to 100% and rank ${ranks}.`}
                </p>
              </div>
            )}
            <ol className="space-y-4" aria-label={cut ? `Sub-activities ${afterCut(cut)}` : undefined}>
              {group.rounds.map((round) => {
                const i = list.indexOf(round);
                return (
                  <Fragment key={round.key}>
                    {undoRow(i)}
                    <RoundCard
                      draft={draft}
                      round={round}
                      index={i}
                      count={list.length}
                      candidates={candidates}
                      onChange={(p) => patch(round.key, p)}
                      onMove={(d) => move(round.key, d)}
                      onRemove={() => remove(round.key)}
                    />
                  </Fragment>
                );
              })}
              {last && undoable && undoable.at >= list.length && undoRow(undoable.at)}
            </ol>
            {last && (
              <div>
                <button type="button" className="btn btn-quiet btn-sm" onClick={add} disabled={draft.rounds.length >= MAX_ROUNDS}>
                  Add a sub-activity
                </button>
                {evened && <p className="hint mt-2 max-w-[65ch]">{EVENED}</p>}
              </div>
            )}
            {/* The group's total stays in view at the bottom of the screen while any of its shares are, and comes to rest under them. */}
            {sharesTotal && <div className="share-ledger sticky bottom-0 z-10 border-t border-line bg-mint py-3">{sharesTotal}</div>}
          </div>
        );
      })}
      {segment === "preliminary" && <DeductionsFields violations={draft.violations ?? null} onChange={(violations) => onChange({ ...draft, violations })} />}
    </div>
  );
}
