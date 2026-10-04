"use client";

import { useActionState, useState, useTransition, type FormEvent } from "react";
import { PhotoPicker } from "@/components/photo-picker";
import { fullName, MAX_NAME_PART } from "@/lib/names";
import { createActivity, type FormResult } from "../../actions";
import { ScoringFields } from "../scoring-fields";
import { Section } from "../section";

type DraftJudge = { key: number; first: string; last: string; photo: Blob | null; preview: string | null };

const MAX_JUDGES = 20;
let nextKey = 0;
const blankJudge = (): DraftJudge => ({ key: nextKey++, first: "", last: "", photo: null, preview: null });

export function ActivityForm() {
  const [state, dispatch] = useActionState<FormResult, FormData>(createActivity, null);
  const [pending, startTransition] = useTransition();
  const [judges, setJudges] = useState<DraftJudge[]>(() => [blankJudge(), blankJudge(), blankJudge()]);
  const [entriesText, setEntriesText] = useState("");
  const entryCount = entriesText.split(/\r?\n/).filter((l) => l.trim()).length;

  const setJudgeCount = (count: number) => {
    const n = Math.max(1, Math.min(MAX_JUDGES, count));
    setJudges((list) => (n > list.length ? [...list, ...Array.from({ length: n - list.length }, blankJudge)] : list.slice(0, n)));
  };
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
        <input id="name" name="name" required maxLength={120} className="field max-w-xl" placeholder="Mr. and Ms. Intramurals 2026" />
      </Section>

      <Section title="Scoring" hint="Scoring can't be changed after the activity is created.">
        <ScoringFields />
      </Section>

      <Section title="Judges">
        <div className="flex items-center gap-3">
          <span className="label mb-0" id="judge-count-label">
            Number of judges
          </span>
          <div className="inline-flex items-center rounded-lg border border-line bg-white" role="group" aria-labelledby="judge-count-label">
            <button
              type="button"
              className="h-10 w-10 text-xl text-regal disabled:opacity-40"
              onClick={() => setJudgeCount(judges.length - 1)}
              disabled={judges.length <= 1}
              aria-label="Remove a judge"
            >
              −
            </button>
            <span className="tabular w-10 text-center font-semibold" aria-live="polite">
              {judges.length}
            </span>
            <button
              type="button"
              className="h-10 w-10 text-xl text-regal disabled:opacity-40"
              onClick={() => setJudgeCount(judges.length + 1)}
              disabled={judges.length >= MAX_JUDGES}
              aria-label="Add a judge"
            >
              +
            </button>
          </div>
        </div>

        <ol className="mt-5 space-y-3">
          {judges.map((j, i) => (
            <li key={j.key} className="flex items-center gap-4">
              <PhotoPicker
                name={fullName(j.first, j.last)}
                currentUrl={j.preview}
                size={56}
                onPick={(photo, preview) => updateJudge(j.key, { photo, preview })}
              />
              <div className="flex min-w-0 flex-1 flex-wrap gap-2">
                <label htmlFor={`judge-${i}-first_name`} className="sr-only">
                  Judge {i + 1} first name
                </label>
                <input
                  id={`judge-${i}-first_name`}
                  name={`judge-${i}-first_name`}
                  required
                  maxLength={MAX_NAME_PART}
                  value={j.first}
                  onChange={(e) => updateJudge(j.key, { first: e.target.value })}
                  placeholder="First name"
                  className="field max-w-56 min-w-36 flex-1"
                />
                <label htmlFor={`judge-${i}-last_name`} className="sr-only">
                  Judge {i + 1} last name
                </label>
                <input
                  id={`judge-${i}-last_name`}
                  name={`judge-${i}-last_name`}
                  required
                  maxLength={MAX_NAME_PART}
                  value={j.last}
                  onChange={(e) => updateJudge(j.key, { last: e.target.value })}
                  placeholder="Last name"
                  className="field max-w-56 min-w-36 flex-1"
                />
              </div>
              <label className="flex shrink-0 cursor-pointer items-center gap-2 rounded-lg border border-line bg-white px-3 py-2 text-sm font-semibold has-checked:border-regal has-checked:bg-regal has-checked:text-mint">
                <input type="radio" name="chair" value={i} required className="accent-mint" />
                <span>
                  Chair<span className="sr-only"> of the board of judges: judge {i + 1}</span>
                </span>
              </label>
            </li>
          ))}
        </ol>
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
          placeholder={"Maria Santos\nJuan dela Cruz\nAna Reyes"}
        />
        <p className="hint tabular mt-2">
          {entryCount} {entryCount === 1 ? "entry" : "entries"}
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
