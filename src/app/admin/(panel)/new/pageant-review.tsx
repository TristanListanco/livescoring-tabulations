"use client";

import { Fragment, useEffect, useRef, useState } from "react";
import { Avatar } from "@/components/avatar";
import { basisWeights } from "@/lib/pageant";
import {
  afterCut,
  aloneAfterCut,
  basisOf,
  hasCut,
  properStages,
  roundShare,
  shareText,
  type PageantDraft,
  type PartDraft,
  type RoundDraft,
  type ScoringDraft,
} from "@/lib/pageant-setup";
import { formatBound } from "@/lib/scoring";
import type { ResultDecimals, Round, Segment } from "@/lib/types";
import type { DraftCandidate } from "./candidates-fields";
import type { DraftJudge } from "./judges-fields";

/** "30%", "33.33%". */
const percent = (n: number) => `${formatBound(Math.round(n * 100) / 100)}%`;

const JUDGE_DECIMALS = ["Whole numbers", "1 decimal place", "2 decimal places"] as const;

const RESULT_DECIMALS: { value: ResultDecimals; label: string }[] = [0, 1, 2, 3, 4].map((n) => ({
  value: n as ResultDecimals,
  label: `${n === 0 ? "Whole numbers" : `${n} decimal place${n > 1 ? "s" : ""}`} (${(87.4567).toFixed(n)})`,
}));

/** What a cut counts, as weights: "Interview 40%, Swimsuit 60%". */
function basisSummary(draft: PageantDraft, round: RoundDraft): string {
  const rounds = draft.rounds.map((r, position) => ({ id: r.key, segment: r.segment, name: r.name.trim() || "Untitled", position, weight: Number(r.weight) || 0, parentId: null }) as Round);
  return basisWeights(rounds, Number(draft.preliminaryWeight) || 0, basisOf(draft.rounds, round))
    .map((w) => `${w.round.name} ${percent(w.weight)}`)
    .join(", ");
}

/** A criterion's range as the score sheet prints it: "28 to 40 points", or "up to 30 points" with no lowest score. */
const criterionRange = (c: ScoringDraft["criteria"][number]) => (c.min.trim() ? `${c.min.trim()} to ${c.max || "?"} points` : `up to ${c.max || "?"} points`);

/** How judges score a sub-activity or part, for its Scoring cell: the range or each criterion, then decimals and timer. */
function ScoringCell({ scoring, timer }: { scoring: ScoringDraft; timer: string }) {
  const criteria = scoring.criteria.filter((c) => c.name.trim());
  const details = [
    JUDGE_DECIMALS[scoring.decimals] ?? "",
    scoring.mode === "criteria" ? (scoring.display === "ten" ? "totals scaled to 10" : "totals as a percentage") : "",
    timer ? `${timer} s to score` : "",
  ].filter(Boolean);
  return (
    <>
      {scoring.mode === "criteria" ? (
        <ul className="space-y-0.5">
          {criteria.map((c) => (
            <li key={c.key}>
              {c.name.trim()} <span className="tabular text-prussian/75">{criterionRange(c)}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="tabular">
          Scores {scoring.min || "?"} to {scoring.max || "?"}
        </p>
      )}
      <p className="mt-0.5 text-sm text-prussian/70">{details.join(" · ")}</p>
    </>
  );
}

/** The violations the organizer can deduct points for, as the score sheet's deductions list them. */
function Deductions({ violations }: { violations: NonNullable<PageantDraft["violations"]> }) {
  const listed = violations.filter((v) => v.reason.trim());
  return (
    <div className="mt-5">
      <h5 className="text-sm font-semibold text-prussian/80">Deductions for violations</h5>
      <p className="text-sm text-prussian/75">Points off the preliminary score, given at the desk.</p>
      {listed.length > 0 ? (
        <ul className="mt-2 divide-y divide-line/70 border-y border-line/70">
          {listed.map((v) => (
            <li key={v.key} className="flex items-baseline justify-between gap-3 py-1.5">
              <span>{v.reason.trim()}</span>
              <span className="tabular shrink-0 text-prussian/80">
                {v.points.trim()} {Number(v.points) === 1 ? "point" : "points"}
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-1 text-sm">None listed: each one&apos;s reason and points are typed at the desk.</p>
      )}
    </div>
  );
}

/** A block of the sheet: its heading, an Edit button that goes back to its step, and what's in it. */
function Block({ title, meta, onEdit, editLabel, children }: { title: string; meta?: string; onEdit: () => void; editLabel: string; children: React.ReactNode }) {
  return (
    <section className="px-5 py-6 sm:px-7">
      {/* Edit stays on the heading's line; the note under it wraps on its own. */}
      <div className="mb-4 flex items-start gap-3">
        <div className="flex min-w-0 flex-1 flex-wrap items-baseline gap-x-3 gap-y-0.5">
          <h4 className="text-lg font-bold">{title}</h4>
          {meta && <p className="tabular text-sm text-prussian/75">{meta}</p>}
        </div>
        <button type="button" className="btn btn-sm -mt-0.5 shrink-0 px-2.5 font-semibold text-regal hover:bg-wash" onClick={onEdit}>
          Edit<span className="sr-only"> {editLabel}</span>
        </button>
      </div>
      {children}
    </section>
  );
}

const cell = "py-2.5 pr-3 align-top";

/** A sub-activity's rows: itself, or its name with a row per part under it. `share`: what its share reads as. */
function RoundRows({ round, share }: { round: RoundDraft; share: string }) {
  const name = round.name.trim() || "Untitled";
  if (!round.parts) {
    return (
      <tr>
        <th scope="row" className={`${cell} text-left font-semibold`}>
          {name}
        </th>
        <td className={`${cell} tabular text-right font-semibold`}>{share}</td>
        <td className={`${cell} pr-0`}>
          <ScoringCell scoring={round.scoring} timer={round.timer} />
        </td>
      </tr>
    );
  }
  return (
    <>
      <tr>
        <th scope="row" className={`${cell} text-left font-semibold`}>
          {name}
        </th>
        <td className={`${cell} tabular text-right font-semibold`}>{share}</td>
        <td className={`${cell} pr-0 text-prussian/75`}>In {round.parts.length} parts, each scored on its own</td>
      </tr>
      {round.parts.map((p: PartDraft) => (
        <tr key={p.key} className="text-[15px]">
          <th scope="row" className={`${cell} pl-4 text-left font-medium`}>
            <span className="sr-only">{name}, part: </span>
            {p.name.trim() || "Untitled part"}
          </th>
          <td className={`${cell} tabular text-right text-prussian/80`}>{p.weight}%</td>
          <td className={`${cell} pr-0`}>
            <ScoringCell scoring={p.scoring} timer={p.timer} />
          </td>
        </tr>
      ))}
    </>
  );
}

/**
 * Whether a box is narrower than what's in it, so it scrolls sideways: then it takes keyboard focus, so it can be
 * scrolled without a mouse. Checked again whenever either changes size (the Review step starts hidden).
 */
function useScrollsSideways() {
  const ref = useRef<HTMLDivElement>(null);
  const [scrolls, setScrolls] = useState(false);
  useEffect(() => {
    const box = ref.current;
    if (!box) return;
    const check = () => setScrolls(box.scrollWidth > box.clientWidth + 1);
    const observer = new ResizeObserver(check);
    observer.observe(box);
    if (box.firstElementChild) observer.observe(box.firstElementChild);
    return () => observer.disconnect();
  }, []);
  return [ref, scrolls] as const;
}

/** A segment's sub-activities as the score sheet lists them: share, scoring, and in pageant proper each cut in its place. */
function SegmentTable({ draft, segment }: { draft: PageantDraft; segment: Segment }) {
  const rounds = draft.rounds.filter((r) => r.segment === segment);
  const proper = segment === "proper";
  const stages = proper ? properStages(draft.rounds) : [rounds];
  const last = rounds.at(-1);
  const caption = `${proper ? "Pageant proper" : "Preliminary"}: each sub-activity's share and how it's scored`;
  const [box, scrolls] = useScrollsSideways();
  return (
    <div ref={box} className="-mx-1 overflow-x-auto px-1" {...(scrolls && { tabIndex: 0, role: "region", "aria-label": caption })}>
      <table className="w-full border-collapse text-left">
        <caption className="sr-only">{caption}</caption>
        <colgroup>
          <col className="w-[38%]" />
          <col className="w-16" />
          <col />
        </colgroup>
        <thead>
          <tr className="border-b border-line text-sm text-prussian/70">
            <th scope="col" className="pb-2 font-semibold">
              Sub-activity
            </th>
            <th scope="col" className="pr-3 pb-2 text-right font-semibold">
              Share
            </th>
            <th scope="col" className="pb-2 font-semibold">
              Scoring
            </th>
          </tr>
        </thead>
        {stages.map((stage, s) => {
          const cut = s > 0 ? stages[s - 1].at(-1)! : null;
          return (
            <tbody key={stage[0]?.key ?? s} className="divide-y divide-line/70">
              {cut && (
                <tr>
                  <th scope="rowgroup" colSpan={3} className="pt-5 pb-2 text-left font-semibold">
                    {`${afterCut(cut)[0].toUpperCase()}${afterCut(cut).slice(1)}`}, scores start over
                    <span className="block text-sm font-normal text-prussian/75">The shares below are of the score from here, adding up to 100%.</span>
                  </th>
                </tr>
              )}
              {stage.map((round) => {
                const share = aloneAfterCut(draft.rounds, round) && !round.parts ? "100%" : `${shareText(roundShare(round))}%`;
                const cutHere = proper && hasCut(draft.rounds, round);
                const final = round.key === last?.key;
                return (
                  <Fragment key={round.key}>
                    <RoundRows round={round} share={share} />
                    {cutHere && (
                      <tr className="bg-wash/70">
                        <td colSpan={3} className="px-3 py-2.5 text-[15px]">
                          <span className="font-semibold">
                            {final ? "Final cut" : "Cut"}: Top {round.cutSize || "?"}
                          </span>{" "}
                          {final ? "placed, winner first" : "go through"}
                          <span className="block text-sm text-prussian/75">Ranked by {basisSummary(draft, round)}</span>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          );
        })}
      </table>
    </div>
  );
}

const fullName = (j: DraftJudge) => `${j.first} ${j.last}`.trim();

function JudgeList({ judges, chairKey }: { judges: DraftJudge[]; chairKey: number | null }) {
  return (
    <ol className="space-y-2">
      {judges.map((j) => (
        <li key={j.key} className="flex items-center gap-2.5">
          <Avatar name={fullName(j)} src={j.preview} size={28} />
          <span className="min-w-0 truncate">{fullName(j)}</span>
          {j.key === chairKey && <span className="rounded-full bg-wash px-2 py-0.5 text-xs font-semibold">Chair</span>}
        </li>
      ))}
    </ol>
  );
}

/**
 * The last step of the pageant setup, laid out like the score sheet it was set up from: the program with each
 * share, scoring and cut in place, then the candidates in running order and the judges by board. Each block can
 * be edited from here, so checking it against the paper sheet takes one look.
 */
export function PageantReview({
  name,
  draft,
  candidates,
  separate,
  preliminaryBoard,
  properBoard,
  chairs,
  resultDecimals,
  onResultDecimals,
  onEdit,
}: {
  name: string;
  draft: PageantDraft;
  candidates: DraftCandidate[];
  separate: boolean;
  preliminaryBoard: DraftJudge[];
  properBoard: DraftJudge[];
  chairs: { preliminary: number | null; proper: number | null };
  resultDecimals: ResultDecimals;
  onResultDecimals: (value: ResultDecimals) => void;
  /** Go back to a step of the setup: 0 candidates, 1 judges, 2 preliminary, 3 pageant proper. */
  onEdit: (step: number) => void;
}) {
  const share = Number(draft.preliminaryWeight) || 0;
  const judgeCount = preliminaryBoard.length + properBoard.length;
  return (
    <div className="overflow-hidden rounded-2xl bg-white ring-1 ring-line">
      <header className="flex flex-wrap items-end gap-x-6 gap-y-3 border-b border-line px-5 py-6 sm:px-7">
        {/* The name keeps a readable width; the results choice goes under it on a phone. */}
        <div className="min-w-0 flex-1 basis-64">
          <h3 className="text-2xl font-bold tracking-tight text-balance wrap-anywhere">{name.trim() || "Untitled pageant"}</h3>
          <p className="tabular mt-1 text-prussian/75">
            {candidates.length} {candidates.length === 1 ? "candidate" : "candidates"} · {judgeCount} {judgeCount === 1 ? "judge" : "judges"}
            {separate ? " on two boards" : ""} · Preliminary {share}%, pageant proper {100 - share}%
          </p>
        </div>
        <div>
          <label htmlFor="result-decimals" className="mb-1 block text-sm font-semibold">
            Results shown to
          </label>
          <select
            id="result-decimals"
            name="result_decimals"
            value={resultDecimals}
            onChange={(e) => onResultDecimals(Number(e.target.value) as ResultDecimals)}
            className="field h-10 w-auto py-0"
          >
            {RESULT_DECIMALS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </div>
      </header>

      <div className="divide-y divide-line">
        <Block title="Preliminary" meta={`${share}% of the overall score`} onEdit={() => onEdit(2)} editLabel="the preliminary">
          <SegmentTable draft={draft} segment="preliminary" />
          {draft.violations && <Deductions violations={draft.violations} />}
        </Block>
        <Block title="Pageant proper" meta={`${100 - share}% of the overall score, then each cut starts over`} onEdit={() => onEdit(3)} editLabel="pageant proper">
          <SegmentTable draft={draft} segment="proper" />
        </Block>
        <Block
          title="Candidates"
          meta={`${candidates.length} in running order${candidates.some((c) => c.photo) ? `, ${candidates.filter((c) => c.photo).length} with photos` : ""}`}
          onEdit={() => onEdit(0)}
          editLabel="the candidates"
        >
          <ol className="grid gap-x-6 gap-y-2 sm:grid-cols-2 lg:grid-cols-3">
            {candidates.map((c, i) => (
              <li key={c.key} className="flex min-w-0 items-center gap-2.5">
                <span className="tabular w-7 shrink-0 text-right text-sm font-semibold text-prussian/70">
                  <span className="sr-only">No. </span>
                  {i + 1}
                </span>
                <Avatar name={c.name.trim() || "?"} src={c.preview} size={28} square />
                <span className="min-w-0 truncate">{c.name.trim() || "Unnamed"}</span>
              </li>
            ))}
          </ol>
        </Block>
        <Block
          title={separate ? "Boards of judges" : "Board of judges"}
          meta={separate ? "Each board judges its own segment" : "Judges both segments"}
          onEdit={() => onEdit(1)}
          editLabel="the judges"
        >
          {separate ? (
            <div className="grid gap-6 sm:grid-cols-2">
              <div>
                <h5 className="mb-2 text-sm font-semibold text-prussian/80">Preliminary · {preliminaryBoard.length}</h5>
                <JudgeList judges={preliminaryBoard} chairKey={chairs.preliminary} />
              </div>
              <div>
                <h5 className="mb-2 text-sm font-semibold text-prussian/80">Pageant proper · {properBoard.length}</h5>
                <JudgeList judges={properBoard} chairKey={chairs.proper} />
              </div>
            </div>
          ) : (
            <JudgeList judges={properBoard} chairKey={chairs.proper} />
          )}
        </Block>
      </div>
    </div>
  );
}
