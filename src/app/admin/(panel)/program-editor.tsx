"use client";

import { useRef, useState } from "react";
import { basisWeights, warningSeconds } from "@/lib/pageant";
import {
  basisChoices,
  basisOf,
  blankScoring,
  hasCut,
  MAX_PARTS,
  MAX_ROUND_NAME,
  MAX_ROUNDS,
  segmentLabel,
  sharesWithOneMore,
  type PageantDraft,
  type PartDraft,
  type RoundDraft,
  type ScoringDraft,
} from "@/lib/pageant-setup";
import { formatBound } from "@/lib/scoring";
import type { Round, Segment } from "@/lib/types";
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

/** "30%", "33.33%". */
const percent = (n: number) => `${formatBound(Math.round(n * 100) / 100)}%`;

/** One line about a sub-activity's (or part's) scoring, for its summary. */
function scoringLine(s: ScoringDraft): string {
  if (s.mode === "criteria") {
    const named = s.criteria.filter((c) => c.name.trim());
    return named.length ? `Criteria: ${named.map((c) => `${c.name.trim()} ${c.max || "?"}`).join(", ")}` : "Criteria";
  }
  return `Scores from ${s.min || "?"} to ${s.max || "?"}`;
}

function IconButton({ label, onClick, disabled, children }: { label: string; onClick: () => void; disabled?: boolean; children: React.ReactNode }) {
  return (
    <button type="button" className="btn btn-sm px-2 text-prussian/75 hover:bg-wash pointer-coarse:min-w-11" onClick={onClick} disabled={disabled} aria-label={label}>
      {children}
    </button>
  );
}

/** How a sub-activity (or one of its parts) is scored, and its timer. `name` is what screen readers hear it called. */
function ScoredFields({
  id,
  name,
  scoring,
  timer,
  startOpen,
  onScoring,
  onTimer,
}: {
  id: string;
  name: string;
  scoring: ScoringDraft;
  timer: string;
  startOpen: boolean;
  onScoring: (scoring: ScoringDraft) => void;
  onTimer: (timer: string) => void;
}) {
  const timed = timer !== "";
  const timerSeconds = Number(timer);
  return (
    <>
      <details className="group mt-4 rounded-xl border border-line" open={startOpen}>
        <summary className="flex cursor-pointer items-center gap-3 px-4 py-3 select-none">
          <span className="font-semibold">
            Scoring<span className="sr-only"> for {name}</span>
          </span>
          <span className="hint min-w-0 flex-1 truncate">{scoringLine(scoring)}</span>
          <svg viewBox="0 0 16 16" className="size-4 shrink-0 transition-transform group-open:rotate-180" aria-hidden>
            <path d="M4 6l4 4 4-4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </summary>
        <div className="border-t border-line px-4 py-4">
          <ScoringEditor value={scoring} onChange={onScoring} idPrefix={id} label={name} />
        </div>
      </details>

      <div className="mt-4">
        <label className="flex items-center gap-2.5 font-semibold">
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
              className="field tabular w-20"
              aria-describedby={`${id}timer-hint`}
            />
            <span className="text-sm">seconds per candidate</span>
            <p id={`${id}timer-hint`} className="hint basis-full">
              The timer starts when you show a candidate. Judges see green while they can score
              {timerSeconds >= 5 ? `, yellow in the last ${warningSeconds(timerSeconds)} seconds,` : ", yellow just before it closes,"} and red
              once scoring has closed. You can give more time from the session desk.
            </p>
          </div>
        )}
      </div>
    </>
  );
}

/** "Shares total 90 of 100%", in the danger colour while it's off once anything is typed. */
function SharesTotal({ total, started, of }: { total: number; started: boolean; of: string }) {
  return (
    <p role="status" className={`tabular text-sm font-semibold ${total === 100 ? "text-regal" : started ? "text-danger" : "text-prussian/70"}`}>
      Shares total {total} of 100%{total === 100 || !started ? "" : `. The ${of} shares must add up to 100%.`}
    </p>
  );
}

const EVENED = "Shares were split evenly to make room. Change them if they count differently.";

/** A sub-activity's parts: each with a name, a share of the sub-activity (adding up to 100%), scoring and timer. */
function PartsEditor({ round, name, onChange }: { round: RoundDraft; name: string; onChange: (parts: PartDraft[]) => void }) {
  const parts = round.parts ?? [];
  const nextKey = useRef(0);
  const [evened, setEvened] = useState(false);
  const total = parts.reduce((sum, p) => sum + (Number(p.weight) || 0), 0);
  const patch = (key: string, p: Partial<PartDraft>) => onChange(parts.map((x) => (x.key === key ? { ...x, ...p } : x)));
  const move = (from: number, to: number) => {
    if (to < 0 || to >= parts.length) return;
    const next = [...parts];
    [next[from], next[to]] = [next[to], next[from]];
    onChange(next);
  };
  const add = () => {
    const { shares, evened: split } = sharesWithOneMore(parts.map((p) => p.weight));
    const added: PartDraft = { key: `${round.key}-added-${nextKey.current++}-${parts.length}`, name: "", weight: "", scoring: blankScoring(), timer: "" };
    onChange([...parts, added].map((p, i) => ({ ...p, weight: shares[i] })));
    setEvened(split);
  };

  return (
    <div className="mt-4 space-y-3">
      <ol className="space-y-3">
        {parts.map((part, i) => {
          const partName = part.name.trim() || `Part ${i + 1}`;
          const full = `${name} · ${partName}`;
          const id = `part-${part.key}-`;
          return (
            <li key={part.key} className="rounded-xl border border-line bg-wash/40 p-4">
              <div className="flex items-start gap-2">
                <h5 className="min-w-0 flex-1 pt-1.5 font-semibold">
                  <span className="tabular text-prussian/75">Part {i + 1}.</span> {part.name.trim()}
                </h5>
                <IconButton label={`Move ${full} up`} onClick={() => move(i, i - 1)} disabled={i === 0}>
                  <svg viewBox="0 0 16 16" className="size-4" aria-hidden>
                    <path d="M4 10l4-4 4 4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </IconButton>
                <IconButton label={`Move ${full} down`} onClick={() => move(i, i + 1)} disabled={i === parts.length - 1}>
                  <svg viewBox="0 0 16 16" className="size-4" aria-hidden>
                    <path d="M4 6l4 4 4-4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </IconButton>
                <IconButton label={`Remove ${full}`} onClick={() => onChange(parts.filter((p) => p.key !== part.key))} disabled={parts.length <= 2}>
                  <svg viewBox="0 0 16 16" className="size-4" aria-hidden>
                    <path d="M4 4l8 8M12 4l-8 8" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
                  </svg>
                </IconButton>
              </div>
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
                    className="field"
                  />
                </div>
                <div className="w-36">
                  <label htmlFor={`${id}weight`} className="label">
                    Share<span className="sr-only"> of {name} for {partName}</span>
                  </label>
                  <div className="flex items-center gap-2">
                    <input
                      id={`${id}weight`}
                      value={part.weight}
                      onChange={(e) => patch(part.key, { weight: e.target.value.replace(/[^0-9]/g, "").slice(0, 3) })}
                      inputMode="numeric"
                      className="field tabular w-20"
                    />
                    <span aria-hidden className="font-semibold">
                      %
                    </span>
                  </div>
                </div>
              </div>
              <ScoredFields
                id={id}
                name={full}
                scoring={part.scoring}
                timer={part.timer}
                startOpen={part.name === ""}
                onScoring={(scoring) => patch(part.key, { scoring })}
                onTimer={(timer) => patch(part.key, { timer })}
              />
            </li>
          );
        })}
      </ol>
      <div className="flex flex-wrap items-center gap-4">
        <button type="button" className="btn btn-quiet btn-sm" onClick={add} disabled={parts.length >= MAX_PARTS}>
          Add a part<span className="sr-only"> to {name}</span>
        </button>
        <SharesTotal total={total} started={parts.some((p) => p.weight !== "")} of={`${name} part`} />
      </div>
      {evened && <p className="hint">{EVENED}</p>}
    </div>
  );
}

function RoundCard({
  draft,
  round,
  index,
  count,
  onChange,
  onMove,
  onRemove,
}: {
  draft: PageantDraft;
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
  // A new sub-activity opens its scoring; saved ones start folded. Fixed at first render, so typing a name doesn't fold it.
  const [scoringOpen] = useState(round.name === "");
  // Keys for new parts count up within this card.
  const nextPart = useRef(0);
  const newPart = (weight: string, scoring = blankScoring(), timer = ""): PartDraft => ({
    key: `${round.key}-part-${nextPart.current++}`,
    name: "",
    weight,
    scoring,
    timer,
  });
  // Splitting into parts starts with two, the first keeping the scoring set so far. Turning parts off keeps that scoring.
  const toggleParts = (on: boolean) =>
    onChange({ parts: on ? [newPart("50", round.scoring, round.timer), newPart("50")] : null, ...(on ? {} : { scoring: round.parts?.[0]?.scoring ?? round.scoring }) });
  const toggleBasis = (key: string, on: boolean) => onChange({ cutBasis: on ? [...basis, key] : basis.filter((k) => k !== key) });

  return (
    <li className="rounded-2xl border border-line bg-white p-4 sm:p-5">
      <div className="flex items-start gap-2">
        <h4 className="min-w-0 flex-1 pt-1.5 font-bold">
          <span className="tabular text-prussian/75">{index + 1}.</span> {name}
        </h4>
        <IconButton label={`Move ${name} up`} onClick={() => onMove(-1)} disabled={index === 0}>
          <svg viewBox="0 0 16 16" className="size-4" aria-hidden>
            <path d="M4 10l4-4 4 4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </IconButton>
        <IconButton label={`Move ${name} down`} onClick={() => onMove(1)} disabled={index === count - 1}>
          <svg viewBox="0 0 16 16" className="size-4" aria-hidden>
            <path d="M4 6l4 4 4-4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </IconButton>
        <IconButton label={`Remove ${name}`} onClick={onRemove} disabled={count <= 1}>
          <svg viewBox="0 0 16 16" className="size-4" aria-hidden>
            <path d="M4 4l8 8M12 4l-8 8" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
          </svg>
        </IconButton>
      </div>

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
            className="field"
          />
        </div>
        <div className="w-36">
          <label htmlFor={`${id}weight`} className="label">
            Share<span className="sr-only"> of the {segmentLabel(round.segment)} score for {name}</span>
          </label>
          <div className="flex items-center gap-2">
            <input
              id={`${id}weight`}
              value={round.weight}
              onChange={(e) => onChange({ weight: e.target.value.replace(/[^0-9]/g, "").slice(0, 3) })}
              inputMode="numeric"
              className="field tabular w-20"
            />
            <span aria-hidden className="font-semibold">
              %
            </span>
          </div>
        </div>
      </div>

      <div className="mt-4 flex items-start gap-2.5">
        <input
          id={`${id}parts`}
          type="checkbox"
          className="mt-0.5 size-5 shrink-0"
          checked={round.parts !== null}
          onChange={(e) => toggleParts(e.target.checked)}
          aria-describedby={`${id}parts-hint`}
        />
        <div>
          <label htmlFor={`${id}parts`} className="block font-semibold">
            Score it in parts<span className="sr-only"> for {name}</span>
          </label>
          <p id={`${id}parts-hint`} className="hint">
            For one sub-activity with several deliverables, like a closed-door interview with its Q&amp;A, the advocacy and the advocacy video.
            Each part has its own scoring and share, and judges score each part on its own.
          </p>
        </div>
      </div>

      {round.parts === null ? (
        <ScoredFields
          id={id}
          name={name}
          scoring={round.scoring}
          timer={round.timer}
          startOpen={scoringOpen}
          onScoring={(scoring) => onChange({ scoring })}
          onTimer={(timer) => onChange({ timer })}
        />
      ) : (
        <PartsEditor round={round} name={name} onChange={(parts) => onChange({ parts })} />
      )}

      {round.segment === "proper" && (
        <div className={`mt-4 ${cut ? "rounded-xl bg-wash/60 p-4" : ""}`}>
          {final ? (
            <p className="font-semibold">
              Final cut<span className="hint ml-2 font-normal">Its order is the final placement, winner first.</span>
            </p>
          ) : (
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
                  className="field tabular w-20"
                />
                <span className="text-sm">{final ? "candidates are placed" : "candidates go through"}</span>
              </div>
              <fieldset>
                <legend className="text-sm font-semibold">
                  Ranked by<span className="sr-only"> for the cut after {name}</span>
                </legend>
                <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1.5">
                  {basisChoices(draft.rounds, round).map((choice) => (
                    <label key={choice.key} className="flex items-center gap-2 text-sm">
                      <input type="checkbox" className="size-4" checked={basis.includes(choice.key)} onChange={(e) => toggleBasis(choice.key, e.target.checked)} />
                      {choice.label}
                    </label>
                  ))}
                </div>
                {basis.length > 0 && (
                  <p className="hint mt-2">
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
 * One segment of a pageant's program: its sub-activities, in order, with their shares (adding up to 100%), scoring,
 * timers and, in pageant proper, cuts. The preliminary segment also sets its share of the overall score.
 */
export function SegmentEditor({ segment, draft, onChange }: { segment: Segment; draft: PageantDraft; onChange: (next: PageantDraft) => void }) {
  // Keys for new sub-activities count up within this editor (never Date.now() during render).
  const nextKey = useRef(0);
  const list = draft.rounds.filter((r) => r.segment === segment);
  const total = list.reduce((sum, r) => sum + (Number(r.weight) || 0), 0);
  const started = list.some((r) => r.weight !== "");
  const prelimShare = Number(draft.preliminaryWeight);

  const setRounds = (rounds: RoundDraft[]) => {
    // Keep the program in order: the preliminary segment first.
    onChange({ ...draft, rounds: [...rounds.filter((r) => r.segment === "preliminary"), ...rounds.filter((r) => r.segment === "proper")] });
  };
  const patch = (key: string, p: Partial<RoundDraft>) => setRounds(draft.rounds.map((r) => (r.key === key ? { ...r, ...p } : r)));
  const remove = (key: string) =>
    setRounds(draft.rounds.filter((r) => r.key !== key).map((r) => (r.cutBasis ? { ...r, cutBasis: r.cutBasis.filter((k) => k !== key) } : r)));
  const move = (key: string, direction: -1 | 1) => {
    const keys = list.map((r) => r.key);
    const from = keys.indexOf(key);
    const to = from + direction;
    if (to < 0 || to >= keys.length) return;
    [keys[from], keys[to]] = [keys[to], keys[from]];
    const moved = keys.map((k) => list.find((r) => r.key === k)!);
    setRounds([...draft.rounds.filter((r) => r.segment !== segment), ...moved]);
  };
  // A new sub-activity takes what's left of 100%; when nothing is left, the shares are split evenly to make room.
  const [evened, setEvened] = useState(false);
  const add = () => {
    const key = `new-${segment}-${nextKey.current++}-${list.length}`;
    const { shares, evened: split } = sharesWithOneMore(list.map((r) => r.weight));
    const added: RoundDraft = { key, segment, name: "", weight: "", scoring: blankScoring(), timer: "", cut: false, cutSize: "", cutBasis: null, parts: null };
    const weights = new Map([...list, added].map((r, i) => [r.key, shares[i]]));
    setRounds([...draft.rounds, added].map((r) => (weights.has(r.key) ? { ...r, weight: weights.get(r.key)! } : r)));
    setEvened(split);
  };

  return (
    <div className="space-y-4">
      {segment === "preliminary" && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <label htmlFor="preliminary-weight" className="font-semibold">
            The preliminary counts for
          </label>
          <input
            id="preliminary-weight"
            value={draft.preliminaryWeight}
            onChange={(e) => onChange({ ...draft, preliminaryWeight: e.target.value.replace(/[^0-9]/g, "").slice(0, 2) })}
            inputMode="numeric"
            className="field tabular w-20"
            aria-describedby="preliminary-weight-hint"
          />
          <span className="font-semibold">% of the overall score</span>
          <p id="preliminary-weight-hint" className="hint basis-full">
            {prelimShare >= 1 && prelimShare <= 99 ? `Pageant proper counts for the other ${100 - prelimShare}%. ` : ""}A cut that counts both segments
            uses these shares.
          </p>
        </div>
      )}

      <ol className="space-y-4">
        {list.map((round, i) => (
          <RoundCard
            key={round.key}
            draft={draft}
            round={round}
            index={i}
            count={list.length}
            onChange={(p) => patch(round.key, p)}
            onMove={(d) => move(round.key, d)}
            onRemove={() => remove(round.key)}
          />
        ))}
      </ol>

      <div className="flex flex-wrap items-center gap-4">
        <button type="button" className="btn btn-quiet btn-sm" onClick={add} disabled={draft.rounds.length >= MAX_ROUNDS}>
          Add a sub-activity
        </button>
        <SharesTotal total={total} started={started} of={segment === "preliminary" ? "preliminary" : "pageant proper"} />
      </div>
      {evened && <p className="hint">{EVENED}</p>}
    </div>
  );
}
