"use client";

import { unstable_rethrow } from "next/navigation";
import { useActionState, useRef, useState, useTransition, type FormEvent } from "react";
import { parseScoringDraft, type ScoringDraft } from "@/lib/pageant-setup";
import { UNREACHABLE } from "@/lib/reach";
import { reportProblem } from "@/lib/report-problem";
import { newRequestId } from "@/lib/request-id";
import type { ResultDecimals } from "@/lib/types";
import { createActivity, type FormResult } from "../../actions";
import { MAX_FIELD_NAME } from "@/lib/entry-details";
import { blankEventScoring, CORRECTION_REASONS_HINT, DEFAULT_RESULT_DECIMALS, JUDGES_RANKING_HINT, LIVE_SCORING_HINT, OWN_PACE_HINT, ScoringFields } from "../scoring-fields";
import { Section } from "../section";
import { blankJudge, JudgesFields, MAX_JUDGES, type DraftJudge } from "./judges-fields";
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
    // The names of up to three details kept about each entry.
    entryFields: [0, 1, 2].map((i) => (Array.isArray(d.entryFields) && typeof d.entryFields[i] === "string" ? d.entryFields[i] : "")),
    entries: typeof d.entries === "string" ? d.entries : "",
  };
}

export function ActivityForm({ draft: openedDraft, onDirty, formRef, saveRef }: DraftHostProps) {
  const [state, dispatch] = useActionState<FormResult, FormData>(async (previous, data) => {
    try {
      return await createActivity(previous, data);
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
  const [scoring, setScoring] = useState<ScoringDraft>(start.scoring);
  const [resultDecimals, setResultDecimals] = useState<ResultDecimals>(start.resultDecimals);
  const [liveScoring, setLiveScoring] = useState(start.liveScoring);
  const [judgesSeeRanking, setJudgesSeeRanking] = useState(start.judgesSeeRanking);
  const [correctionReasons, setCorrectionReasons] = useState(start.correctionReasons);
  const [independentScoring, setIndependentScoring] = useState(start.independentScoring);
  const [entryFields, setEntryFields] = useState<string[]>(start.entryFields);
  const named = entryFields.map((f) => f.trim()).filter(Boolean);
  // Row keys count up within this form (never a module-wide counter, which the server would keep across requests).
  const nextKey = useRef(start.judges.length);
  const [judges, setJudges] = useState<DraftJudge[]>(start.judges);
  const [chairKey, setChairKey] = useState<number | null>(start.chairKey);
  const [entriesText, setEntriesText] = useState(start.entries);
  const entryCount = entriesText.split(/\r?\n/).filter((l) => l.trim()).length;
  const chairIndex = judges.findIndex((j) => j.key === chairKey);

  const draft = useDraft({
    openedId: openedDraft?.id ?? null,
    onDirty,
    saveRef,
    kind: "event",
    name,
    snapshot: JSON.stringify([name, scoring, resultDecimals, liveScoring, judgesSeeRanking, correctionReasons, independentScoring, entryFields, judges.map((j) => [j.first, j.last, j.preview]), chairIndex, entriesText]),
    collect: async () => ({
      name,
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
    <form ref={formRef} onSubmit={submit} className="mt-6">
      <Section title="Activity">
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
      </Section>

      <Section title="Scoring" hint="Scoring can't be changed after the activity is created.">
        <ScoringFields value={scoring} onChange={setScoring} resultDecimals={resultDecimals} onResultDecimals={setResultDecimals} />
      </Section>

      <Section title="Live scoring" hint="You can change this until the session starts.">
        <input type="hidden" name="live_scoring" value={liveScoring ? "on" : "off"} />
        <label className="flex max-w-xl items-start gap-3">
          <input type="checkbox" checked={liveScoring} onChange={(e) => setLiveScoring(e.target.checked)} className="mt-0.5 size-5 shrink-0 accent-regal" />
          <span>
            <span className="font-semibold">Show scores live</span>
            <span className="hint mt-1 block">{liveScoring ? LIVE_SCORING_HINT.on : LIVE_SCORING_HINT.off}</span>
          </span>
        </label>
        {/* Only an event without live scoring has a deliberation. */}
        {!liveScoring && (
          <>
            <input type="hidden" name="independent_scoring" value={independentScoring ? "on" : "off"} />
            <label className="mt-4 flex max-w-xl items-start gap-3">
              <input
                type="checkbox"
                checked={independentScoring}
                onChange={(e) => setIndependentScoring(e.target.checked)}
                className="mt-0.5 size-5 shrink-0 accent-regal"
              />
              <span>
                <span className="font-semibold">Judges score at their own pace</span>
                <span className="hint mt-1 block">{OWN_PACE_HINT}</span>
              </span>
            </label>
            <input type="hidden" name="judges_see_ranking" value={judgesSeeRanking ? "on" : "off"} />
            <label className="mt-4 flex max-w-xl items-start gap-3">
              <input
                type="checkbox"
                checked={judgesSeeRanking}
                onChange={(e) => setJudgesSeeRanking(e.target.checked)}
                className="mt-0.5 size-5 shrink-0 accent-regal"
              />
              <span>
                <span className="font-semibold">Judges see the overall ranking while they deliberate</span>
                <span className="hint mt-1 block">{JUDGES_RANKING_HINT}</span>
              </span>
            </label>
            <input type="hidden" name="correction_reasons" value={correctionReasons ? "on" : "off"} />
            <label className="mt-4 flex max-w-xl items-start gap-3">
              <input
                type="checkbox"
                checked={correctionReasons}
                onChange={(e) => setCorrectionReasons(e.target.checked)}
                className="mt-0.5 size-5 shrink-0 accent-regal"
              />
              <span>
                <span className="font-semibold">Judges pick a reason from a list when they correct a score</span>
                <span className="hint mt-1 block">{CORRECTION_REASONS_HINT}</span>
              </span>
            </label>
          </>
        )}
      </Section>

      <Section
        title="Judges"
        hint="The chair moves judging between entries from their own screen. Another judge can take over on the Judges tab until the session starts."
      >
        <JudgesFields
          judges={judges}
          chairKey={chairKey}
          onChange={updateJudge}
          onRemove={removeJudge}
          onChair={setChairKey}
          onAdd={addJudge}
        />
      </Section>

      <Section title="Entries">
        <fieldset className="mb-6 max-w-xl">
          <legend className="label">Details for each entry (optional)</legend>
          <p className="hint">Up to three, such as a school, a division or a region. Only you see them, here and on the results.</p>
          <div className="mt-2 grid gap-2 sm:grid-cols-3">
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
        </fieldset>
        <label htmlFor="entries" className="label">
          {named.length ? "Entries, one per line" : "Entry names, one per line"}
        </label>
        <textarea
          id="entries"
          name="entries"
          rows={8}
          value={entriesText}
          onChange={(e) => setEntriesText(e.target.value)}
          className="field h-auto max-w-xl py-2.5 leading-relaxed"
          aria-describedby="entries-hint"
          placeholder={named.length ? `Agila | ${named.map((f) => f).join(" | ")}` : undefined}
        />
        {named.length > 0 && (
          <p className="hint mt-2 max-w-xl">
            Each name, then its {new Intl.ListFormat("en").format(named)}, separated by | (or paste rows from a spreadsheet).
          </p>
        )}
        <p id="entries-hint" className="hint tabular mt-2">
          {entryCount} {entryCount === 1 ? "entry" : "entries"}, in running order. You can reorder or shuffle them, rename them and add more later.
        </p>
      </Section>

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
  );
}
