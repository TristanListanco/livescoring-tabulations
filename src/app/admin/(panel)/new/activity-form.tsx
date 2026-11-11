"use client";

import { unstable_rethrow } from "next/navigation";
import { useActionState, useRef, useState, useTransition, type FormEvent } from "react";
import { criteriaForCheck, parseScoringDraft, type ScoringDraft } from "@/lib/pageant-setup";
import { UNREACHABLE } from "@/lib/reach";
import { reportProblem } from "@/lib/report-problem";
import { newRequestId } from "@/lib/request-id";
import type { ResultDecimals } from "@/lib/types";
import { createActivity, type FormResult } from "../../actions";
import { toastOnRedirect } from "../toaster";
import { DRAFT_GONE } from "@/lib/draft-messages";
import { parseEntryLine } from "@/lib/entry-details";
import { checkScoring } from "@/lib/scoring-rules";
import { blankEventScoring, DEFAULT_RESULT_DECIMALS, ScoringFields } from "../scoring-fields";
import { describedBy, FieldProblem, FieldProblemsProvider, problemId, useFieldProblem } from "../field-errors";
import { blankEntry, entryLines, EntryRows, namedEntries, type EntryRow } from "../entry-rows";
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
    // When the results go out (live, or after a deliberation): unpicked on a new event, and on a draft saved before
    // it was picked. Drafts from before the choice existed scored live, as events did then.
    liveScoring: (data === undefined || data === null ? null : typeof d.liveScoring === "boolean" ? d.liveScoring : "liveScoring" in d ? null : true) as boolean | null,
    // The scoring method and decimal places, picked or not yet: drafts from before these started unpicked were picked.
    chosen: {
      mode: data === undefined || data === null ? false : (d.chosen as { mode?: unknown } | undefined)?.mode !== false,
      decimals: data === undefined || data === null ? false : (d.chosen as { decimals?: unknown } | undefined)?.decimals !== false,
    },
    judgesSeeRanking: d.judgesSeeRanking === true,
    correctionReasons: d.correctionReasons === true,
    independentScoring: d.independentScoring === true,
    location: typeof d.location === "string" ? d.location : "",
    // Seconds per entry, as typed; blank for no timer.
    timer: typeof d.timer === "string" ? d.timer : "",
    entries: openEntries(d.entries, d.entryDetails, d.entryFields),
    signatories: openSignatories(d.signatories),
  };
}

/**
 * A draft's entries, as rows. Drafts saved before entries were a list kept the names one per line, with up to three
 * named details each (by name, or on the name's line: "Agila | Xavier University"): those become one line of details,
 * "School: Xavier University · Division: 2".
 */
export function openEntries(entries: unknown, details: unknown, fields: unknown): EntryRow[] {
  if (Array.isArray(entries)) {
    const rows = entries
      .filter((e): e is { name?: unknown; details?: unknown } => typeof e === "object" && e !== null)
      .map((e, key) => ({ key, name: typeof e.name === "string" ? e.name : "", details: typeof e.details === "string" ? e.details : "" }));
    return rows.length ? rows : [blankEntry(0)];
  }
  const names = Array.isArray(fields) ? fields.map((f) => (typeof f === "string" ? f.trim() : "")) : [];
  const saved = (typeof details === "object" && details !== null ? details : {}) as Record<string, unknown>;
  const joined = (values: unknown[]) =>
    values
      .flatMap((v, i) => (typeof v === "string" && v.trim() ? [names[i] ? `${names[i]}: ${v.trim()}` : v.trim()] : []))
      .join(" · ");
  const rows = (typeof entries === "string" ? entries : "")
    .split(/\r?\n/)
    .map((line) => parseEntryLine(line, 3))
    .filter(({ name }) => name.trim())
    .map(({ name, values }, key) => {
      const kept = saved[name.trim()];
      return { key, name: name.trim(), details: joined(Array.isArray(kept) ? kept : values) };
    });
  return rows.length ? rows : [blankEntry(0)];
}

export function ActivityForm({ draft: openedDraft, onDirty, formRef, saveRef }: DraftHostProps) {
  const [pending, startTransition] = useTransition();
  // This form's id for creating its activity (see newRequestId).
  const [requestId] = useState(newRequestId);
  const [start] = useState(() => opened(openedDraft?.data));
  const [name, setName] = useState(start.name);
  const [location, setLocation] = useState(start.location);
  const [timer, setTimer] = useState(start.timer);
  const [scoring, setScoring] = useState<ScoringDraft>(start.scoring);
  const [resultDecimals, setResultDecimals] = useState<ResultDecimals>(start.resultDecimals);
  // Null until picked: Create asks for it.
  const [liveScoring, setLiveScoring] = useState<boolean | null>(start.liveScoring);
  const [chosen, setChosen] = useState(start.chosen);
  const [judgesSeeRanking, setJudgesSeeRanking] = useState(start.judgesSeeRanking);
  const [correctionReasons, setCorrectionReasons] = useState(start.correctionReasons);
  const [independentScoring, setIndependentScoring] = useState(start.independentScoring);
  // Row keys count up within this form (never a module-wide counter, which the server would keep across requests).
  const nextKey = useRef(start.judges.length);
  const [judges, setJudges] = useState<DraftJudge[]>(start.judges);
  const [chairKey, setChairKey] = useState<number | null>(start.chairKey);
  const [entries, setEntries] = useState<EntryRow[]>(start.entries);
  const [signatories, setSignatories] = useState<SignatoryRow[]>(start.signatories);
  const entryCount = namedEntries(entries).length;
  const chairIndex = judges.findIndex((j) => j.key === chairKey);
  // Create asks for the chair and a signatory before anything is sent: said at each, in the form's own words, until fixed.
  const [checked, setChecked] = useState(false);
  const [consent, setConsent] = useState(false);
  const signatoryGap = signatoryProblem(signatories);
  const found = [
    // Picks with no default: each is a decision about the event, not something to skim past.
    ...(chosen.mode ? [] : [{ field: "scoring-method", message: "Choose how judges score: simple or criteria." }]),
    ...(chosen.decimals ? [] : [{ field: "scoring-decimals", message: "Choose how many decimal places judges use." }]),
    ...(liveScoring === null ? [{ field: "judging-live", message: "Choose when the results go out." }] : []),
    // With live scoring there's no chair: only the organizer moves between entries.
    ...(chairIndex < 0 && liveScoring === false ? [{ field: "judge-0-chair", message: "Choose the chair of the board of judges." }] : []),
    ...(entryCount === 0 ? [{ field: ENTRIES_ID, message: "Add at least one entry." }] : []),
    ...(signatoryGap ? [signatoryGap] : []),
    ...(consent ? [] : [{ field: CONSENT_ID, message: CONSENT_PROBLEM }]),
  ];
  const problems = new Map(checked ? found.map((p) => [p.field, p.message] as const) : []);
  // The entries with a name, as saved in a draft.
  const keptEntries = namedEntries(entries).map((r) => ({ name: r.name.trim(), details: r.details.trim() }));
  const withDetails = keptEntries.some((e) => e.details);

  const draft = useDraft({
    openedId: openedDraft?.id ?? null,
    openedSavedAt: openedDraft?.savedAt ?? null,
    onDirty,
    saveRef,
    kind: "event",
    name,
    snapshot: JSON.stringify([
      name,
      location,
      timer,
      scoring,
      resultDecimals,
      liveScoring,
      chosen,
      judgesSeeRanking,
      correctionReasons,
      independentScoring,
      judges.map((j) => [j.first, j.last, j.preview]),
      chairIndex,
      keptEntries,
      filledSignatories(signatories),
    ]),
    collect: async () => ({
      name,
      location,
      timer,
      scoring,
      resultDecimals,
      liveScoring,
      chosen,
      judgesSeeRanking,
      correctionReasons,
      independentScoring,
      judges: await saveJudges(judges),
      chair: chairIndex < 0 ? null : chairIndex,
      entries: keptEntries,
      signatories: filledSignatories(signatories),
    }),
  });

  // Created, the page moves on; a draft another window already created is forgotten (see DRAFT_GONE).
  const [state, dispatch] = useActionState<FormResult, FormData>(async (previous, data) => {
    try {
      const result = await toastOnRedirect(createActivity(previous, data), `${String(data.get("name") ?? "").trim() || "Event"} created`);
      if (result && !result.ok && result.error === DRAFT_GONE) draft.forget();
      return result;
    } catch (error) {
      // Going to the new activity arrives as a thrown signal: it carries on.
      unstable_rethrow(error);
      reportProblem("action_unreachable");
      // The request was lost: the form stays as it is, to send again (as the same activity, see requestId).
      return UNREACHABLE;
    }
  }, null);

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

  // Where each section stands, for the index beside the form on a wide screen.
  const scoringOk = !(
    "error" in
    checkScoring({ ...scoring, criteria: criteriaForCheck(scoring.criteria) }, () => "check", { maxDecimals: 3 })
  );
  const judgesNamed = judges.every((j) => j.first.trim() && j.last.trim());
  const sections = [
    { id: "details", title: "Details", done: name.trim() !== "" },
    { id: "scoring", title: "Scoring", done: chosen.mode && chosen.decimals && scoringOk },
    { id: "judging", title: "Judging", done: liveScoring !== null },
    { id: "judges", title: "Judges", done: judgesNamed && (liveScoring === true || chairIndex >= 0) },
    { id: "entries", title: "Entries", done: entryCount > 0 },
    { id: "results", title: "Results", done: !signatoryGap },
  ];

  return (
    <FieldProblemsProvider value={problems}>
    <div className="mt-6 xl:grid xl:grid-cols-[minmax(0,1fr)_12rem] xl:items-start xl:gap-10">
    <form ref={formRef} onSubmit={submit} className="min-w-0">
      <Section id="details" title="Details" description="What it's called and where it happens.">
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

      <Section id="scoring" title="Scoring" description="How judges score each entry. It can't change once the activity is created.">
        <ScoringFields
          value={scoring}
          onChange={setScoring}
          resultDecimals={resultDecimals}
          onResultDecimals={setResultDecimals}
          chosen={chosen}
          onChoose={(what) => setChosen((c) => ({ ...c, [what]: true }))}
        />
        {/* A time limit for each entry, as a pageant's sub-activities have, with either scoring method. */}
        <TimerField value={timer} onChange={setTimer} ownPace={liveScoring === false && independentScoring} />
      </Section>

      <Section
        id="judging"
        title="Judging"
        description="When the results go out: as each score comes in, or once the judges have deliberated and signed."
      >
        <input type="hidden" name="live_scoring" value={liveScoring ? "on" : "off"} />
        <JudgingChoice value={liveScoring} onChange={setLiveScoring} />
        {/* Only an event without live scoring has a deliberation. */}
        {liveScoring === false && (
          <div role="group" aria-labelledby="deliberation-options" className="mt-6 border-t border-line pt-5">
            <h3 id="deliberation-options" className="mb-3 font-semibold">
              Deliberation
            </h3>
            <input type="hidden" name="independent_scoring" value={independentScoring ? "on" : "off"} />
            <label className="flex max-w-xl items-center gap-3">
              <input
                type="checkbox"
                checked={independentScoring}
                onChange={(e) => setIndependentScoring(e.target.checked)}
                className="size-5 shrink-0 accent-regal"
              />
              <span>Judges score at their own pace</span>
            </label>
            <input type="hidden" name="judges_see_ranking" value={judgesSeeRanking ? "on" : "off"} />
            <label className="mt-3 flex max-w-xl items-center gap-3">
              <input
                type="checkbox"
                checked={judgesSeeRanking}
                onChange={(e) => setJudgesSeeRanking(e.target.checked)}
                className="size-5 shrink-0 accent-regal"
              />
              <span>Judges see the overall ranking while they deliberate</span>
            </label>
            <input type="hidden" name="correction_reasons" value={correctionReasons ? "on" : "off"} />
            <label className="mt-3 flex max-w-xl items-center gap-3">
              <input
                type="checkbox"
                checked={correctionReasons}
                onChange={(e) => setCorrectionReasons(e.target.checked)}
                className="size-5 shrink-0 accent-regal"
              />
              <span>Judges pick a reason from a list when they correct a score</span>
            </label>
          </div>
        )}
      </Section>

      <Section
        id="judges"
        title="Judges"
        description={
          liveScoring === false
            ? "Who scores, and which of them chairs the board: the chair moves between entries and starts the deliberation from their screen."
            : "Who scores. Each judge gets a code to sign in with on their phone or tablet."
        }
      >
        <JudgesFields
          judges={judges}
          chairKey={chairKey}
          onChange={updateJudge}
          onRemove={removeJudge}
          onChair={setChairKey}
          onAdd={addJudge}
          chair={liveScoring === false}
        />
      </Section>

      <Section id="entries" title="Entries" description="What's judged, in running order. You can rearrange or shuffle the order on the Entries tab later.">
        <input type="hidden" name="entries" value={entryLines(entries)} />
        {/* One general line of details for each entry, kept for the results: only the organizer sees it. */}
        {withDetails && <input type="hidden" name="entry_field" value="Details" />}
        <EntryRows rows={entries} setRows={setEntries} problemField={ENTRIES_ID} />
        <p className="hint mt-3 max-w-2xl">Details show under the entry&apos;s name on the LED wall, and on the Entries tab and in the results. Judges don&apos;t see them.</p>
      </Section>

      {/* Who signs the results on paper (the Board of Tabulators and the like), added now so they're on the first PDF. */}
      <Section id="results" title="Results" description="Who tabulated the results. They sign the results PDF under “Tabulated by”, and you need at least one.">
        <input type="hidden" name="signatories" value={JSON.stringify(filledSignatories(signatories))} />
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
    <SectionIndex sections={sections} />
    </div>
    </FieldProblemsProvider>
  );
}

/**
 * When the results go out, picked from two cards (nothing picked at first, so it's a decision, not a default): live,
 * each score on the live results as it's submitted; or after a deliberation, once the judges have reviewed and signed.
 */
function JudgingChoice({ value, onChange }: { value: boolean | null; onChange: (live: boolean) => void }) {
  const problem = useFieldProblem("judging-live");
  const options = [
    { live: true, title: "Live results", text: "Each score shows on the live results as it's submitted, and it's final. Only you move between entries." },
    { live: false, title: "After a deliberation", text: "Judges can correct their scores, then review and sign. The results go out once you sign them too." },
  ];
  return (
    <fieldset>
      <legend className="sr-only">When the results go out</legend>
      <div className="grid gap-2 sm:grid-cols-2">
        {options.map((o, i) => (
          <label key={o.title} className={`choice items-start ${problem ? "border-danger ring-2 ring-danger/15" : ""}`}>
            <input
              type="radio"
              id={i === 0 ? "judging-live" : undefined}
              name="judging-choice"
              checked={value === o.live}
              onChange={() => onChange(o.live)}
              aria-describedby={describedBy(problem && problemId("judging-live"))}
              className="mt-1"
            />
            <span>
              <span className="block font-semibold">{o.title}</span>
              <span className="mt-0.5 block text-sm opacity-80">{o.text}</span>
            </span>
          </label>
        ))}
      </div>
      <FieldProblem fieldId="judging-live" className="mt-2" />
    </fieldset>
  );
}

/** The first entry's name: where "Add at least one entry" points. */
const ENTRIES_ID = "entry-first";

/**
 * Beside the form from 1280px: its sections, each a link, marked done once it has what Create needs. Held in view
 * while the long form scrolls, so what's left is always one glance away.
 */
function SectionIndex({ sections }: { sections: { id: string; title: string; done: boolean }[] }) {
  return (
    <nav aria-label="Sections of the form" className="sticky top-6 mt-4 hidden xl:block">
      <ol className="space-y-1">
        {sections.map((section) => (
          <li key={section.id}>
            <a href={`#${section.id}`} className="flex items-center gap-2.5 rounded-lg px-3 py-2 text-[15px] font-semibold hover:bg-white">
              {section.done ? (
                <svg viewBox="0 0 16 16" className="size-4 shrink-0 text-regal" aria-hidden>
                  <circle cx="8" cy="8" r="7" fill="currentColor" />
                  <path d="M4.8 8.2l2.1 2.1 4.3-4.4" fill="none" stroke="var(--color-mint)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              ) : (
                <svg viewBox="0 0 16 16" className="size-4 shrink-0 text-field" aria-hidden>
                  <circle cx="8" cy="8" r="6.25" fill="none" stroke="currentColor" strokeWidth="1.5" />
                </svg>
              )}
              {section.title}
              <span className="sr-only">{section.done ? ", done" : ", not done yet"}</span>
            </a>
          </li>
        ))}
      </ol>
    </nav>
  );
}

/**
 * An event's scoring timer on the create form, as a pageant sub-activity's: off, or the seconds judges get for each
 * entry shown (blank means off; a cleared field reads 0 until a number is typed). Sent as `timer_seconds`.
 */
function TimerField({ value, onChange, ownPace }: { value: string; onChange: (value: string) => void; ownPace: boolean }) {
  const timed = value !== "";
  return (
    <div className="mt-6">
      <input type="hidden" name="timer_seconds" value={value} />
      <label className="flex items-center gap-2.5 font-semibold">
        <input type="checkbox" className="size-5 shrink-0 accent-regal" checked={timed} onChange={(e) => onChange(e.target.checked ? "60" : "")} />
        Time limit for scoring
      </label>
      {timed && (
        <div className="mt-2 ml-7.5 flex flex-wrap items-center gap-x-3 gap-y-2">
          <label htmlFor="timer" className="text-sm">
            Judges get<span className="sr-only"> this many seconds to score each entry</span>
          </label>
          <input
            id="timer"
            value={value}
            onChange={(e) => onChange(e.target.value.replace(/[^0-9]/g, "").replace(/^0+(?=\d)/, "").slice(0, 4) || "0")}
            inputMode="numeric"
            aria-describedby="timer-hint"
            className="field tabular w-20"
          />
          <span className="text-sm">seconds per entry</span>
          <p id="timer-hint" className="hint basis-full">
            {ownPace
              ? "Judges scoring at their own pace have no timer: it runs only when you show entries one at a time."
              : "It starts as you show each entry. When it runs out, scoring closes until you give more time from the desk."}
          </p>
        </div>
      )}
    </div>
  );
}
