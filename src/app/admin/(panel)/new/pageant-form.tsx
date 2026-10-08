"use client";

import { useActionState, useEffect, useRef, useState, useTransition, type FormEvent } from "react";
import { basisWeights } from "@/lib/pageant";
import { basisOf, blankScoring, checkPageant, hasCut, type PageantDraft, type RoundDraft } from "@/lib/pageant-setup";
import { formatBound } from "@/lib/scoring";
import { isPersonName } from "@/lib/names";
import type { Round } from "@/lib/types";
import { createActivity, type FormResult } from "../../actions";
import { SegmentEditor } from "../program-editor";
import { ResultDecimalsField } from "../scoring-fields";
import { blankJudge, JudgesFields, MAX_JUDGES, type DraftJudge } from "./judges-fields";

const STEPS = ["Candidates", "Judges", "Preliminary", "Pageant proper", "Review"] as const;
const MAX_CANDIDATES = 300;

const startingProgram = (): PageantDraft => ({
  preliminaryWeight: "30",
  rounds: [
    { key: "new-preliminary", segment: "preliminary", name: "", weight: "100", scoring: blankScoring(), timer: "", cut: false, cutSize: "", cutBasis: null },
    { key: "new-proper", segment: "proper", name: "", weight: "100", scoring: blankScoring(), timer: "", cut: false, cutSize: "", cutBasis: null },
  ],
});

const lines = (text: string) => text.split(/\r?\n/).filter((l) => l.trim());

/** One line about a sub-activity for the review step. */
function roundSummary(round: RoundDraft): string {
  const s = round.scoring;
  const scoring = s.mode === "criteria" ? `criteria (${s.criteria.filter((c) => c.name.trim()).map((c) => c.name.trim()).join(", ")})` : `scores ${s.min} to ${s.max}`;
  return `${round.weight}%, ${scoring}${round.timer ? `, ${round.timer} seconds to score` : ""}`;
}

/** What a cut counts, as the review step words it: "Preliminary 30%, Swimsuit 70%". */
function basisSummary(draft: PageantDraft, round: RoundDraft): string {
  const rounds = draft.rounds.map((r, position) => ({ id: r.key, segment: r.segment, name: r.name, position, weight: Number(r.weight) || 0 }) as Round);
  return basisWeights(rounds, Number(draft.preliminaryWeight) || 0, basisOf(draft.rounds, round))
    .map((w) => `${w.round.name} ${formatBound(Math.round(w.weight * 100) / 100)}%`)
    .join(", ");
}

/**
 * Set up a pageant step by step: the candidates first, then the judges, the preliminary's sub-activities, pageant
 * proper's sub-activities and cuts, and a last look before creating it. Every step stays on the page (hidden), so
 * the whole pageant is sent at once and nothing is saved half-made.
 */
export function PageantForm() {
  const [state, dispatch] = useActionState<FormResult, FormData>(createActivity, null);
  const [pending, startTransition] = useTransition();
  const [step, setStep] = useState(0);
  const [stepError, setStepError] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [candidatesText, setCandidatesText] = useState("");
  const candidates = lines(candidatesText);
  const nextKey = useRef(3);
  const [judges, setJudges] = useState<DraftJudge[]>(() => [blankJudge(0), blankJudge(1), blankJudge(2)]);
  const [chairKey, setChairKey] = useState<number | null>(null);
  const [draft, setDraft] = useState<PageantDraft>(startingProgram);
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
    <form onSubmit={submit} noValidate className="mt-8 max-w-4xl">
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
                    <span className="font-semibold">{r.name.trim() || "Untitled"}</span> <span className="hint">{roundSummary(r)}</span>
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
                    <span className="font-semibold">{r.name.trim() || "Untitled"}</span> <span className="hint">{roundSummary(r)}</span>
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
        <ResultDecimalsField />
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
        {error && (
          <p role="alert" className="font-semibold text-danger">
            {error}
          </p>
        )}
      </div>
    </form>
  );
}
