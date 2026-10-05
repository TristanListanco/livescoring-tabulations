"use client";

import { useActionState, useRef, useState, useTransition, type FormEvent } from "react";
import { PhotoPicker } from "@/components/photo-picker";
import { fullName, MAX_NAME_PART } from "@/lib/names";
import { createActivity, type FormResult } from "../../actions";
import { ScoringFields } from "../scoring-fields";
import { Section } from "../section";

type DraftJudge = { key: number; first: string; last: string; photo: Blob | null; preview: string | null };

const MAX_JUDGES = 20;
const blankJudge = (key: number): DraftJudge => ({ key, first: "", last: "", photo: null, preview: null });

export function ActivityForm() {
  const [state, dispatch] = useActionState<FormResult, FormData>(createActivity, null);
  const [pending, startTransition] = useTransition();
  // Row keys count up within this form (never a module-wide counter, which the server would keep across requests).
  const nextKey = useRef(3);
  const [judges, setJudges] = useState<DraftJudge[]>(() => [blankJudge(0), blankJudge(1), blankJudge(2)]);
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
        {/*
          Column headings from sm up, on the same grid as the rows. Each field keeps its full label ("Judge 1
          first name") for screen readers and shows a short one on phones, where the fields stack.
        */}
        <div aria-hidden className="mb-1.5 hidden grid-cols-[3.5rem_minmax(0,1fr)_minmax(0,1fr)_6rem_2.75rem] gap-x-3 sm:grid">
          <span />
          <span className="label mb-0">First name</span>
          <span className="label mb-0">Last name</span>
        </div>
        <ol className="space-y-3">
          {judges.map((j, i) => (
            <li
              key={j.key}
              className="grid grid-cols-[3.5rem_minmax(0,1fr)] items-center gap-x-3 gap-y-2 sm:grid-cols-[3.5rem_minmax(0,1fr)_minmax(0,1fr)_6rem_2.75rem]"
            >
              <div className="row-span-3 self-start sm:row-span-1 sm:self-center">
                <PhotoPicker
                  name={fullName(j.first, j.last)}
                  currentUrl={j.preview}
                  size={56}
                  onPick={(photo, preview) => updateJudge(j.key, { photo, preview })}
                />
              </div>
              <div className="min-w-0">
                <label htmlFor={`judge-${i}-first_name`} className="mb-1 block text-sm font-semibold sm:sr-only">
                  <span className="sr-only">Judge {i + 1} </span>First name
                </label>
                <input
                  id={`judge-${i}-first_name`}
                  name={`judge-${i}-first_name`}
                  required
                  maxLength={MAX_NAME_PART}
                  value={j.first}
                  onChange={(e) => updateJudge(j.key, { first: e.target.value })}
                  className="field"
                />
              </div>
              <div className="min-w-0">
                <label htmlFor={`judge-${i}-last_name`} className="mb-1 block text-sm font-semibold sm:sr-only">
                  <span className="sr-only">Judge {i + 1} </span>Last name
                </label>
                <input
                  id={`judge-${i}-last_name`}
                  name={`judge-${i}-last_name`}
                  required
                  maxLength={MAX_NAME_PART}
                  value={j.last}
                  onChange={(e) => updateJudge(j.key, { last: e.target.value })}
                  className="field"
                />
              </div>
              <div className="flex items-center gap-2 sm:contents">
                <label className="choice h-11 shrink-0 items-center gap-2 justify-self-start px-3 py-0 text-sm font-semibold">
                  <input type="radio" name="chair" value={i} required />
                  <span>
                    Chair<span className="sr-only"> of the board of judges: judge {i + 1}</span>
                  </span>
                </label>
                <button
                  type="button"
                  className="btn btn-sm shrink-0 justify-self-start px-2.5 text-prussian/70 hover:bg-danger/10 hover:text-danger pointer-coarse:min-w-11"
                  onClick={() => removeJudge(j.key)}
                  disabled={judges.length <= 1}
                  aria-label={`Remove judge ${i + 1}`}
                >
                  <svg viewBox="0 0 16 16" className="size-4" aria-hidden>
                    <path d="M4 4l8 8M12 4l-8 8" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
                  </svg>
                </button>
              </div>
            </li>
          ))}
        </ol>
        <div className="mt-4 flex flex-wrap items-center gap-4">
          <button type="button" className="btn btn-quiet btn-sm" onClick={addJudge} disabled={judges.length >= MAX_JUDGES}>
            Add a judge
          </button>
          <p className="hint tabular" aria-live="polite">
            {judges.length} {judges.length === 1 ? "judge" : "judges"}
          </p>
        </div>
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
