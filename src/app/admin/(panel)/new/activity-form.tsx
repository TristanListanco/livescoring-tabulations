"use client";

import { unstable_rethrow } from "next/navigation";
import { useActionState, useRef, useState, useTransition, type FormEvent } from "react";
import { parseScoringDraft, type ScoringDraft } from "@/lib/pageant-setup";
import { UNREACHABLE } from "@/lib/reach";
import { reportProblem } from "@/lib/report-problem";
import { newRequestId } from "@/lib/request-id";
import type { ResultDecimals } from "@/lib/types";
import { createActivity, type FormResult } from "../../actions";
import { toastOnRedirect } from "../toaster";
import { MAX_DETAIL, MAX_FIELD_NAME, parseEntryLine } from "@/lib/entry-details";
import { blankEventScoring, DEFAULT_RESULT_DECIMALS, ScoringFields } from "../scoring-fields";
import { FieldProblem, FieldProblemsProvider } from "../field-errors";
import { enterToNext, NEXT_LINE } from "../list-keys";
import { Section } from "../section";
import { filledSignatories, openSignatories, SIGNATORY_ID, signatoryProblem, SignatoryRows, type SignatoryRow } from "../signatories-editor";
import { blankJudge, JudgesFields, MAX_JUDGES, type DraftJudge } from "./judges-fields";
import { CONSENT_ID, CONSENT_PROBLEM, ConsentField } from "./consent-field";
import { openJudges, SaveDraftButton, saveJudges, useDraft, type DraftHostProps } from "./use-draft";

/** The event form's state, from a saved draft or blank. */
function opened(data: unknown) {
  const d = (typeof data === "object" && data !== null ? data : {}) as Record<string, unknown>;
  const judges = openJudges(d.judges) ?? [blankJudge(0), blankJudge(1), blankJudge(2)];
  const scoring = d.scoring ? parseScoringDraft(d.scoring) : blankEventScoring();
  const places = Number(d.resultDecimals);
  return {
    name: typeof d.name === "string" ? d.name : "",
    // A draft's scoring with unreadable decimal places falls back to the usual 2.
    scoring: { ...scoring, decimals: (scoring.decimals as number) === -1 ? 2 : scoring.decimals },
    resultDecimals: (Number.isInteger(places) && places >= 0 && places <= 4 ? places : DEFAULT_RESULT_DECIMALS) as ResultDecimals,
    judges,
    chairKey: typeof d.chair === "number" && d.chair >= 0 && d.chair < judges.length ? d.chair : null,
    // A new event starts without live scoring. Drafts saved before the choice existed score live, as events did then.
    liveScoring: data === undefined || data === null ? false : d.liveScoring !== false,
    judgesSeeRanking: d.judgesSeeRanking === true,
    correctionReasons: d.correctionReasons === true,
    independentScoring: d.independentScoring === true,
    location: typeof d.location === "string" ? d.location : "",
    // The names of up to three details kept about each entry.
    entryFields: [0, 1, 2].map((i) => (Array.isArray(d.entryFields) && typeof d.entryFields[i] === "string" ? d.entryFields[i] : "")),
    ...openEntries(d.entries, d.entryDetails),
    signatories: openSignatories(d.signatories),
  };
}

/** Each entry's details, by its name as typed (trimmed): they follow the name if lines are added or moved above it. */
type DetailsByName = Record<string, string[]>;

/**
 * A draft's entries: the names, one per line, and each one's details. Drafts saved before details had their own fields
 * kept them on the name's line ("Agila | Xavier University"): those are split apart.
 */
function openEntries(entries: unknown, details: unknown): { entries: string; entryDetails: DetailsByName } {
  const text = typeof entries === "string" ? entries : "";
  const saved = (typeof details === "object" && details !== null ? details : {}) as Record<string, unknown>;
  const entryDetails: DetailsByName = {};
  for (const [name, values] of Object.entries(saved)) {
    if (Array.isArray(values)) entryDetails[name] = [0, 1, 2].map((i) => (typeof values[i] === "string" ? values[i] : ""));
  }
  const names = text.split(/\r?\n/).map((line) => {
    const { name, values } = parseEntryLine(line, 3);
    if (values.some((v) => v.trim())) entryDetails[name.trim()] ??= [0, 1, 2].map((i) => values[i]?.trim() ?? "");
    return name.trimEnd();
  });
  return { entries: names.join("\n"), entryDetails };
}

export function ActivityForm({ draft: openedDraft, onDirty, formRef, saveRef }: DraftHostProps) {
  const [state, dispatch] = useActionState<FormResult, FormData>(async (previous, data) => {
    try {
      return await toastOnRedirect(createActivity(previous, data), `${String(data.get("name") ?? "").trim() || "Event"} created`);
    } catch (error) {
      // Going to the new activity arrives as a thrown signal: it carries on.
      unstable_rethrow(error);
      reportProblem("action_unreachable");
      // The request was lost: the form stays as it is, to send again (as the same activity, see requestId).
      return UNREACHABLE;
    }
  }, null);
  const [pending, startTransition] = useTransition();
  // This form's id for creating its activity (see newRequestId).
  const [requestId] = useState(newRequestId);
  const [start] = useState(() => opened(openedDraft?.data));
  const [name, setName] = useState(start.name);
  const [location, setLocation] = useState(start.location);
  const [scoring, setScoring] = useState<ScoringDraft>(start.scoring);
  const [resultDecimals, setResultDecimals] = useState<ResultDecimals>(start.resultDecimals);
  const [liveScoring, setLiveScoring] = useState(start.liveScoring);
  const [judgesSeeRanking, setJudgesSeeRanking] = useState(start.judgesSeeRanking);
  const [correctionReasons, setCorrectionReasons] = useState(start.correctionReasons);
  const [independentScoring, setIndependentScoring] = useState(start.independentScoring);
  const [entryFields, setEntryFields] = useState<string[]>(start.entryFields);
  // Optional, so folded away until asked for (or a draft already has some).
  const [showDetails, setShowDetails] = useState(() => start.entryFields.some((f) => f.trim() !== ""));
  // Row keys count up within this form (never a module-wide counter, which the server would keep across requests).
  const nextKey = useRef(start.judges.length);
  const [judges, setJudges] = useState<DraftJudge[]>(start.judges);
  const [chairKey, setChairKey] = useState<number | null>(start.chairKey);
  const [entriesText, setEntriesText] = useState(start.entries);
  const [entryDetails, setEntryDetails] = useState<DetailsByName>(start.entryDetails);
  const [signatories, setSignatories] = useState<SignatoryRow[]>(start.signatories);
  const entryNames = entriesText
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  const entryCount = entryNames.length;
  const chairIndex = judges.findIndex((j) => j.key === chairKey);
  // Create asks for the chair and a signatory before anything is sent: said at each, in the form's own words, until fixed.
  const [checked, setChecked] = useState(false);
  const [consent, setConsent] = useState(false);
  const signatoryGap = signatoryProblem(signatories);
  const found = [
    ...(chairIndex < 0 ? [{ field: "judge-0-chair", message: "Choose the chair of the board of judges." }] : []),
    ...(signatoryGap ? [signatoryGap] : []),
    ...(consent ? [] : [{ field: CONSENT_ID, message: CONSENT_PROBLEM }]),
  ];
  const problems = new Map(checked ? found.map((p) => [p.field, p.message] as const) : []);
  // Each entry's details, only for the details that are named (by position, so a later one can be left blank).
  const fieldSlots = entryFields.flatMap((f, i) => (f.trim() ? [{ name: f.trim(), slot: i }] : []));
  const detailOf = (entry: string, slot: number) => entryDetails[entry]?.[slot] ?? "";
  const setDetail = (entry: string, slot: number, value: string) =>
    setEntryDetails((all) => ({ ...all, [entry]: [0, 1, 2].map((i) => (i === slot ? value : (all[entry]?.[i] ?? ""))) }));
  // What the server reads: each entry on its line, its details after it, split by "|" (so a "|" typed in one becomes "/").
  const entriesSent = entryNames
    .map((entry) =>
      fieldSlots.length ? [entry, ...fieldSlots.map((f) => detailOf(entry, f.slot).replaceAll("|", "/").trim())].join(" | ") : entry,
    )
    .join("\n");
  // Only the details of entries still listed, so a removed entry's don't linger in the draft.
  const keptDetails = Object.fromEntries(entryNames.flatMap((e) => (entryDetails[e]?.some((v) => v.trim()) ? [[e, entryDetails[e]]] : [])));

  const draft = useDraft({
    openedId: openedDraft?.id ?? null,
    onDirty,
    saveRef,
    kind: "event",
    name,
    snapshot: JSON.stringify([
      name,
      location,
      scoring,
      resultDecimals,
      liveScoring,
      judgesSeeRanking,
      correctionReasons,
      independentScoring,
      entryFields,
      judges.map((j) => [j.first, j.last, j.preview]),
      chairIndex,
      entriesText,
      keptDetails,
      filledSignatories(signatories),
    ]),
    collect: async () => ({
      name,
      location,
      scoring,
      resultDecimals,
      liveScoring,
      judgesSeeRanking,
      correctionReasons,
      independentScoring,
      entryFields,
      judges: await saveJudges(judges),
      chair: chairIndex < 0 ? null : chairIndex,
      entries: entriesText,
      entryDetails: keptDetails,
      signatories: filledSignatories(signatories),
    }),
  });

  const addJudge = () => {
    const key = nextKey.current++;
    setJudges((list) => (list.length < MAX_JUDGES ? [...list, blankJudge(key)] : list));
  };
  // Removes that judge's row, with whatever was typed in it, rather than always the last one.
  const removeJudge = (key: number) => setJudges((list) => (list.length > 1 ? list.filter((j) => j.key !== key) : list));
  const updateJudge = (key: number, patch: Partial<DraftJudge>) => setJudges((list) => list.map((j) => (j.key === key ? { ...j, ...patch } : j)));

  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (found.length) {
      setChecked(true);
      const first = document.getElementById(found[0].field);
      first?.focus();
      first?.scrollIntoView({ block: "center", behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
      return;
    }
    const data = new FormData(e.currentTarget);
    data.set("judgeCount", String(judges.length));
    judges.forEach((j, i) => {
      if (j.photo) data.set(`judge-${i}-photo`, j.photo, "photo.jpg");
    });
    // Creating the activity clears the draft it came from.
    if (draft.draftId) data.set("draftId", draft.draftId);
    // The same id each time this form is sent, so a second send after a lost reply doesn't make a second activity.
    data.set("requestId", requestId);
    startTransition(() => dispatch(data));
  };

  const error = state && !state.ok ? state.error : null;

  return (
    <FieldProblemsProvider value={problems}>
    <form ref={formRef} onSubmit={submit} className="mt-6">
      <Section quiet title="Activity">
        <label htmlFor="name" className="label">
          Name
        </label>
        <input
          id="name"
          name="name"
          required
          maxLength={120}
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="field max-w-xl"
          placeholder="e.g. Mr. and Ms. Intramurals 2026"
        />
        {/* Where it happens, for telling breakout rooms apart: on the judges' screens and the results PDFs too. */}
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
          placeholder="e.g. Bldg 2, Room 204, 3rd floor"
          aria-describedby="location-hint"
        />
        <p id="location-hint" className="hint mt-2">
          Judges see it on their screens, and it prints on the results.
        </p>
      </Section>

      <Section quiet title="Scoring">
        <ScoringFields value={scoring} onChange={setScoring} resultDecimals={resultDecimals} onResultDecimals={setResultDecimals} />
      </Section>

      <Section quiet title="Live scoring">
        <input type="hidden" name="live_scoring" value={liveScoring ? "on" : "off"} />
        <label className="flex max-w-xl items-center gap-3">
          <input type="checkbox" checked={liveScoring} onChange={(e) => setLiveScoring(e.target.checked)} className="size-5 shrink-0 accent-regal" />
          <span className="font-semibold">Show scores live</span>
        </label>
        {/* Only an event without live scoring has a deliberation. */}
        {!liveScoring && (
          <>
            <input type="hidden" name="independent_scoring" value={independentScoring ? "on" : "off"} />
            <label className="mt-4 flex max-w-xl items-center gap-3">
              <input
                type="checkbox"
                checked={independentScoring}
                onChange={(e) => setIndependentScoring(e.target.checked)}
                className="size-5 shrink-0 accent-regal"
              />
              <span className="font-semibold">Judges score at their own pace</span>
            </label>
            <input type="hidden" name="judges_see_ranking" value={judgesSeeRanking ? "on" : "off"} />
            <label className="mt-4 flex max-w-xl items-center gap-3">
              <input
                type="checkbox"
                checked={judgesSeeRanking}
                onChange={(e) => setJudgesSeeRanking(e.target.checked)}
                className="size-5 shrink-0 accent-regal"
              />
              <span className="font-semibold">Judges see the overall ranking while they deliberate</span>
            </label>
            <input type="hidden" name="correction_reasons" value={correctionReasons ? "on" : "off"} />
            <label className="mt-4 flex max-w-xl items-center gap-3">
              <input
                type="checkbox"
                checked={correctionReasons}
                onChange={(e) => setCorrectionReasons(e.target.checked)}
                className="size-5 shrink-0 accent-regal"
              />
              <span className="font-semibold">Judges pick a reason from a list when they correct a score</span>
            </label>
          </>
        )}
      </Section>

      <Section quiet title="Judges">
        <JudgesFields
          judges={judges}
          chairKey={chairKey}
          onChange={updateJudge}
          onRemove={removeJudge}
          onChair={setChairKey}
          onAdd={addJudge}
        />
      </Section>

      <Section quiet title="Entries">
        <input type="hidden" name="entries" value={entriesSent} />
        <label htmlFor="entries" className="label">
          Entry names, one per line
        </label>
        <textarea
          id="entries"
          rows={8}
          value={entriesText}
          onChange={(e) => setEntriesText(e.target.value)}
          onPaste={(e) => {
            // Rows pasted from a spreadsheet (or "Agila | School"): the names go in the list, the rest in their details.
            const pasted = e.clipboardData.getData("text");
            if (!/[\t|]/.test(pasted)) return;
            e.preventDefault();
            const lines = pasted.split(/\r?\n/).map((line) => parseEntryLine(line, 3));
            const area = e.currentTarget;
            area.setRangeText(lines.map((l) => l.name.trim()).join("\n"), area.selectionStart, area.selectionEnd, "end");
            setEntriesText(area.value);
            const found = lines.filter((l) => l.name.trim() && l.values.some((v) => v.trim()));
            if (!found.length) return;
            setEntryDetails((all) => ({ ...all, ...Object.fromEntries(found.map((l) => [l.name.trim(), [0, 1, 2].map((i) => l.values[i]?.trim() ?? "")])) }));
            setShowDetails(true);
          }}
          className="field h-auto max-w-xl py-2.5 leading-relaxed"
          aria-describedby="entries-hint"
        />
        <p id="entries-hint" className="hint tabular mt-2">
          {entryCount} {entryCount === 1 ? "entry" : "entries"}
        </p>

        {/*
          Details kept about each entry (a school, a division): optional, so folded away until asked for. Named once,
          then filled in entry by entry, each on its own row, rather than typed after the name with separators.
        */}
        <details open={showDetails} onToggle={(e) => setShowDetails(e.currentTarget.open)} className="group mt-6">
          <summary className="text-action tap-target inline-flex cursor-pointer list-none items-center gap-1.5 [&::-webkit-details-marker]:hidden">
            <svg viewBox="0 0 16 16" className="size-4 transition-transform group-open:rotate-90" aria-hidden>
              <path d="M6 3.5l4.5 4.5L6 12.5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            Details for each entry
          </summary>
          <div className="mt-4">
            <p className="label">What to keep about each entry</p>
            <div className="grid max-w-xl gap-2 sm:grid-cols-3">
              {["e.g. School", "e.g. Division", "e.g. Region"].map((example, i) => (
                <input
                  key={example}
                  name="entry_field"
                  aria-label={`Detail ${i + 1} name`}
                  placeholder={example}
                  maxLength={MAX_FIELD_NAME}
                  value={entryFields[i]}
                  onChange={(e) => setEntryFields((f) => f.map((v, j) => (j === i ? e.target.value : v)))}
                  className="field"
                />
              ))}
            </div>
            <p className="hint mt-2">Only you see them: on the Entries tab and in the results.</p>
            {fieldSlots.length > 0 &&
              (entryCount === 0 ? (
                <p className="note mt-4 max-w-xl">Add entry names above, then fill in each one&apos;s details here.</p>
              ) : (
                <EntryDetailRows names={entryNames} fields={fieldSlots} value={detailOf} onChange={setDetail} />
              ))}
          </div>
        </details>
      </Section>

      {/* Who signs the results on paper (the Board of Tabulators and the like), added now so they're on the first PDF. */}
      <Section quiet title="Signatories">
        <input type="hidden" name="signatories" value={JSON.stringify(filledSignatories(signatories))} />
        <p className="label">Signatories</p>
        <p className="hint mb-4">At least one: who tabulated the results. They sign the results PDF under “Tabulated by”.</p>
        <SignatoryRows rows={signatories} setRows={setSignatories} idPrefix={SIGNATORY_ID} />
        {signatoryGap && <FieldProblem fieldId={signatoryGap.field} className="mt-3" />}
      </Section>

      <ConsentField checked={consent} onChange={setConsent} />

      <div className="mt-6 flex flex-wrap items-center gap-4">
        <button type="submit" className="btn btn-primary" disabled={pending}>
          {pending ? "Creating…" : "Create activity"}
        </button>
        <SaveDraftButton draft={draft} />
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

/**
 * Each entry's details, a row per entry in the list's order: its number and name, then a field for each named detail
 * ("School for Agila", as the Entries tab names them). On a phone, each entry's fields stack under its name.
 */
function EntryDetailRows({
  names,
  fields,
  value,
  onChange,
}: {
  names: string[];
  fields: { name: string; slot: number }[];
  value: (entry: string, slot: number) => string;
  onChange: (entry: string, slot: number, value: string) => void;
}) {
  const columns = { gridTemplateColumns: `minmax(8rem,12rem) repeat(${fields.length}, minmax(0,1fr))` };
  // Enter steps through the details as a sheet is filled in: across an entry, then on to the next one's.
  const list = useRef<HTMLOListElement>(null);
  return (
    <div className="mt-5 max-w-3xl">
      <div aria-hidden className="mb-1.5 hidden gap-x-3 sm:grid" style={columns}>
        <span className="label mb-0">Entry</span>
        {fields.map((f) => (
          <span key={f.slot} className="label mb-0 truncate">
            {f.name}
          </span>
        ))}
      </div>
      <ol ref={list} className="divide-y divide-line border-y border-line">
        {names.map((entry, i) => (
          <li key={`${i}-${entry}`} className="grid gap-x-3 gap-y-2 py-2.5 sm:items-center max-sm:!grid-cols-1" style={columns}>
            <p className="flex min-w-0 items-baseline gap-2 font-semibold">
              <span className="tabular w-6 shrink-0 text-sm font-normal text-prussian/60">{i + 1}</span>
              <span className="truncate">{entry}</span>
            </p>
            {fields.map((f) => (
              <input
                key={f.slot}
                aria-label={`${f.name} for ${entry}`}
                placeholder={f.name}
                maxLength={MAX_DETAIL}
                {...NEXT_LINE}
                onKeyDown={(e) => enterToNext(e, list.current)}
                value={value(entry, f.slot)}
                onChange={(e) => onChange(entry, f.slot, e.target.value)}
                className="field sm:placeholder:text-transparent"
              />
            ))}
          </li>
        ))}
      </ol>
    </div>
  );
}
