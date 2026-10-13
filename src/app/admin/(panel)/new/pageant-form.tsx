"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition, type FormEvent } from "react";
import { blankScoring, checkPageant, MIN_PROPER_JUDGES, parsePageantDraft, type PageantDraft, type ProgramTarget } from "@/lib/pageant-setup";
import { isPersonName } from "@/lib/names";
import type { JudgePanel, ResultDecimals } from "@/lib/types";
import { addCandidatePhoto, createPageant, type CreateResult } from "../../actions";
import { describedBy, FieldProblem, FieldProblemsProvider, problemId } from "../field-errors";
import { SegmentEditor } from "../program-editor";
import { DEFAULT_RESULT_DECIMALS } from "../scoring-fields";
import { blankCandidate, CandidatesFields, MAX_CANDIDATES, type DraftCandidate, type PasteResult } from "./candidates-fields";
import { blankJudge, JudgesFields, MAX_JUDGES, type DraftJudge } from "./judges-fields";
import { PageantReview } from "./pageant-review";
import { openCandidates, openJudges, SaveDraftButton, saveCandidates, saveJudges, useDraft, type DraftHostProps } from "./use-draft";

const STEPS = ["Candidates", "Judges", "Preliminary", "Pageant proper", "Review"] as const;

/** One board of judges for the whole pageant, or separate boards for the preliminary and pageant proper. */
type Boards = "one" | "separate";
/** Each board's chair by row key. One board's chair is `proper`'s. */
type Chairs = { preliminary: number | null; proper: number | null };

const BOARD_OPTIONS: { value: Boards; label: string; hint: string }[] = [
  { value: "one", label: "One board for the whole pageant", hint: "The same judges score the preliminary and pageant proper, with one chair." },
  {
    value: "separate",
    label: "Separate boards",
    hint: "The preliminary has its own judges and pageant proper its own, each board with its own chair.",
  },
];


const startingProgram = (): PageantDraft => ({
  preliminaryWeight: "30",
  rounds: [
    // Shares are percentages of the overall score: the preliminary's 30% and pageant proper's 70% to start.
    { key: "new-preliminary", segment: "preliminary", name: "", weight: "30", scoring: blankScoring(), timer: "", cut: false, cutSize: "", cutBasis: null, parts: null },
    { key: "new-proper", segment: "proper", name: "", weight: "70", scoring: blankScoring(), timer: "", cut: false, cutSize: "", cutBasis: null, parts: null },
  ],
});

const cleanName = (name: string) => name.replace(/\s+/g, " ").trim();
const OFFLINE = "That didn't reach the server. Check this screen's connection and try again.";

/** Something to fix before moving on: what, and the id of the field it's about when there is one. */
/** `also`: other fields to mark with it, whose message is the first field's (a judge's blank first and last name). */
type Problem = { message: string; field?: string; also?: string[] };

/** The id of the list of a step's problems, focused when no problem has a field of its own. */
const STEP_PROBLEMS = "step-problems";

/** The field a program problem points at, by the ids the program editor gives its fields. */
function programField(target: ProgramTarget | undefined): string | undefined {
  if (!target) return undefined;
  if (target.input === "preliminary") return "preliminary-weight";
  if (target.input === "violation") return `violation-${target.key}-${target.field}`;
  const base = target.part ? `part-${target.part}-` : `round-${target.round}-`;
  return `${base}${target.input === "share" ? "weight" : target.input}`;
}

/**
 * Take focus to a field and bring it into view. A scoring panel it's in (or heads) opens, so what needs fixing
 * inside it shows.
 */
function focusField(id: string) {
  const field = document.getElementById(id);
  if (!field) return;
  const folded = field.closest("details");
  if (folded && !folded.open) folded.open = true;
  field.focus({ preventScroll: true });
  field.scrollIntoView({ block: "center" });
}

/**
 * A step's problems at the top of the step, each linking to its field. Not a live region: focus goes to the first
 * problem's field, which reads out its own message, so this doesn't repeat itself on every keystroke.
 */
function StepProblems({ problems, onPick }: { problems: Problem[]; onPick: (field: string) => void }) {
  return (
    <div id={STEP_PROBLEMS} tabIndex={-1} aria-labelledby={`${STEP_PROBLEMS}-title`} className="mt-5 max-w-2xl rounded-xl border border-danger/40 bg-danger/5 px-4 py-3 outline-none focus-visible:ring-2 focus-visible:ring-danger/40">
      <h3 id={`${STEP_PROBLEMS}-title`} className="font-semibold text-danger-ink">
        {problems.length === 1 ? "Fix this to continue" : `Fix these ${problems.length} things to continue`}
      </h3>
      <ul className="mt-1.5 space-y-1 text-[15px]">
        {problems.map((p, i) => (
          <li key={`${p.field ?? "step"}-${i}`}>
            {p.field ? (
              <a
                href={`#${p.field}`}
                onClick={(e) => {
                  e.preventDefault();
                  onPick(p.field!);
                }}
                className="text-danger-ink underline underline-offset-2 hover:no-underline"
              >
                {p.message}
              </a>
            ) : (
              p.message
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

/** The pageant form's state, from a saved draft or blank. */
function opened(data: unknown) {
  const d = (typeof data === "object" && data !== null ? data : {}) as Record<string, unknown>;
  const boards: Boards = d.boards === "separate" ? "separate" : "one";
  // Separate boards' judges are on one or the other; one board's judge both segments.
  const judges = (openJudges(d.judges) ?? [blankJudge(0), blankJudge(1), blankJudge(2)]).map((j) => ({
    ...j,
    panel: (boards === "one" ? "all" : j.panel === "preliminary" ? "preliminary" : "proper") as JudgePanel,
  }));
  // Chairs by position in the saved list. Drafts saved before separate boards kept one, as `chair`.
  const keyAt = (value: unknown) => (typeof value === "number" && Number.isInteger(value) && value >= 0 && value < judges.length ? judges[value].key : null);
  const savedChairs = (typeof d.chairs === "object" && d.chairs !== null ? d.chairs : {}) as Record<string, unknown>;
  const saved = openCandidates(d.candidates);
  const candidates = saved.length ? saved : [blankCandidate(0), blankCandidate(1), blankCandidate(2)];
  const program = d.program ? parsePageantDraft(JSON.stringify(d.program)) : null;
  const places = Number(d.resultDecimals);
  const step = Number(d.step);
  return {
    step: Number.isInteger(step) && step >= 0 && step < STEPS.length ? step : 0,
    name: typeof d.name === "string" ? d.name : "",
    candidates,
    boards,
    judges,
    chairs: { preliminary: boards === "separate" ? keyAt(savedChairs.preliminary) : null, proper: keyAt(savedChairs.proper ?? d.chair) } as Chairs,
    program: program && program.rounds.length ? program : startingProgram(),
    resultDecimals: (Number.isInteger(places) && places >= 0 && places <= 4 ? places : DEFAULT_RESULT_DECIMALS) as ResultDecimals,
  };
}

/**
 * Set up a pageant step by step: the candidates first, then the judges, the preliminary's sub-activities, pageant
 * proper's sub-activities and cuts, and a last look before creating it. Every step stays on the page (hidden), so
 * the whole pageant is sent at once and nothing is saved half-made.
 */
export function PageantForm({ draft: openedDraft, onDirty, formRef, saveRef }: DraftHostProps) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [serverError, setServerError] = useState<string | null>(null);
  // While creating: "Uploading candidate photos, 3 of 12…". Once created with photos that didn't upload: whose.
  const [progress, setProgress] = useState<string | null>(null);
  const [created, setCreated] = useState<{ id: string; missed: string[] } | null>(null);
  const [start] = useState(() => opened(openedDraft?.data));
  const [step, setStep] = useState(start.step);
  // The step whose problems show: set when Continue (or Create) finds some, and re-checked as the organizer types,
  // so each message goes as soon as its field is fixed. `attempt` counts tries, so the same step can refocus.
  const [checkedStep, setCheckedStep] = useState<number | null>(null);
  const [attempt, setAttempt] = useState(0);
  const focusNext = useRef<string | null>(null);
  const [name, setName] = useState(start.name);
  const [candidates, setCandidates] = useState<DraftCandidate[]>(start.candidates);
  const nextCandidate = useRef(start.candidates.length);
  /**
   * A list pasted into a candidate's name: that row takes the first name, then the blank rows right after it, then
   * new rows inserted there, so names already typed further down keep their places after the pasted ones.
   */
  const pasteNames = (key: number, names: string[]): PasteResult => {
    const list = [...candidates];
    let at = list.findIndex((c) => c.key === key);
    if (at < 0) return { placed: 0, dropped: names.length, lastKey: key };
    let placed = 0;
    let dropped = 0;
    let lastKey = key;
    names.forEach((name, n) => {
      const next = list[at + 1];
      if (n === 0) {
        list[at] = { ...list[at], name };
      } else if (next && !next.name.trim()) {
        list[++at] = { ...next, name };
        lastKey = next.key;
      } else if (list.length < MAX_CANDIDATES) {
        const added = { ...blankCandidate(nextCandidate.current++), name };
        list.splice(++at, 0, added);
        lastKey = added.key;
      } else {
        dropped++;
        return;
      }
      placed++;
    });
    setCandidates(list);
    return { placed, dropped, lastKey };
  };
  const nextKey = useRef(start.judges.length);
  const [boards, setBoards] = useState<Boards>(start.boards);
  const [judges, setJudges] = useState<DraftJudge[]>(start.judges);
  const [chairs, setChairs] = useState<Chairs>(start.chairs);
  const [draft, setDraft] = useState<PageantDraft>(start.program);
  const [resultDecimals, setResultDecimals] = useState<ResultDecimals>(start.resultDecimals);
  const separate = boards === "separate";
  const preliminaryBoard = separate ? judges.filter((j) => j.panel === "preliminary") : [];
  const properBoard = separate ? judges.filter((j) => j.panel !== "preliminary") : judges;
  // The order judges are saved and numbered in: a separate preliminary board first.
  const ordered = [...preliminaryBoard, ...properBoard];
  const positionOf = (key: number | null) => {
    const at = ordered.findIndex((j) => j.key === key);
    return at < 0 ? null : at;
  };
  const chairPositions = { preliminary: separate ? positionOf(chairs.preliminary) : null, proper: positionOf(chairs.proper) };
  // Saving keeps the step too, so a draft opens where it was left; moving between steps alone isn't a change to save.
  const saved = useDraft({
    openedId: openedDraft?.id ?? null,
    onDirty,
    saveRef,
    kind: "pageant",
    name,
    snapshot: JSON.stringify([
      name,
      candidates.map((c) => [c.name, c.preview]),
      boards,
      ordered.map((j) => [j.first, j.last, j.preview, j.panel]),
      chairPositions,
      draft,
      resultDecimals,
    ]),
    collect: async (note) => {
      const savedJudges = await saveJudges(ordered);
      const { saved, dropped } = await saveCandidates(candidates, savedJudges.reduce((n, j) => n + (j.photo?.length ?? 0), 0));
      if (dropped) {
        note(
          `${dropped === 1 ? "One candidate's photo" : `${dropped} candidates' photos`} didn't fit in the draft. Add ${dropped === 1 ? "it" : "them"} again before creating the pageant, or later on its Candidates tab.`,
        );
      }
      return { step, name, candidates: saved, boards, judges: savedJudges, chairs: chairPositions, program: draft, resultDecimals };
    },
  });
  const heading = useRef<HTMLHeadingElement>(null);
  const moved = useRef(false);

  // A new step's heading takes focus, so keyboard and screen reader users start at the top of it. After a try that
  // found problems, the first problem's field does instead (or the list of problems, when it has no field).
  useEffect(() => {
    const target = focusNext.current;
    focusNext.current = null;
    if (target) {
      focusField(target);
      return;
    }
    if (!moved.current) return;
    heading.current?.focus();
    heading.current?.scrollIntoView({ block: "start" });
  }, [step, attempt]);

  /** Every problem on a step, each with the id of the field it's about when there is one. */
  const problems = (i: number): Problem[] => {
    const found: Problem[] = [];
    if (i === 0) {
      if (!name.trim()) found.push({ message: "Give the pageant a name.", field: "name" });
      candidates.forEach((c, n) => {
        if (!c.name.trim()) found.push({ message: `Enter candidate ${n + 1}'s name, or remove the row.`, field: `candidate-${c.key}` });
      });
      if (candidates.length < 2) found.push({ message: "Add at least two candidates.", field: "add-candidate" });
      if (candidates.length > MAX_CANDIDATES) found.push({ message: `A pageant can have up to ${MAX_CANDIDATES} candidates.` });
    }
    if (i === 1) {
      // Each judge's name, then the board's chair, board by board; then pageant proper's three judges.
      const board = (list: DraftJudge[], who: string, start: number, chairKey: number | null, chairMessage: string) => {
        list.forEach((j, n) => {
          const at = start + n;
          if (!j.first.trim() || !j.last.trim()) {
            const blank = (["first", "last"] as const).filter((part) => !j[part].trim()).map((part) => `judge-${at}-${part}_name`);
            found.push({ message: `Enter ${who} ${n + 1}'s first and last name.`, field: blank[0], also: blank.slice(1) });
            return;
          }
          if (!isPersonName(j.first)) found.push({ message: `Use letters only for ${who} ${n + 1}'s first name.`, field: `judge-${at}-first_name` });
          if (!isPersonName(j.last)) found.push({ message: `Use letters only for ${who} ${n + 1}'s last name.`, field: `judge-${at}-last_name` });
        });
        if (list.length && !list.some((j) => j.key === chairKey)) found.push({ message: chairMessage, field: `judge-${start}-chair` });
      };
      if (separate) {
        board(preliminaryBoard, "preliminary judge", 0, chairs.preliminary, "Choose the chair of the preliminary board of judges.");
        board(properBoard, "pageant proper judge", preliminaryBoard.length, chairs.proper, "Choose the chair of the pageant proper board of judges.");
      } else {
        board(judges, "judge", 0, chairs.proper, "Choose the chair of the board of judges.");
      }
      const short = MIN_PROPER_JUDGES - properBoard.length;
      if (short > 0) {
        found.push({
          message: `Pageant proper needs at least three judges. Add ${short === 1 ? "one more judge" : `${short} more judges`}${separate ? " to its board" : ""}.`,
          field: separate ? "add-judge-proper" : "add-judge",
        });
      }
    }
    if (i === 2 || i === 3) {
      // The program's check stops at its first problem: it's shown at its field, and the next one after it's fixed.
      const checked = checkPageant(draft, candidates.length, () => "");
      // The preliminary step only answers for itself; pageant proper is the next step's.
      if (!checked.ok && (i === 3 || checked.segment !== "proper")) found.push({ message: checked.error, field: programField(checked.target) });
    }
    return found;
  };

  const go = (to: number) => {
    moved.current = true;
    setCheckedStep(null);
    setStep(to);
  };
  /** Show a step's problems and take focus to the first. */
  const report = (at: number, found: Problem[]) => {
    focusNext.current = found.find((p) => p.field)?.field ?? STEP_PROBLEMS;
    setCheckedStep(at);
    setStep(at);
    setAttempt((n) => n + 1);
  };
  const next = () => {
    const found = problems(step);
    if (found.length) report(step, found);
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
      const found = problems(i);
      if (found.length) {
        report(i, found);
        return;
      }
    }
    const data = new FormData(e.currentTarget);
    data.set("kind", "pageant");
    data.set("entries", candidates.map((c) => cleanName(c.name)).join("\n"));
    data.set("pageant", JSON.stringify(draft));
    data.set("judgeCount", String(ordered.length));
    ordered.forEach((j, i) => {
      data.set(`judge-${i}-panel`, j.panel);
      if (j.photo) data.set(`judge-${i}-photo`, j.photo, "photo.jpg");
    });
    // A chair per board, by position: "0" for one board, "0,3" for separate ones.
    data.set("chair", [chairPositions.preliminary, chairPositions.proper].filter((n) => n !== null).join(","));
    // Creating the pageant clears the draft it came from.
    if (saved.draftId) data.set("draftId", saved.draftId);
    setServerError(null);
    startTransition(() => create(data));
  };

  // The pageant first, then each candidate's photo on its own: together they can be more than one request carries.
  const create = async (data: FormData) => {
    let result: CreateResult;
    try {
      result = await createPageant(data);
    } catch {
      result = { ok: false, error: OFFLINE };
    }
    if (!result.ok) {
      setServerError(result.error);
      return;
    }
    // It's saved now, so nothing is lost by leaving: the photos still to come can be added on the Candidates tab.
    onDirty(false);
    const { activityId, entryIds } = result;
    const photos = candidates.flatMap((c, i) => (c.photo && entryIds[i] ? [{ name: cleanName(c.name), photo: c.photo, entryId: entryIds[i] }] : []));
    const missed: string[] = [];
    for (const [n, c] of photos.entries()) {
      setProgress(`Uploading candidate photos, ${n + 1} of ${photos.length}…`);
      const body = new FormData();
      body.set("photo", c.photo, "photo.jpg");
      const uploaded = await addCandidatePhoto(c.entryId, body).catch(() => null);
      if (!uploaded?.ok) missed.push(c.name);
    }
    setProgress(null);
    if (missed.length) setCreated({ id: activityId, missed });
    else router.push(`/admin/${activityId}`);
  };

  const addJudge = (panel: JudgePanel) => {
    const key = nextKey.current++;
    setJudges((list) => (list.length < MAX_JUDGES ? [...list, blankJudge(key, panel)] : list));
  };
  const updateJudge = (key: number, patch: Partial<DraftJudge>) => setJudges((list) => list.map((j) => (j.key === key ? { ...j, ...patch } : j)));
  const removeJudge = (key: number) => setJudges((list) => list.filter((j) => j.key !== key));

  // Separate boards: the judges so far make up pageant proper's, and the preliminary's starts with three rows.
  // One board again: everyone typed in either judges both segments.
  const chooseBoards = (next: Boards) => {
    if (next === boards) return;
    setBoards(next);
    // New rows to fill in: their problems wait for the next Continue.
    setCheckedStep(null);
    if (next === "separate") {
      const preliminary = [0, 1, 2].map(() => blankJudge(nextKey.current++, "preliminary"));
      setJudges([...preliminary, ...judges.map((j) => ({ ...j, panel: "proper" as const }))]);
      setChairs((c) => ({ preliminary: null, proper: c.proper }));
      return;
    }
    const kept: DraftJudge[] = ordered.filter((j) => j.first.trim() || j.last.trim() || j.photo).map((j) => ({ ...j, panel: "all" }));
    while (kept.length < MIN_PROPER_JUDGES) kept.push(blankJudge(nextKey.current++));
    setJudges(kept);
    setChairs((c) => {
      const chair = [c.proper, c.preliminary].find((key) => kept.some((j) => j.key === key)) ?? null;
      return { preliminary: null, proper: chair };
    });
  };
  const error = step === STEPS.length - 1 ? serverError : null;
  // Live: a fixed field's message goes as soon as it's fixed.
  const shownProblems = checkedStep === step ? problems(step) : [];
  const fieldProblems = new Map<string, string>();
  for (const p of shownProblems) if (p.field && !fieldProblems.has(p.field)) fieldProblems.set(p.field, p.message);
  // Marked, with the message shown once, at the first field.
  for (const p of shownProblems) for (const field of p.also ?? []) if (!fieldProblems.has(field)) fieldProblems.set(field, "");

  if (created) {
    return (
      <div className="mt-8 max-w-2xl space-y-4">
        <p role="alert" className="note">
          {cleanName(name)} is created, but {created.missed.length === 1 ? "this photo" : `these ${created.missed.length} photos`} didn&apos;t upload:{" "}
          {created.missed.join(", ")}. Add {created.missed.length === 1 ? "it" : "them"} from the pageant&apos;s Candidates tab.
        </p>
        <button type="button" className="btn btn-primary" onClick={() => router.push(`/admin/${created.id}`)}>
          Open the pageant
        </button>
      </div>
    );
  }

  return (
    <FieldProblemsProvider value={fieldProblems}>
      <form
        ref={formRef}
        onSubmit={submit}
        // Enter in a field never changes step: only the Continue button does. (Name lists go to their next line.)
        onKeyDown={(e) => {
          const field = e.target;
          if (e.key === "Enter" && field instanceof HTMLInputElement && !["submit", "button", "image", "reset"].includes(field.type)) e.preventDefault();
        }}
        noValidate
        className="mt-8 max-w-4xl"
      >
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
                    // On phones the steps wrap, so the connectors would dangle at line ends.
                    <span aria-hidden className="mx-1 hidden h-px w-4 bg-line sm:inline-block" />
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

        {shownProblems.length > 0 && <StepProblems problems={shownProblems} onPick={focusField} />}

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
              className={`field max-w-xl ${fieldProblems.has("name") ? "border-danger" : ""}`}
              placeholder="e.g. Miss Intramurals 2026"
              aria-invalid={fieldProblems.has("name") || undefined}
              aria-describedby={describedBy(fieldProblems.has("name") && problemId("name"))}
            />
            <FieldProblem fieldId="name" />
          </div>
          <div>
            <h3 className="label">Candidates</h3>
            <p className="hint mb-4 max-w-2xl">
              Add each candidate&apos;s photo for the LED wall, shown beside their name and number. Photos are optional and can be added or changed
              later too.
            </p>
            <CandidatesFields
              candidates={candidates}
              onChange={(key, patch) => setCandidates((list) => list.map((c) => (c.key === key ? { ...c, ...patch } : c)))}
              onRemove={(key) => setCandidates((list) => list.filter((c) => c.key !== key))}
              onMove={(key, direction) =>
                setCandidates((list) => {
                  const i = list.findIndex((c) => c.key === key);
                  const j = i + direction;
                  if (i < 0 || j < 0 || j >= list.length) return list;
                  const next = [...list];
                  [next[i], next[j]] = [next[j], next[i]];
                  return next;
                })
              }
              onAdd={() => {
                const key = nextCandidate.current++;
                setCandidates((list) => (list.length < MAX_CANDIDATES ? [...list, blankCandidate(key)] : list));
              }}
              onPasteNames={pasteNames}
            />
          </div>
        </section>

        <section hidden={step !== 1} className="mt-5 space-y-8">
          <fieldset className="max-w-3xl">
            <legend className="label">Boards of judges</legend>
            <div className="grid gap-2 sm:grid-cols-2">
              {BOARD_OPTIONS.map((o) => (
                <label key={o.value} className="choice">
                  <input type="radio" name="boards" className="mt-1" checked={boards === o.value} onChange={() => chooseBoards(o.value)} />
                  <span>
                    <span className="block font-semibold">{o.label}</span>
                    <span className="block text-sm opacity-80">{o.hint}</span>
                  </span>
                </label>
              ))}
            </div>
            <p className="hint mt-3">
              Pageant proper needs at least three judges. A chair can move judging to the previous or next candidate from their own screen, and
              can&apos;t be changed later.
            </p>
          </fieldset>
          {separate ? (
            <>
              <section aria-labelledby="preliminary-board">
                <h3 id="preliminary-board" className="text-lg font-bold">
                  Preliminary board of judges
                </h3>
                <p className="hint mt-1 mb-4 max-w-2xl">Judges the preliminary&apos;s sub-activities only. Choose one of them as its chair.</p>
                <JudgesFields
                  judges={preliminaryBoard}
                  chairKey={chairs.preliminary}
                  onChange={updateJudge}
                  onRemove={removeJudge}
                  onChair={(key) => setChairs((c) => ({ ...c, preliminary: key }))}
                  onAdd={() => addJudge("preliminary")}
                  who="Preliminary judge"
                  chairOf="the preliminary board"
                  chairGroup="chair-preliminary"
                  addTo="the preliminary board"
                  full={judges.length >= MAX_JUDGES}
                />
              </section>
              <section aria-labelledby="proper-board">
                <h3 id="proper-board" className="text-lg font-bold">
                  Pageant proper board of judges
                </h3>
                <p className="hint mt-1 mb-4 max-w-2xl">
                  Judges pageant proper&apos;s sub-activities and cuts, with its own chair. Someone on both boards is added to each, and gets a judge
                  code for each.
                </p>
                <JudgesFields
                  judges={properBoard}
                  chairKey={chairs.proper}
                  onChange={updateJudge}
                  onRemove={removeJudge}
                  onChair={(key) => setChairs((c) => ({ ...c, proper: key }))}
                  onAdd={() => addJudge("proper")}
                  start={preliminaryBoard.length}
                  who="Pageant proper judge"
                  chairOf="the pageant proper board"
                  chairGroup="chair-proper"
                  addTo="the pageant proper board"
                  full={judges.length >= MAX_JUDGES}
                />
              </section>
            </>
          ) : (
            <JudgesFields
              judges={judges}
              chairKey={chairs.proper}
              onChange={updateJudge}
              onRemove={removeJudge}
              onChair={(key) => setChairs({ preliminary: null, proper: key })}
              onAdd={() => addJudge("all")}
            />
          )}
        </section>

        <section hidden={step !== 2} className="mt-5">
          <p className="hint mb-5 max-w-[65ch]">
            Each sub-activity&apos;s share is of the overall score, as on the score sheet. One with several deliverables, like an interview and its
            advocacy, can be scored in parts.
          </p>
          <SegmentEditor segment="preliminary" draft={draft} onChange={setDraft} />
        </section>

        <section hidden={step !== 3} className="mt-5">
          <p className="hint mb-5 max-w-[65ch]">
            Add a cut after any sub-activity to narrow the field, like a Top 10 or Top 5. The last one ends in the final cut, which places the
            winners.
          </p>
          <SegmentEditor segment="proper" draft={draft} onChange={setDraft} candidates={candidates.length} />
        </section>

        <section hidden={step !== 4} className="mt-5 space-y-5">
          <p className="hint max-w-[65ch]">Check it against your score sheet. Edit takes you back to that step.</p>
          <PageantReview
            name={name}
            draft={draft}
            candidates={candidates}
            separate={separate}
            preliminaryBoard={preliminaryBoard}
            properBoard={properBoard}
            chairs={chairs}
            resultDecimals={resultDecimals}
            onResultDecimals={setResultDecimals}
            onEdit={go}
          />
          <p className="hint max-w-[65ch]">
            After the session starts, the program and the judges are locked so the rules can&apos;t change mid-show, and they stay that way after
            it ends.
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
          {progress && (
            <p role="status" className="tabular text-sm text-regal">
              {progress}
            </p>
          )}
          <SaveDraftButton draft={saved} />
          {error && (
            <p role="alert" className="basis-full font-semibold text-danger">
              {error}
            </p>
          )}
        </div>
      </form>
    </FieldProblemsProvider>
  );
}
