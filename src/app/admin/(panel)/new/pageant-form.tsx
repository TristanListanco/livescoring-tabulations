"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition, type FormEvent } from "react";
import { blankScoring, checkPageant, MIN_PROPER_JUDGES, parsePageantDraft, type PageantDraft, type ProgramTarget } from "@/lib/pageant-setup";
import { isPersonName } from "@/lib/names";
import type { JudgePanel, ResultDecimals } from "@/lib/types";
import { photoBatches } from "@/lib/photo-file";
import { reportProblem } from "@/lib/report-problem";
import { newRequestId } from "@/lib/request-id";
import { addCandidatePhotos, createPageant, type CreateResult } from "../../actions";
import { listChanged } from "../activities-refresh";
import { filledSignatories, openSignatories, SIGNATORY_ID, signatoryProblem, SignatoryRows, type SignatoryRow } from "../signatories-editor";
import { toast } from "../toaster";
import { describedBy, FieldProblem, FieldProblemsProvider, problemId } from "../field-errors";
import { SEGMENT_DESCRIPTION, SegmentEditor } from "../program-editor";
import { DEFAULT_RESULT_DECIMALS, ResultDecimalsField } from "../scoring-fields";
import { Section, SectionIndex } from "../section";
import { blankCandidate, CandidatesFields, MAX_CANDIDATES, type DraftCandidate, type PasteResult } from "./candidates-fields";
import { blankJudge, JudgesFields, MAX_JUDGES, type DraftJudge } from "./judges-fields";
import { CONSENT_ID, CONSENT_PROBLEM, ConsentField } from "./consent-field";
import { PageantReview } from "./pageant-review";
import { openCandidates, openJudges, SaveDraftButton, saveCandidates, saveJudges, useDraft, type DraftHostProps } from "./use-draft";

/** One board of judges for the whole pageant, or separate boards for the preliminary and pageant proper. */
type Boards = "one" | "separate";
/** Each board's chair by row key. One board's chair is `proper`'s. */
type Chairs = { preliminary: number | null; proper: number | null };

const BOARD_OPTIONS: { value: Boards; label: string }[] = [
  { value: "one", label: "One board for the whole pageant" },
  { value: "separate", label: "Separate boards" },
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

/** Something to fix before creating: what, and the id of the field it's about when there is one. */
/** `also`: other fields to mark with it, whose message is the first field's (a judge's blank first and last name). */
type Problem = { message: string; field?: string; also?: string[] };

/** The form's sections, in order: each a card (the program's are bare: its sub-activities are cards already). */
type SectionId = "details" | "candidates" | "judges" | "preliminary" | "proper" | "results";

/** The id of the list of problems, focused when no problem has a field of its own. */
const FORM_PROBLEMS = "form-problems";

/** Where a section is on the page, for the review's Edit buttons. */
const SECTION_IDS = ["candidates", "judges", "preliminary-program", "proper-program"] as const;

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
 * What's left to fix, above Create, each linking to its field. Not a live region: focus goes to the first problem's
 * field, which reads out its own message, so this doesn't repeat itself on every keystroke.
 */
function FormProblems({ problems, onPick }: { problems: Problem[]; onPick: (field: string) => void }) {
  return (
    <div id={FORM_PROBLEMS} tabIndex={-1} aria-labelledby={`${FORM_PROBLEMS}-title`} className="mt-6 max-w-2xl rounded-xl border border-danger/40 bg-danger/5 px-4 py-3 outline-none focus-visible:ring-2 focus-visible:ring-danger/40">
      <h3 id={`${FORM_PROBLEMS}-title`} className="font-semibold text-danger-ink">
        {problems.length === 1 ? "Fix this to create the pageant" : `Fix these ${problems.length} things to create the pageant`}
      </h3>
      <ul className="mt-1.5 space-y-1 text-[15px]">
        {problems.map((p, i) => (
          <li key={`${p.field ?? "form"}-${i}`}>
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
  // Drafts saved while the form was in steps kept the step too: it's ignored.
  return {
    name: typeof d.name === "string" ? d.name : "",
    location: typeof d.location === "string" ? d.location : "",
    candidates,
    boards,
    judges,
    chairs: { preliminary: boards === "separate" ? keyAt(savedChairs.preliminary) : null, proper: keyAt(savedChairs.proper ?? d.chair) } as Chairs,
    program: program && program.rounds.length ? program : startingProgram(),
    resultDecimals: (Number.isInteger(places) && places >= 0 && places <= 4 ? places : DEFAULT_RESULT_DECIMALS) as ResultDecimals,
    signatories: openSignatories(d.signatories),
  };
}

/**
 * Set up a pageant on one page, as an event is: its details, the candidates, the judges, the preliminary's
 * sub-activities, pageant proper's sub-activities and cuts, and who signs the results, each a section marked done in
 * the index once it has what Create needs, then a last look laid out like the score sheet. Create checks it all and
 * takes focus to the first thing to fix; the whole pageant is sent at once, so nothing is saved half-made.
 */
export function PageantForm({ draft: openedDraft, onDirty, formRef, saveRef }: DraftHostProps) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [serverError, setServerError] = useState<string | null>(null);
  // This form's id for creating its pageant (see newRequestId).
  const [requestId] = useState(newRequestId);
  // While creating: "Uploading candidate photos, 3 of 12…". Once created with photos that didn't upload: whose.
  const [progress, setProgress] = useState<string | null>(null);
  const [created, setCreated] = useState<{ id: string; missed: string[] } | null>(null);
  const [start] = useState(() => opened(openedDraft?.data));
  // Set once Create finds problems: from then they show, re-checked as the organizer types, so each message goes as
  // soon as its field is fixed. `attempt` counts tries, so the same problem can take focus again.
  const [checked, setChecked] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const focusNext = useRef<string | null>(null);
  const [name, setName] = useState(start.name);
  const [location, setLocation] = useState(start.location);
  const [candidates, setCandidates] = useState<DraftCandidate[]>(start.candidates);
  const [signatories, setSignatories] = useState<SignatoryRow[]>(start.signatories);
  // Confirmed on each create, never kept with a draft.
  const [consent, setConsent] = useState(false);
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
  const saved = useDraft({
    openedId: openedDraft?.id ?? null,
    openedSavedAt: openedDraft?.savedAt ?? null,
    onDirty,
    saveRef,
    kind: "pageant",
    name,
    snapshot: JSON.stringify([
      name,
      location,
      candidates.map((c) => [c.name, c.details, c.preview]),
      boards,
      ordered.map((j) => [j.first, j.last, j.preview, j.panel]),
      chairPositions,
      draft,
      resultDecimals,
      filledSignatories(signatories),
    ]),
    collect: async (note) => {
      const savedJudges = await saveJudges(ordered);
      const { saved, dropped } = await saveCandidates(candidates, savedJudges.reduce((n, j) => n + (j.photo?.length ?? 0), 0));
      if (dropped) {
        note(
          `${dropped === 1 ? "One candidate's photo" : `${dropped} candidates' photos`} didn't fit in the draft. Add ${dropped === 1 ? "it" : "them"} again before creating the pageant, or later on its Candidates tab.`,
        );
      }
      return { name, location, candidates: saved, boards, judges: savedJudges, chairs: chairPositions, program: draft, resultDecimals, signatories: filledSignatories(signatories) };
    },
  });
  // After a try that found problems, the first problem's field takes focus (or the list of problems, when it has no field).
  useEffect(() => {
    const target = focusNext.current;
    focusNext.current = null;
    if (target) focusField(target);
  }, [attempt]);

  // The program's check stops at its first problem: it's shown at its field, and the next one after it's fixed.
  const program = checkPageant(draft, candidates.length, () => "");

  /** Every problem in a section, each with the id of the field it's about when there is one. */
  const problems = (section: SectionId): Problem[] => {
    const found: Problem[] = [];
    if (section === "details" && !name.trim()) found.push({ message: "Give the pageant a name.", field: "name" });
    if (section === "candidates") {
      candidates.forEach((c, n) => {
        if (!c.name.trim()) found.push({ message: `Enter candidate ${n + 1}'s name, or remove the row.`, field: `candidate-${c.key}` });
      });
      if (candidates.length < 2) found.push({ message: "Add at least two candidates.", field: "add-candidate" });
      if (candidates.length > MAX_CANDIDATES) found.push({ message: `A pageant can have up to ${MAX_CANDIDATES} candidates.` });
    }
    if (section === "judges") {
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
    // The preliminary's section answers for its own problems; pageant proper's for its own and any left before it.
    if (!program.ok && (section === "proper" ? true : section === "preliminary" && program.segment !== "proper")) {
      found.push({ message: program.error, field: programField(program.target) });
    }
    if (section === "results") {
      const gap = signatoryProblem(signatories);
      if (gap) found.push(gap);
    }
    return found;
  };
  // Everything Create needs, in page order; the program's one problem once, then the consent.
  const found: Problem[] = [
    ...problems("details"),
    ...problems("candidates"),
    ...problems("judges"),
    ...problems("proper"),
    ...problems("results"),
    ...(consent ? [] : [{ message: CONSENT_PROBLEM, field: CONSENT_ID }]),
  ];
  // Done once a section has what Create needs, for the index.
  const sections = [
    { id: "details", title: "Details", done: problems("details").length === 0 },
    { id: "candidates", title: "Candidates", done: problems("candidates").length === 0 },
    { id: "judges", title: "Judges", done: problems("judges").length === 0 },
    { id: "preliminary-program", title: "Preliminary", done: problems("preliminary").length === 0 },
    { id: "proper-program", title: "Pageant proper", done: program.ok },
    { id: "results", title: "Results", done: problems("results").length === 0 },
  ];

  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (found.length) {
      focusNext.current = found.find((p) => p.field)?.field ?? FORM_PROBLEMS;
      setChecked(true);
      setAttempt((n) => n + 1);
      return;
    }
    const data = new FormData(e.currentTarget);
    data.set("kind", "pageant");
    data.set("consent", consent ? "on" : "");
    // Each candidate on a line; with details anywhere, theirs after a "|" (so a "|" typed in either becomes "/").
    const withDetails = candidates.some((c) => c.details.trim());
    const line = (c: DraftCandidate) => (withDetails ? `${cleanName(c.name).replaceAll("|", "/")} | ${c.details.replaceAll("|", "/").trim()}` : cleanName(c.name));
    data.set("entries", candidates.map(line).join("\n"));
    if (withDetails) data.set("entry_field", "Details");
    data.set("pageant", JSON.stringify(draft));
    data.set("signatories", JSON.stringify(filledSignatories(signatories)));
    data.set("judgeCount", String(ordered.length));
    ordered.forEach((j, i) => {
      data.set(`judge-${i}-panel`, j.panel);
      if (j.photo) data.set(`judge-${i}-photo`, j.photo, "photo.jpg");
    });
    // A chair per board, by position: "0" for one board, "0,3" for separate ones.
    data.set("chair", [chairPositions.preliminary, chairPositions.proper].filter((n) => n !== null).join(","));
    // Creating the pageant clears the draft it came from.
    if (saved.draftId) data.set("draftId", saved.draftId);
    // The same id each time this form is sent, so a second send after a lost reply doesn't make a second pageant.
    data.set("requestId", requestId);
    setServerError(null);
    startTransition(() => create(data));
  };

  // The pageant first, then each candidate's photo on its own: together they can be more than one request carries.
  const create = async (data: FormData) => {
    let result: CreateResult;
    try {
      result = await createPageant(data);
    } catch {
      reportProblem("action_unreachable");
      result = { ok: false, error: OFFLINE };
    }
    if (!result.ok) {
      setServerError(result.error);
      if (result.code === "draft-gone") saved.forget();
      return;
    }
    // It's saved now, so nothing is lost by leaving: the photos still to come can be added on the Candidates tab.
    onDirty(false);
    listChanged();
    toast(`${name.trim() || "Pageant"} created`);
    const { activityId, entryIds } = result;
    const photos = candidates.flatMap((c, i) => (c.photo && entryIds[i] ? [{ name: cleanName(c.name), photo: c.photo, entryId: entryIds[i] }] : []));
    const missed: string[] = [];
    let sent = 0;
    // A few to a request: each request checks the pageant once and uploads its photos together.
    for (const batch of photoBatches(photos)) {
      sent += batch.length;
      setProgress(`Uploading candidate photos, ${sent} of ${photos.length}…`);
      const body = new FormData();
      for (const c of batch) {
        body.append("entry", c.entryId);
        body.append("photo", c.photo, "photo.jpg");
      }
      const uploaded = await addCandidatePhotos(activityId, body).catch(() => null);
      const failed = new Set(uploaded?.ok ? uploaded.missed : batch.map((c) => c.entryId));
      missed.push(...batch.filter((c) => failed.has(c.entryId)).map((c) => c.name));
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
  // Live: a fixed field's message goes as soon as it's fixed.
  const shownProblems = checked ? found : [];
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

  // The review's Edit buttons go to their section: its heading, in view, focused.
  const editSection = (i: number) => {
    const section = document.getElementById(SECTION_IDS[i]);
    section?.scrollIntoView({ block: "start", behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
    document.getElementById(`${SECTION_IDS[i]}-title`)?.focus({ preventScroll: true });
  };

  return (
    <FieldProblemsProvider value={fieldProblems}>
      <div className="mt-6 xl:grid xl:grid-cols-[minmax(0,1fr)_12rem] xl:items-start xl:gap-10">
        <SectionIndex sections={sections} />
        <form
          ref={formRef}
          onSubmit={submit}
          // Enter in a field never creates the pageant: only the Create button does. (Name lists go to their next line.)
          onKeyDown={(e) => {
            const field = e.target;
            if (e.key === "Enter" && field instanceof HTMLInputElement && !["submit", "button", "image", "reset"].includes(field.type)) e.preventDefault();
          }}
          noValidate
          className="min-w-0"
        >
          <Section id="details" title="Details" description="What the pageant is called and where it happens.">
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
            {/* Where it happens, for telling rooms apart: on the judges' screens and the results PDFs too. */}
            <label htmlFor="location" className="label mt-5">
              Location <span className="font-normal text-prussian/70">(optional)</span>
            </label>
            <input
              id="location"
              name="location"
              maxLength={120}
              value={location}
              onChange={(e) => setLocation(e.target.value)}
              className="field max-w-xl"
              placeholder="e.g. University Gymnasium"
              aria-describedby="location-hint"
            />
            <p id="location-hint" className="hint mt-2">
              Judges see it on their screens, and it prints on the results.
            </p>
          </Section>

          <Section id="candidates" title="Candidates" description="Who competes, each with an optional photo for the LED wall and a line of details, such as their town.">
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
          </Section>

          <Section id="judges" title="Judges" description="One board for the whole pageant, or one for each segment, each with its own chair. Pageant proper needs at least three.">
            <fieldset className="max-w-3xl">
              <legend className="label">Boards of judges</legend>
              <div className="grid gap-2 sm:grid-cols-2">
                {BOARD_OPTIONS.map((o) => (
                  <label key={o.value} className="choice items-center">
                    <input type="radio" name="boards" checked={boards === o.value} onChange={() => chooseBoards(o.value)} />
                    <span className="font-semibold">{o.label}</span>
                  </label>
                ))}
              </div>
            </fieldset>
            {separate ? (
              <>
                <section aria-labelledby="preliminary-board" className="mt-6 border-t border-line pt-5">
                  <h3 id="preliminary-board" className="mb-4 font-semibold">
                    Preliminary board of judges
                  </h3>
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
                <section aria-labelledby="proper-board" className="mt-6 border-t border-line pt-5">
                  <h3 id="proper-board" className="mb-4 font-semibold">
                    Pageant proper board of judges
                  </h3>
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
              <div className="mt-6">
                <JudgesFields
                  judges={judges}
                  chairKey={chairs.proper}
                  onChange={updateJudge}
                  onRemove={removeJudge}
                  onChair={(key) => setChairs({ preliminary: null, proper: key })}
                  onAdd={() => addJudge("all")}
                />
              </div>
            )}
          </Section>

          {/* The program's sub-activities are cards of their own: these two sections have no card around them. */}
          <Section bare id="preliminary-program" title="Preliminary" description={SEGMENT_DESCRIPTION.preliminary}>
            <SegmentEditor segment="preliminary" draft={draft} onChange={setDraft} />
          </Section>

          <Section bare id="proper-program" title="Pageant proper" description={SEGMENT_DESCRIPTION.proper}>
            <SegmentEditor segment="proper" draft={draft} onChange={setDraft} candidates={candidates.length} />
          </Section>

          <Section id="results" title="Results" description="Who tabulated the results: they sign the results PDFs under “Tabulated by”, and you need at least one.">
            <SignatoryRows rows={signatories} setRows={setSignatories} idPrefix={SIGNATORY_ID} />
            {shownProblems.map((p) => p.field?.startsWith(`${SIGNATORY_ID}-`) && <FieldProblem key={p.field} fieldId={p.field} className="mt-3" />)}
            <div className="mt-6 border-t border-line pt-5">
              <ResultDecimalsField value={resultDecimals} onChange={setResultDecimals} />
            </div>
          </Section>

          {/* A last look, laid out like the score sheet it was set up from, to check it against the paper one at a glance. */}
          <Section bare id="review" title="Review" description="The whole pageant as it will be created. Edit takes you to that section.">
            <PageantReview
              name={name}
              draft={draft}
              candidates={candidates}
              separate={separate}
              preliminaryBoard={preliminaryBoard}
              properBoard={properBoard}
              chairs={chairs}
              resultDecimals={resultDecimals}
              onEdit={editSection}
            />
          </Section>

          <div className="mt-6">
            <ConsentField checked={consent} onChange={setConsent} />
          </div>

          {shownProblems.length > 0 && <FormProblems problems={shownProblems} onPick={focusField} />}

          <div className="mt-6 flex flex-wrap items-center gap-4">
            <button type="submit" className="btn btn-primary" disabled={pending}>
              {pending ? "Creating…" : "Create pageant"}
            </button>
            {progress && (
              <p role="status" className="tabular text-sm text-regal">
                {progress}
              </p>
            )}
            <SaveDraftButton draft={saved} />
            {serverError && (
              <p role="alert" className="basis-full font-semibold text-danger">
                {serverError}
              </p>
            )}
          </div>
        </form>
      </div>
    </FieldProblemsProvider>
  );
}
