"use client";

import { useActionState, useRef, useState, useTransition, type FormEvent } from "react";
import { parseScoringDraft, type ScoringDraft } from "@/lib/pageant-setup";
import type { ResultDecimals } from "@/lib/types";
import { createActivity, type FormResult } from "../../actions";
import { blankEventScoring, DEFAULT_RESULT_DECIMALS, ScoringFields } from "../scoring-fields";
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
    entries: typeof d.entries === "string" ? d.entries : "",
  };
}

export function ActivityForm({ draft: openedDraft, onDirty, formRef, saveRef }: DraftHostProps) {
  const [state, dispatch] = useActionState<FormResult, FormData>(createActivity, null);
  const [pending, startTransition] = useTransition();
  const [start] = useState(() => opened(openedDraft?.data));
  const [name, setName] = useState(start.name);
  const [scoring, setScoring] = useState<ScoringDraft>(start.scoring);
  const [resultDecimals, setResultDecimals] = useState<ResultDecimals>(start.resultDecimals);
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
    snapshot: JSON.stringify([name, scoring, resultDecimals, judges.map((j) => [j.first, j.last, j.preview]), chairIndex, entriesText]),
    collect: async () => ({ name, scoring, resultDecimals, judges: await saveJudges(judges), chair: chairIndex < 0 ? null : chairIndex, entries: entriesText }),
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

      <Section
        title="Judges"
        hint="Choose one judge as chair. The chair can move judging to the previous or next entry from their own screen, and can't be changed later."
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
        <label htmlFor="entries" className="label">
          Entry names, one per line
        </label>
        <textarea
          id="entries"
          name="entries"
          rows={8}
          value={entriesText}
          onChange={(e) => setEntriesText(e.target.value)}
          className="field h-auto max-w-xl py-2.5 leading-relaxed"
          aria-describedby="entries-hint"
        />
        <p id="entries-hint" className="hint tabular mt-2">
          {entryCount} {entryCount === 1 ? "entry" : "entries"}, in running order. You can reorder, rename and add entries later.
        </p>
      </Section>

      <div className="flex flex-wrap items-center gap-4 border-t border-line pt-6">
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
