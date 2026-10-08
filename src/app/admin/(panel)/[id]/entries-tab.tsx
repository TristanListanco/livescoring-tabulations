"use client";

import { useActionState, useState, useTransition } from "react";
import { Avatar } from "@/components/avatar";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { PhotoPicker } from "@/components/photo-picker";
import { SubmitButton } from "@/components/submit-button";
import type { Entry } from "@/lib/types";
import { addEntries, moveEntry, removeEntry, renameEntry, setEntryPhoto, type FormResult } from "../../actions";
import { FormMessage } from "../form-message";

function Arrow({ up }: { up?: boolean }) {
  return (
    <svg viewBox="0 0 16 16" className={`size-4 ${up ? "" : "rotate-180"}`} aria-hidden>
      <path d="M8 3.5v9M4 7.5l4-4 4 4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function EntryRow({
  entry,
  number,
  isFirst,
  isLast,
  scored,
  started,
}: {
  entry: Entry;
  number: number;
  isFirst: boolean;
  isLast: boolean;
  scored: number;
  started: boolean;
}) {
  const [state, rename] = useActionState<FormResult, FormData>(renameEntry.bind(null, entry.id), null);
  // Save shows only once the name has been edited, so an untouched list isn't a column of buttons.
  const [name, setName] = useState(entry.name);
  const dirty = name.trim() !== entry.name;
  const [moving, startMove] = useTransition();
  const move = (direction: -1 | 1) => startMove(async () => void (await moveEntry(entry.id, direction)));
  const [photoPending, startPhoto] = useTransition();
  const [photoError, setPhotoError] = useState<string | null>(null);
  const [preview, setPreview] = useState<string | null>(null);

  const changePhoto = (photo: Blob | null, previewUrl: string | null) =>
    startPhoto(async () => {
      setPhotoError(null);
      setPreview(previewUrl);
      const data = new FormData();
      if (photo) data.set("photo", photo, "photo.jpg");
      const result = await setEntryPhoto(entry.id, data);
      if (!result.ok) setPhotoError(result.error);
    });

  return (
    <li className="flex flex-wrap items-center gap-x-3 gap-y-2 py-3">
      <span className="tabular w-8 text-right font-semibold text-prussian/60">{number}</span>
      <div className={photoPending ? "opacity-60" : undefined}>
        <PhotoPicker
          name={entry.name}
          currentUrl={photoPending ? preview : entry.photoUrl}
          size={48}
          square
          pixels={480}
          label={`Photo for ${entry.name} (optional, shown on the LED wall)`}
          onPick={(photo, url) => changePhoto(photo, url)}
        />
      </div>
      <div className="min-w-56 flex-1 space-y-1">
        <form action={rename} className="flex items-center gap-2">
          <label htmlFor={`entry-${entry.id}`} className="sr-only">
            Entry {number} name
          </label>
          <input
            id={`entry-${entry.id}`}
            name="name"
            required
            maxLength={120}
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="field max-w-md"
          />
          <SubmitButton className={`btn btn-quiet btn-sm ${dirty ? "" : "invisible"}`} pendingLabel="Saving…">
            Save<span className="sr-only"> {entry.name}</span>
          </SubmitButton>
          <FormMessage state={state?.ok ? null : state} small />
        </form>
        <FormMessage state={photoError ? { ok: false, error: photoError } : null} small />
        {entry.photoUrl && !photoPending && (
          <button type="button" className="text-action" onClick={() => changePhoto(null, null)}>
            Remove photo
          </button>
        )}
      </div>
      <div className="flex items-center gap-1">
        <button
          type="button"
          className="btn btn-quiet btn-sm px-2.5 pointer-coarse:min-w-11"
          onClick={() => move(-1)}
          disabled={started || isFirst || moving}
          aria-label={`Move ${entry.name} up`}
        >
          <Arrow up />
        </button>
        <button
          type="button"
          className="btn btn-quiet btn-sm px-2.5 pointer-coarse:min-w-11"
          onClick={() => move(1)}
          disabled={started || isLast || moving}
          aria-label={`Move ${entry.name} down`}
        >
          <Arrow />
        </button>
        <ConfirmDialog
          triggerLabel={
            <>
              Remove<span className="sr-only"> {entry.name}</span>
            </>
          }
          triggerClassName="btn btn-sm text-danger hover:bg-danger/10"
          triggerDisabled={started && scored > 0}
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

function AddEntriesForm({ activityId, pageant }: { activityId: string; pageant: boolean }) {
  const [state, action] = useActionState<FormResult, FormData>(addEntries.bind(null, activityId), null);
  return (
    <form action={action} className="mt-8 max-w-xl space-y-2">
      <label htmlFor="new-entries" className="label">
        {pageant ? "Add candidates, one per line" : "Add entries, one per line"}
      </label>
      <textarea
        id="new-entries"
        name="names"
        rows={4}
        required
        className="field h-auto py-2.5 leading-relaxed"
        aria-describedby="new-entries-hint"
      />
      <p id="new-entries-hint" className="hint">
        {pageant
          ? "A candidate's name on each line. They join the end of the running order, and every sub-activity before the first cut judges them."
          : "For example, a contestant's name or number on each line. They join the end of the running order."}
      </p>
      <div className="flex items-center gap-3">
        <SubmitButton pendingLabel="Adding…">{pageant ? "Add candidates" : "Add entries"}</SubmitButton>
        <FormMessage state={state} small />
      </div>
    </form>
  );
}

export function EntriesTab({
  activityId,
  entries,
  scoredFor,
  started,
  ended,
  pageant = false,
}: {
  activityId: string;
  entries: Entry[];
  /** A pageant calls its entries candidates. */
  pageant?: boolean;
  scoredFor: Record<string, number>;
  /** Once the session has started the running order is fixed and scored entries stay. */
  started: boolean;
  /** Once judging has ended nothing about the entries can change. */
  ended: boolean;
}) {
  return (
    <div className="max-w-3xl">
      <h2 className="text-xl font-bold">{pageant ? "Candidates" : "Entries"}</h2>
      {ended ? (
        <>
          <p role="note" className="note mt-3">
            Judging has ended, so {pageant ? "candidates" : "entries"} can&apos;t be changed.
          </p>
          {/* Like the locked judges: a list to read, not a page of disabled forms. */}
          <ol className="mt-4 divide-y divide-line border-y border-line">
            {entries.map((e, i) => {
              const scored = scoredFor[e.id] ?? 0;
              return (
                <li key={e.id} className="flex items-center gap-4 py-3">
                  <span className="tabular w-8 text-right font-semibold text-prussian/70">{i + 1}</span>
                  {e.photoUrl && <Avatar name={e.name} src={e.photoUrl} size={48} square />}
                  <span className="min-w-0 flex-1 truncate font-semibold">{e.name}</span>
                  <span className="tabular hint shrink-0">
                    {scored} {scored === 1 ? "score" : "scores"}
                  </span>
                </li>
              );
            })}
          </ol>
        </>
      ) : started ? (
        <p role="note" className="note mt-3">
          The session has started, so the running order is locked and {pageant ? "candidates" : "entries"} with scores can&apos;t be removed.
        </p>
      ) : null}
      {!ended && (
        <div className="min-w-0">
          {entries.length === 0 ? (
            <p className="mt-6 rounded-xl border border-dashed border-powder px-4 py-6 text-center">
              {pageant ? "No candidates yet. Add them below." : "No entries yet. Add them below."}
            </p>
          ) : (
            <ol className="mt-4 divide-y divide-line border-y border-line">
              {entries.map((e, i) => (
                <EntryRow
                  key={e.id}
                  entry={e}
                  number={i + 1}
                  isFirst={i === 0}
                  isLast={i === entries.length - 1}
                  scored={scoredFor[e.id] ?? 0}
                  started={started}
                />
              ))}
            </ol>
          )}
          <AddEntriesForm activityId={activityId} pageant={pageant} />
        </div>
      )}
    </div>
  );
}
