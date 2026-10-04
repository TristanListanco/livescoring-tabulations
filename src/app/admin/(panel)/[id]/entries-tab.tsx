"use client";

import { useActionState, useTransition } from "react";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { SubmitButton } from "@/components/submit-button";
import type { Entry } from "@/lib/types";
import { addEntries, moveEntry, removeEntry, renameEntry, type FormResult } from "../../actions";

function Arrow({ up }: { up?: boolean }) {
  return (
    <svg viewBox="0 0 16 16" className={`size-4 ${up ? "" : "rotate-180"}`} aria-hidden>
      <path d="M8 3.5v9M4 7.5l4-4 4 4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function EntryRow({ entry, number, isFirst, isLast, scored }: { entry: Entry; number: number; isFirst: boolean; isLast: boolean; scored: number }) {
  const [state, rename] = useActionState<FormResult, FormData>(renameEntry.bind(null, entry.id), null);
  const [moving, startMove] = useTransition();
  const move = (direction: -1 | 1) => startMove(async () => void (await moveEntry(entry.id, direction)));

  return (
    <li className="flex flex-wrap items-center gap-x-3 gap-y-2 py-3">
      <span className="tabular w-8 text-right font-semibold text-prussian/60">{number}</span>
      <form action={rename} className="flex min-w-56 flex-1 items-center gap-2">
        <label htmlFor={`entry-${entry.id}`} className="sr-only">
          Entry {number} name
        </label>
        <input id={`entry-${entry.id}`} name="name" required maxLength={120} defaultValue={entry.name} className="field max-w-md" />
        <SubmitButton className="btn btn-quiet btn-sm" pendingLabel="Saving…">
          Save
        </SubmitButton>
        {state && !state.ok && (
          <span role="alert" className="text-sm font-semibold text-danger">
            {state.error}
          </span>
        )}
      </form>
      <div className="flex items-center gap-1">
        <button type="button" className="btn btn-quiet btn-sm px-2.5" onClick={() => move(-1)} disabled={isFirst || moving} aria-label={`Move ${entry.name} up`}>
          <Arrow up />
        </button>
        <button type="button" className="btn btn-quiet btn-sm px-2.5" onClick={() => move(1)} disabled={isLast || moving} aria-label={`Move ${entry.name} down`}>
          <Arrow />
        </button>
        <ConfirmDialog
          triggerLabel="Remove"
          triggerClassName="btn btn-sm text-danger hover:bg-danger/10"
          title={`Remove ${entry.name}?`}
          tone="danger"
          confirmLabel="Remove entry"
          onConfirm={() => removeEntry(entry.id)}
        >
          {scored > 0 ? `Its ${scored} submitted ${scored === 1 ? "score" : "scores"} will be deleted too.` : "No judge has scored it yet."}
        </ConfirmDialog>
      </div>
    </li>
  );
}

function AddEntriesForm({ activityId }: { activityId: string }) {
  const [state, action] = useActionState<FormResult, FormData>(addEntries.bind(null, activityId), null);
  return (
    <form action={action} className="mt-8 max-w-xl space-y-2">
      <label htmlFor="new-entries" className="label">
        Add entries, one per line
      </label>
      <textarea id="new-entries" name="names" rows={4} required className="field h-auto py-2.5 leading-relaxed" placeholder={"Maria Santos\nJuan dela Cruz"} />
      <div className="flex items-center gap-3">
        <SubmitButton pendingLabel="Adding…">Add entries</SubmitButton>
        {state && (
          <p role={state.ok ? "status" : "alert"} className={`text-sm ${state.ok ? "text-regal" : "font-semibold text-danger"}`}>
            {state.ok ? state.message : state.error}
          </p>
        )}
      </div>
    </form>
  );
}

export function EntriesTab({ activityId, entries, scoredFor }: { activityId: string; entries: Entry[]; scoredFor: Record<string, number> }) {
  return (
    <div className="max-w-3xl">
      <h2 className="text-xl font-bold">Entries</h2>
      <p className="hint mt-1">Judges see entries in this order. On the live results they&apos;re ranked by average once scores come in.</p>
      {entries.length === 0 ? (
        <p className="mt-6 rounded-xl border border-dashed border-powder px-4 py-6 text-center">No entries yet. Add them below.</p>
      ) : (
        <ol className="mt-4 divide-y divide-line border-y border-line">
          {entries.map((e, i) => (
            <EntryRow key={e.id} entry={e} number={i + 1} isFirst={i === 0} isLast={i === entries.length - 1} scored={scoredFor[e.id] ?? 0} />
          ))}
        </ol>
      )}
      <AddEntriesForm activityId={activityId} />
    </div>
  );
}
