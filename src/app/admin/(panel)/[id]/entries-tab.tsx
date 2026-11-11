"use client";

import { useActionState, useState, useTransition } from "react";
import { Avatar } from "@/components/avatar";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { PhotoPicker } from "@/components/photo-picker";
import { SubmitButton } from "@/components/submit-button";
import { detailsLine, GENERAL_DETAILS, MAX_DETAIL, MAX_ENTRY_FIELDS, MAX_FIELD_NAME, type EntryDetails, type EntryField } from "@/lib/entry-details";
import type { ActionResult, Entry } from "@/lib/types";
import { addEntries, moveEntry, removeEntry, renameEntry, setEntryFields, setEntryPhoto, shuffleEntries, type FormResult } from "../../actions";
import { blankEntry, entryLines, EntryRows, type EntryRow as NewEntry } from "../entry-rows";
import { FormMessage } from "../form-message";
import { toastSaved } from "../toaster";

/** An event without details yet: its first line of details gives it the general field (see fieldsWithDetails). */
const GENERAL_FIELD: EntryField = { id: "general", name: GENERAL_DETAILS };

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
  onReorder,
  fields,
  details,
}: {
  entry: Entry;
  number: number;
  isFirst: boolean;
  isLast: boolean;
  scored: number;
  started: boolean;
  /** Moving or removing it changes the running order. */
  onReorder: () => void;
  /** The event's entry fields, and this entry's values (see entry-details.ts). */
  fields: EntryField[];
  details: EntryDetails;
}) {
  const [state, rename] = useActionState<FormResult, FormData>(
    async (previous, data) => toastSaved(await renameEntry(entry.id, previous, data), `${String(data.get("name") ?? "").trim() || entry.name} saved`),
    null,
  );
  // Save shows only once the name or a detail has been edited, so an untouched list isn't a column of buttons.
  const [name, setName] = useState(entry.name);
  const [values, setValues] = useState(details);
  const dirty = name.trim() !== entry.name || fields.some((f) => (values[f.id] ?? "").trim() !== (details[f.id] ?? ""));
  const [moving, startMove] = useTransition();
  const move = (direction: -1 | 1) =>
    startMove(async () => {
      onReorder();
      await moveEntry(entry.id, direction);
    });
  const [photoPending, startPhoto] = useTransition();
  const [photoError, setPhotoError] = useState<string | null>(null);
  const [preview, setPreview] = useState<string | null>(null);

  const changePhoto = (photo: Blob | null, previewUrl: string | null) =>
    startPhoto(async () => {
      setPhotoError(null);
      setPreview(previewUrl);
      const data = new FormData();
      if (photo) data.set("photo", photo, "photo.jpg");
      const result = toastSaved(await setEntryPhoto(entry.id, data), photo ? `${entry.name}'s photo updated` : `${entry.name}'s photo removed`);
      if (!result.ok) setPhotoError(result.error);
    });

  return (
    <li className="flex flex-wrap items-center gap-x-3 gap-y-2 px-5 py-3">
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
          onRemove={() => changePhoto(null, null)}
        />
      </div>
      <div className="min-w-56 flex-1 space-y-1">
        {/* The name and its details one width, one above the other; Save beside the name, in a column of its own. */}
        <form action={rename} className="grid grid-cols-[minmax(0,28rem)_auto] items-center gap-x-2 gap-y-2">
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
            className="field"
          />
          {/* On a phone it takes no room until there's something to save, so the name has the width. */}
          <SubmitButton className={`btn btn-quiet btn-sm ${dirty ? "" : "invisible max-sm:hidden"}`} pendingLabel="Saving…">
            Save<span className="sr-only"> {entry.name}</span>
          </SubmitButton>
          {fields.length > 0 && (
            <div className="col-start-1 flex flex-wrap gap-2">
              {fields.map((f) => (
                <input
                  key={f.id}
                  name={`detail-${f.id}`}
                  aria-label={`${f.name} for ${entry.name}`}
                  placeholder={f.id === GENERAL_FIELD.id ? `${f.name} (optional)` : f.name}
                  maxLength={MAX_DETAIL}
                  value={values[f.id] ?? ""}
                  onChange={(e) => setValues((v) => ({ ...v, [f.id]: e.target.value }))}
                  className="field h-10 min-w-32 flex-1 py-0 text-sm"
                />
              ))}
            </div>
          )}
          <div className="col-span-2 empty:hidden">
            <FormMessage state={state?.ok ? null : state} small />
          </div>
        </form>
        <FormMessage state={photoError ? { ok: false, error: photoError } : null} small />
      </div>
      {/*
        Once the session has started (the note above says so), the order is fixed: no arrows to fade out. An entry that
        has scores stays, and says how many where its Remove would be.
      */}
      <div className="flex items-center gap-1">
        {!started && (
          <>
            <button
              type="button"
              className="btn btn-quiet btn-sm px-2.5 pointer-coarse:min-w-11"
              onClick={() => move(-1)}
              disabled={isFirst || moving}
              aria-label={`Move ${entry.name} up`}
            >
              <Arrow up />
            </button>
            <button
              type="button"
              className="btn btn-quiet btn-sm px-2.5 pointer-coarse:min-w-11"
              onClick={() => move(1)}
              disabled={isLast || moving}
              aria-label={`Move ${entry.name} down`}
            >
              <Arrow />
            </button>
          </>
        )}
        {started && scored > 0 ? (
          <span className="tabular hint px-2">
            {scored} {scored === 1 ? "score" : "scores"}
          </span>
        ) : (
          <ConfirmDialog
            triggerLabel={
              <>
                Remove<span className="sr-only"> {entry.name}</span>
              </>
            }
            triggerClassName="btn btn-sm text-danger hover:bg-danger/10"
            title={`Remove ${entry.name}?`}
            tone="danger"
            confirmLabel="Remove entry"
            onConfirm={async () => {
              onReorder();
              return toastSaved(await removeEntry(entry.id), `${entry.name} removed`);
            }}
          >
            {scored > 0 ? `Its ${scored} submitted ${scored === 1 ? "score" : "scores"} will be deleted too.` : "No judge has scored it yet."}
          </ConfirmDialog>
        )}
      </div>
    </li>
  );
}

/**
 * An event's entry details: the names of up to three fields (a school, a division), saved together. Renaming one keeps
 * its values; clearing one takes it off. They show here, in the results, and under the entry's name on the LED wall.
 */
function EntryFieldsForm({ activityId, fields }: { activityId: string; fields: EntryField[] }) {
  const [state, action] = useActionState<FormResult, FormData>(
    async (previous, data) => toastSaved(await setEntryFields(activityId, previous, data), "Details for each entry saved"),
    null,
  );
  const slots = Array.from({ length: MAX_ENTRY_FIELDS }, (_, i) => fields[i] ?? null);
  return (
    <form action={action} className="mt-6 max-w-xl">
      <fieldset>
        <legend className="label">Details for each entry</legend>
        <div className="mt-2 grid gap-2 sm:grid-cols-3">
          {slots.map((field, i) => (
            <span key={field?.id ?? i}>
              <input type="hidden" name="field-id" value={field?.id ?? ""} />
              <input
                name="field-name"
                aria-label={`Detail ${i + 1} name`}
                placeholder={["e.g. School", "e.g. Division", "e.g. Region"][i]}
                maxLength={MAX_FIELD_NAME}
                defaultValue={field?.name ?? ""}
                className="field"
              />
            </span>
          ))}
        </div>
      </fieldset>
      <div className="mt-2 flex items-center gap-3">
        <SubmitButton className="btn btn-quiet btn-sm" pendingLabel="Saving…">
          Save details<span className="sr-only"> for each entry</span>
        </SubmitButton>
        <FormMessage state={state?.ok ? null : state} small />
      </div>
    </form>
  );
}

/**
 * Adding entries (or a pageant's candidates), as on the create form: a list, each a name with a line of details under
 * it (an event keeping several named details, from before, fills the first). Cleared once they're added.
 */
function AddEntryRows({ activityId, pageant, fields }: { activityId: string; pageant: boolean; fields: EntryField[] }) {
  const [rows, setRows] = useState<NewEntry[]>(() => [blankEntry(0)]);
  const [state, action] = useActionState<FormResult, FormData>(async (previous, data) => {
    const result = toastSaved(await addEntries(activityId, previous, data));
    if (result?.ok) setRows([blankEntry(0)]);
    return result;
  }, null);
  const lines = entryLines(rows);
  const plural = pageant ? "candidates" : "entries";
  return (
    <form action={action} className="mt-8">
      <h3 className="label">Add {plural}</h3>
      <input type="hidden" name="names" value={lines} />
      {rows.some((r) => r.name.trim() && r.details.trim()) && <input type="hidden" name="with_details" value="on" />}
      <EntryRows
        rows={rows}
        setRows={setRows}
        noun={pageant ? "candidate" : "entry"}
        detailsLabel={fields[0]?.name ?? GENERAL_DETAILS}
        label={pageant ? "New candidate" : "New entry"}
        footer={<SubmitButton pendingLabel="Adding…">Add {plural}</SubmitButton>}
      />
      <FormMessage state={state?.ok ? null : state} small className="mt-2" />
    </form>
  );
}

export function EntriesTab({
  activityId,
  entries,
  scoredFor,
  started,
  ended,
  deliberating = false,
  pageant = false,
  details = null,
}: {
  activityId: string;
  entries: Entry[];
  /** The entry fields and each entry's (or candidate's) values; null before migration 033. */
  details?: { fields: EntryField[]; byEntry: Record<string, EntryDetails> } | null;
  /** A pageant calls its entries candidates. */
  pageant?: boolean;
  scoredFor: Record<string, number>;
  /** Once the session has started the running order is fixed and scored entries stay. */
  started: boolean;
  /** Once judging has ended nothing about the entries can change. */
  ended: boolean;
  /** The judges are deliberating: no entry can be added, since no one could score it now. */
  deliberating?: boolean;
}) {
  // An event's running order can be drawn at random until its session starts. A pageant's candidates keep their numbers
  // through every cut, so they're only moved by hand.
  const canShuffle = !pageant && !started && entries.length > 1;
  const [shuffled, setShuffled] = useState<ActionResult | null>(null);
  const fields = details?.fields ?? [];
  return (
    <div className="max-w-3xl">
      <h2 className="sr-only">{pageant ? "Candidates" : "Entries"}</h2>
      {ended ? (
        <>
          <p role="note" className="note mt-3">
            Judging has ended, so {pageant ? "candidates" : "entries"} can&apos;t be changed.
          </p>
          {/* Like the locked judges: a list to read, not a page of disabled forms. */}
          <ol className="card mt-4 divide-y divide-line">
            {entries.map((e, i) => {
              const scored = scoredFor[e.id] ?? 0;
              return (
                <li key={e.id} className="flex items-center gap-4 px-5 py-3">
                  <span className="tabular w-8 text-right font-semibold text-prussian/70">{i + 1}</span>
                  {e.photoUrl && <Avatar name={e.name} src={e.photoUrl} size={48} square />}
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-semibold">{e.name}</span>
                    {detailsLine(fields, details?.byEntry[e.id]) && <span className="hint block truncate">{detailsLine(fields, details?.byEntry[e.id])}</span>}
                  </span>
                  <span className="tabular hint shrink-0">
                    {scored} {scored === 1 ? "score" : "scores"}
                  </span>
                </li>
              );
            })}
          </ol>
        </>
      ) : deliberating ? (
        <p role="note" className="note mt-3">
          The judges are deliberating, so no entries can be added. Names can still be corrected.
        </p>
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
            <ol className="card mt-4 divide-y divide-line">
              {entries.map((e, i) => (
                <EntryRow
                  key={e.id}
                  entry={e}
                  number={i + 1}
                  isFirst={i === 0}
                  isLast={i === entries.length - 1}
                  scored={scoredFor[e.id] ?? 0}
                  started={started}
                  // The shuffle's "is now first" no longer holds.
                  onReorder={() => setShuffled(null)}
                  // Each entry (or candidate) has a line of details: an older event's own named fields, or the general one.
                  fields={details ? (fields.length ? fields : [GENERAL_FIELD]) : []}
                  details={details?.byEntry[e.id] ?? {}}
                />
              ))}
            </ol>
          )}
          {/* Under the list it reorders: the order drawn at random, as often as the organizer likes before the start. */}
          {canShuffle && (
            <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2">
              <ConfirmDialog
                triggerLabel={
                  <>
                    <svg viewBox="0 0 16 16" className="size-4" aria-hidden>
                      <path
                        d="M2 4.5h2.2c1.2 0 2.2.6 2.9 1.6l1.8 3.8c.7 1 1.7 1.6 2.9 1.6H14M2 11.5h2.2c1 0 1.9-.4 2.5-1.2M14 4.5h-2.2c-1 0-1.9.4-2.5 1.2M12 2.5l2 2-2 2M12 9.5l2 2-2 2"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="1.6"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                    Shuffle order
                  </>
                }
                triggerClassName="btn btn-primary btn-sm"
                title="Shuffle the running order?"
                confirmLabel="Shuffle"
                onConfirm={async () => {
                  const result = await shuffleEntries(activityId);
                  if (result.ok) setShuffled(result);
                  return result;
                }}
              >
                Tabulous draws a new order at random, in place of the current one. Until the session starts you can shuffle again or move entries by hand.
                Starting the session locks the order.
              </ConfirmDialog>
              <p className="hint min-w-48 flex-1">Draws the running order at random. You can shuffle again until the session starts.</p>
              <FormMessage state={shuffled} small className="basis-full" />
            </div>
          )}
          {!deliberating && <AddEntryRows activityId={activityId} pageant={pageant} fields={fields} />}
          {/* Naming fields of their own is for events made before details were one general line, which keep theirs. */}
          {details && fields.some((f) => f.name !== GENERAL_DETAILS) && <EntryFieldsForm activityId={activityId} fields={fields} />}
        </div>
      )}
    </div>
  );
}
