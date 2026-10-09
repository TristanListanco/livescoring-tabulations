"use client";

import { useActionState, useEffect, useRef, useState, useTransition, type FormEvent } from "react";
import { basisWeights } from "@/lib/pageant";
import { basisOf, blankScoring, checkPageant, hasCut, parsePageantDraft, type PageantDraft, type RoundDraft, type ScoringDraft } from "@/lib/pageant-setup";
import { formatBound } from "@/lib/scoring";
import { isPersonName } from "@/lib/names";
import type { ResultDecimals, Round } from "@/lib/types";
import { createActivity, type FormResult } from "../../actions";
import { SegmentEditor } from "../program-editor";
import { DEFAULT_RESULT_DECIMALS, ResultDecimalsField } from "../scoring-fields";
import { blankJudge, JudgesFields, MAX_JUDGES, type DraftJudge } from "./judges-fields";
import { openJudges, SaveDraftButton, saveJudges, useDraft, type DraftHostProps } from "./use-draft";

const STEPS = ["Candidates", "Judges", "Preliminary", "Pageant proper", "Review"] as const;
const MAX_CANDIDATES = 300;

const startingProgram = (): PageantDraft => ({
  preliminaryWeight: "30",
  rounds: [
    { key: "new-preliminary", segment: "preliminary", name: "", weight: "100", scoring: blankScoring(), timer: "", cut: false, cutSize: "", cutBasis: null, parts: null },
    { key: "new-proper", segment: "proper", name: "", weight: "100", scoring: blankScoring(), timer: "", cut: false, cutSize: "", cutBasis: null, parts: null },
  ],
});

const lines = (text: string) => text.split(/\r?\n/).filter((l) => l.trim());

/** One line about how a sub-activity (or part) is scored, for the review step. */
function scoredSummary(weight: string, s: ScoringDraft, timer: string): string {
  const scoring = s.mode === "criteria" ? `criteria (${s.criteria.filter((c) => c.name.trim()).map((c) => c.name.trim()).join(", ")})` : `scores ${s.min} to ${s.max}`;
  return `${weight}%, ${scoring}${timer ? `, ${timer} seconds to score` : ""}`;
}

/** A sub-activity on the review step: its share and scoring, or its parts. */
function RoundSummary({ round }: { round: RoundDraft }) {
  if (!round.parts) {
    return (
      <>
        <span className="font-semibold">{round.name.trim() || "Untitled"}</span> <span className="hint">{scoredSummary(round.weight, round.scoring, round.timer)}</span>
      </>
    );
  }
  return (
    <>
      <span className="font-semibold">{round.name.trim() || "Untitled"}</span>{" "}
      <span className="hint">
        {round.weight}%, in {round.parts.length} parts
      </span>
      <ul className="mt-1 mb-1 space-y-0.5 border-l-2 border-line pl-3 text-sm">
        {round.parts.map((p) => (
          <li key={p.key}>
            <span className="font-semibold">{p.name.trim() || "Untitled part"}</span> <span className="hint">{scoredSummary(p.weight, p.scoring, p.timer)}</span>
          </li>
        ))}
      </ul>
    </>
  );
}

/** The pageant form's state, from a saved draft or blank. */
function opened(data: unknown) {
  const d = (typeof data === "object" && data !== null ? data : {}) as Record<string, unknown>;
  const judges = openJudges(d.judges) ?? [blankJudge(0), blankJudge(1), blankJudge(2)];
  const program = d.program ? parsePageantDraft(JSON.stringify(d.program)) : null;
  const places = Number(d.resultDecimals);
  const step = Number(d.step);
  return {
    step: Number.isInteger(step) && step >= 0 && step < STEPS.length ? step : 0,
    name: typeof d.name === "string" ? d.name : "",
    candidates: typeof d.candidates === "string" ? d.candidates : "",
    judges,
    chairKey: typeof d.chair === "number" && d.chair >= 0 && d.chair < judges.length ? d.chair : null,
    program: program && program.rounds.length ? program : startingProgram(),
    resultDecimals: (Number.isInteger(places) && places >= 0 && places <= 4 ? places : DEFAULT_RESULT_DECIMALS) as ResultDecimals,
  };
}

/** What a cut counts, as the review step words it: "Preliminary 30%, Swimsuit 70%". */
function basisSummary(draft: PageantDraft, round: RoundDraft): string {
  const rounds = draft.rounds.map((r, position) => ({ id: r.key, segment: r.segment, name: r.name, position, weight: Number(r.weight) || 0, parentId: null }) as Round);
  return basisWeights(rounds, Number(draft.preliminaryWeight) || 0, basisOf(draft.rounds, round))
    .map((w) => `${w.round.name} ${formatBound(Math.round(w.weight * 100) / 100)}%`)
    .join(", ");
}

/**
 * Set up a pageant step by step: the candidates first, then the judges, the preliminary's sub-activities, pageant
 * proper's sub-activities and cuts, and a last look before creating it. Every step stays on the page (hidden), so
 * the whole pageant is sent at once and nothing is saved half-made.
 */
export function PageantForm({ draft: openedDraft, onDirty, formRef, saveRef }: DraftHostProps) {
  const [state, dispatch] = useActionState<FormResult, FormData>(createActivity, null);
  const [pending, startTransition] = useTransition();
  const [start] = useState(() => opened(openedDraft?.data));
  const [step, setStep] = useState(start.step);
  const [stepError, setStepError] = useState<string | null>(null);
  const [name, setName] = useState(start.name);
  const [candidatesText, setCandidatesText] = useState(start.candidates);
  const candidates = lines(candidatesText);
  const nextKey = useRef(start.judges.length);
  const [judges, setJudges] = useState<DraftJudge[]>(start.judges);
  const [chairKey, setChairKey] = useState<number | null>(start.chairKey);
  const [draft, setDraft] = useState<PageantDraft>(start.program);
  const [resultDecimals, setResultDecimals] = useState<ResultDecimals>(start.resultDecimals);
  const chairIndex = judges.findIndex((j) => j.key === chairKey);
  // Saving keeps the step too, so a draft opens where it was left; moving between steps alone isn't a change to save.
  const saved = useDraft({
    openedId: openedDraft?.id ?? null,
    onDirty,
    saveRef,
    kind: "pageant",
    name,
    snapshot: JSON.stringify([name, candidatesText, judges.map((j) => [j.first, j.last, j.preview]), chairIndex, draft, resultDecimals]),
    collect: async () => ({
      step,
      name,
      candidates: candidatesText,
      judges: await saveJudges(judges),
      chair: chairIndex < 0 ? null : chairIndex,
      program: draft,
      resultDecimals,
    }),
  });
  const heading = useRef<HTMLHeadingElement>(null);
  const moved = useRef(false);

  // Each new step's heading takes focus, so keyboard and screen reader users start at the top of it.
  useEffect(() => {
    if (!moved.current) return;
    heading.current?.focus();
    heading.current?.scrollIntoView({ block: "start" });
  }, [step]);

  const problem = (i: number): string | null => {
    if (i === 0) {
      if (!name.trim()) return "Give the pageant a name.";
      if (candidates.length < 2) return "Add at least two candidates, one per line.";
      if (candidates.length > MAX_CANDIDATES) return `A pageant can have up to ${MAX_CANDIDATES} candidates.`;
    }
    if (i === 1) {
      for (const [n, j] of judges.entries()) {
        if (!j.first.trim() || !j.last.trim()) return `Enter Judge ${n + 1}'s first and last name.`;
        if (!isPersonName(j.first)) return `Use letters only for Judge ${n + 1}'s first name.`;
        if (!isPersonName(j.last)) return `Use letters only for Judge ${n + 1}'s last name.`;
      }
      if (!judges.some((j) => j.key === chairKey)) return "Choose the chair of the board of judges.";
    }
    if (i === 2 || i === 3) {
      const checked = checkPageant(draft, candidates.length, () => "");
      // The preliminary step only answers for itself; pageant proper is the next step's.
      if (!checked.ok && (i === 3 || checked.segment !== "proper")) return checked.error;
    }
    return null;
  };

  const go = (to: number) => {
    moved.current = true;
    setStepError(null);
    setStep(to);
  };
  const next = () => {
    const found = problem(step);
    if (found) setStepError(found);
    else go(step + 1);
  };

  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    // Enter in a field moves on a step rather than creating the pageant early.
    if (step < STEPS.length - 1) {
      next();
      return;
    }
    for (let i = 0; i < STEPS.length - 1; i++) {
      const found = problem(i);
      if (found) {
        go(i);
        setStepError(found);
        return;
      }
    }
    const data = new FormData(e.currentTarget);
    data.set("kind", "pageant");
    data.set("pageant", JSON.stringify(draft));
    data.set("judgeCount", String(judges.length));
    judges.forEach((j, i) => {
      if (j.photo) data.set(`judge-${i}-photo`, j.photo, "photo.jpg");
    });
    // Creating the pageant clears the draft it came from.
    if (saved.draftId) data.set("draftId", saved.draftId);
    startTransition(() => dispatch(data));
  };

  const addJudge = () => {
    const key = nextKey.current++;
    setJudges((list) => (list.length < MAX_JUDGES ? [...list, blankJudge(key)] : list));
  };
  const serverError = state && !state.ok ? state.error : null;
  const error = stepError ?? (step === STEPS.length - 1 ? serverError : null);
  const share = Number(draft.preliminaryWeight) || 0;
  const chair = judges.find((j) => j.key === chairKey);

  return (
    <form ref={formRef} onSubmit={submit} noValidate className="mt-8 max-w-4xl">
      <nav aria-label="Pageant setup steps">
        <ol className="flex flex-wrap gap-x-1 gap-y-2">
          {STEPS.map((label, i) => {
            const done = i < step;
            const current = i === step;
            const badge = (
              <span
                aria-hidden
                className={`tabular inline-flex size-6 items-center justify-center rounded-full text-xs font-bold ${
                  current ? "bg-regal text-mint" : done ? "bg-wash text-regal" : "border border-line text-prussian/75"
                }`}
              >
                {done ? "✓" : i + 1}
              </span>
            );
            return (
              <li key={label} className="flex items-center gap-1">
                {done ? (
                  <button type="button" className="btn btn-sm gap-2 px-2.5 font-semibold text-regal hover:bg-wash" onClick={() => go(i)}>
                    {badge}
                    {label}
                    <span className="sr-only"> (done, go back)</span>
                  </button>
                ) : (
                  <span aria-current={current ? "step" : undefined} className={`inline-flex h-9 items-center gap-2 px-2.5 text-sm font-semibold ${current ? "" : "text-prussian/75"}`}>
                    {badge}
                    {label}
                  </span>
                )}
                {i < STEPS.length - 1 && (
                  <span aria-hidden className="mx-1 inline-block h-px w-4 bg-line" />
                )}
              </li>
            );
          })}
        </ol>
      </nav>

      <h2 ref={heading} tabIndex={-1} className="mt-8 scroll-mt-6 text-2xl font-bold tracking-tight outline-none">
        <span className="sr-only">
          Step {step + 1} of {STEPS.length}:{" "}
        </span>
        {STEPS[step]}
      </h2>

      <section hidden={step !== 0} className="mt-5 space-y-6">
        <div>
          <label htmlFor="name" className="label">
            Pageant name
          </label>
          <input
            id="name"
            name="name"
            maxLength={120}
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="field max-w-xl"
            placeholder="e.g. Miss Intramurals 2026"
          />
        </div>
        <div>
          <label htmlFor="entries" className="label">
            Candidates, one per line
          </label>
          <textarea
            id="entries"
            name="entries"
            rows={12}
            value={candidatesText}
            onChange={(e) => setCandidatesText(e.target.value)}
            className="field h-auto max-w-xl py-2.5 leading-relaxed"
            aria-describedby="entries-hint"
          />
          <p id="entries-hint" className="hint tabular mt-2 max-w-xl">
            {candidates.length} {candidates.length === 1 ? "candidate" : "candidates"}, in running order. Each keeps their number through every cut.
            You can add photos and reorder them later.
          </p>
        </div>
      </section>

      <section hidden={step !== 1} className="mt-5">
        <p className="hint mb-5 max-w-2xl">
          The same judges score every sub-activity. Choose one as chair: the chair can move judging to the previous or next candidate from their own
          screen, and can&apos;t be changed later.
        </p>
        <JudgesFields
          judges={judges}
          chairKey={chairKey}
          onChange={(key, patch) => setJudges((list) => list.map((j) => (j.key === key ? { ...j, ...patch } : j)))}
          onRemove={(key) => setJudges((list) => (list.length > 1 ? list.filter((j) => j.key !== key) : list))}
          onChair={setChairKey}
          onAdd={addJudge}
        />
      </section>

      <section hidden={step !== 2} className="mt-5">
        <p className="hint mb-5 max-w-2xl">
          Sub-activities judged before the pageant night, like a closed-door interview or the national costume. Every candidate takes part. Give each a
          share of the preliminary score; the shares add up to 100%.
        </p>
        <SegmentEditor segment="preliminary" draft={draft} onChange={setDraft} />
      </section>

      <section hidden={step !== 3} className="mt-5">
        <p className="hint mb-5 max-w-2xl">
          The pageant night, like the production number, swimsuit, evening wear and Q&amp;A. Add a cut after any sub-activity to narrow the field
          (Top 10, Top 5). Only the candidates who go through are judged after it. The last sub-activity ends with the final cut, which places the
          winners.
        </p>
        <SegmentEditor segment="proper" draft={draft} onChange={setDraft} />
      </section>

      <section hidden={step !== 4} className="mt-5 space-y-8">
        <dl className="grid gap-x-8 gap-y-4 sm:grid-cols-[12rem_1fr]">
          <dt className="font-semibold">Pageant</dt>
          <dd>{name.trim() || "—"}</dd>
          <dt className="font-semibold">Candidates</dt>
          <dd className="tabular">{candidates.length}</dd>
          <dt className="font-semibold">Judges</dt>
          <dd>
            {judges.length}
            {chair && `, chaired by ${`${chair.first} ${chair.last}`.trim()}`}
          </dd>
          <dt className="font-semibold">Preliminary, {share}%</dt>
          <dd>
            <ul className="space-y-1">
              {draft.rounds
                .filter((r) => r.segment === "preliminary")
                .map((r) => (
                  <li key={r.key}>
                    <RoundSummary round={r} />
                  </li>
                ))}
            </ul>
          </dd>
          <dt className="font-semibold">Pageant proper, {100 - share}%</dt>
          <dd>
            <ul className="space-y-1">
              {draft.rounds
                .filter((r) => r.segment === "proper")
                .map((r, i, list) => (
                  <li key={r.key}>
                    <RoundSummary round={r} />
                    {hasCut(draft.rounds, r) && (
                      <p className="mt-1 mb-2 rounded-lg bg-wash/60 px-3 py-2 text-sm">
                        <span className="font-semibold">
                          {i === list.length - 1 ? "Final cut" : "Cut"}: Top {r.cutSize || "?"}
                        </span>
                        , ranked by {basisSummary(draft, r)}
                      </p>
                    )}
                  </li>
                ))}
            </ul>
          </dd>
        </dl>
        <ResultDecimalsField value={resultDecimals} onChange={setResultDecimals} />
        <p className="hint max-w-2xl">
          After the session starts, the program and the judges are locked so the rules can&apos;t change mid-show. Timers can still change.
        </p>
      </section>

      <div className="mt-8 flex flex-wrap items-center gap-4 border-t border-line pt-6">
        {step > 0 && (
          <button type="button" className="btn btn-quiet" onClick={() => go(step - 1)} disabled={pending}>
            Back
          </button>
        )}
        <button type="submit" className="btn btn-primary" disabled={pending}>
          {step < STEPS.length - 1 ? `Continue to ${STEPS[step + 1].toLowerCase()}` : pending ? "Creating…" : "Create pageant"}
        </button>
        <SaveDraftButton draft={saved} />
        {error && (
          <p role="alert" className="basis-full font-semibold text-danger">
            {error}
          </p>
        )}
      </div>
    </form>
  );
}
