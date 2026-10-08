"use client";

import { useActionState, useRef, useState, useTransition, type FormEvent } from "react";
import { createActivity, type FormResult } from "../../actions";
import { ScoringFields } from "../scoring-fields";
import { Section } from "../section";
import { blankJudge, JudgesFields, MAX_JUDGES, type DraftJudge } from "./judges-fields";

export function ActivityForm() {
  const [state, dispatch] = useActionState<FormResult, FormData>(createActivity, null);
  const [pending, startTransition] = useTransition();
  // Row keys count up within this form (never a module-wide counter, which the server would keep across requests).
  const nextKey = useRef(3);
  const [judges, setJudges] = useState<DraftJudge[]>(() => [blankJudge(0), blankJudge(1), blankJudge(2)]);
  const [chairKey, setChairKey] = useState<number | null>(null);
  const [entriesText, setEntriesText] = useState("");
  const entryCount = entriesText.split(/\r?\n/).filter((l) => l.trim()).length;

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
    startTransition(() => dispatch(data));
  };

  const error = state && !state.ok ? state.error : null;

  return (
    <form onSubmit={submit} className="mt-6">
      <Section title="Activity">
        <label htmlFor="name" className="label">
          Name
        </label>
        <input id="name" name="name" required maxLength={120} className="field max-w-xl" placeholder="e.g. Mr. and Ms. Intramurals 2026" />
      </Section>

      <Section title="Scoring" hint="Scoring can't be changed after the activity is created.">
        <ScoringFields />
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
        {error && (
          <p role="alert" className="font-semibold text-danger">
            {error}
          </p>
        )}
      </div>
    </form>
  );
}
