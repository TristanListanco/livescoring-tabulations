"use client";

import { useActionState, useState, useTransition } from "react";
import { Avatar } from "@/components/avatar";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { PhotoPicker } from "@/components/photo-picker";
import { SubmitButton } from "@/components/submit-button";
import type { Judge } from "@/lib/types";
import { nameParts } from "@/lib/names";
import { addJudge, removeJudge, renameJudge, setJudgePhoto, type FormResult } from "../../actions";
import { FormMessage } from "../form-message";
import { PersonNameInput } from "../person-name-input";

function JudgeRow({ judge, scored }: { judge: Judge; scored: number }) {
  const [state, rename] = useActionState<FormResult, FormData>(renameJudge.bind(null, judge.id), null);
  // Save shows only once a name has been edited.
  const initial = nameParts(judge);
  const [edited, setEdited] = useState(initial);
  const dirty = edited.first.trim() !== initial.first || edited.last.trim() !== initial.last;
  const [photoPending, startPhoto] = useTransition();
  const [photoError, setPhotoError] = useState<string | null>(null);
  const [preview, setPreview] = useState<string | null>(null);

  const changePhoto = (photo: Blob | null, previewUrl: string | null) =>
    startPhoto(async () => {
      setPhotoError(null);
      setPreview(previewUrl);
      const data = new FormData();
      if (photo) data.set("photo", photo, "photo.jpg");
      const result = await setJudgePhoto(judge.id, data);
      if (!result.ok) setPhotoError(result.error);
    });

  return (
    <li className="flex flex-wrap items-start gap-x-5 gap-y-3 py-5">
      <div className={photoPending ? "opacity-60" : undefined}>
        <PhotoPicker
          name={judge.name}
          currentUrl={photoPending ? preview : judge.photoUrl}
          size={60}
          onPick={(photo, url) => changePhoto(photo, url)}
        />
      </div>

      <div className="min-w-0 flex-1 space-y-2">
        <form action={rename} className="flex max-w-xl flex-wrap items-end gap-2">
          <NameFields idPrefix={judge.id} value={edited} onChange={setEdited} />
          <SubmitButton className={`btn btn-quiet ${dirty ? "" : "invisible max-sm:hidden"}`} pendingLabel="Saving…">
            Save<span className="sr-only"> {judge.name}</span>
          </SubmitButton>
        </form>
        <FormMessage state={state} small />
        <FormMessage state={photoError ? { ok: false, error: photoError } : null} small />
        {judge.isChair && (
          <p className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-sm">
            <span className="rounded-full bg-wash px-2 py-0.5 text-xs font-semibold">
              Chair<span className="sr-only"> of the board of judges</span>
            </span>
            <span className="hint">Can move judging to the previous or next entry from their own screen.</span>
          </p>
        )}
        <p className="hint tabular">
          {scored} {scored === 1 ? "score" : "scores"} submitted
          {judge.photoUrl && !photoPending && (
            <>
              {" "}
              <button type="button" className="text-action ml-2" onClick={() => changePhoto(null, null)}>
                Remove photo
              </button>
            </>
          )}
        </p>
      </div>

      <ConfirmDialog
        triggerLabel={
          <>
            Remove<span className="sr-only"> {judge.name}</span>
          </>
        }
        triggerClassName="btn btn-sm text-danger hover:bg-danger/10"
        // The chair is decided when the activity is created.
        triggerDisabled={judge.isChair}
        title={`Remove ${judge.name}?`}
        tone="danger"
        confirmLabel="Remove judge"
        onConfirm={() => removeJudge(judge.id)}
      >
        {scored > 0
          ? `Their ${scored} submitted ${scored === 1 ? "score" : "scores"} will be deleted, so averages will change. `
          : "They haven't submitted any scores. "}
        Their access code will stop working.
      </ConfirmDialog>
    </li>
  );
}

type Name = { first: string; last: string };

/** First and last name. The full name goes on the results PDF; the LED wall shows the first name. */
function NameFields({ idPrefix, value, onChange }: { idPrefix: string; value?: Name; onChange?: (name: Name) => void }) {
  // Controlled when editing a judge (so Save can appear on change), uncontrolled when adding one.
  const bind = (key: keyof Name) =>
    value && onChange ? { value: value[key], onValueChange: (typed: string) => onChange({ ...value, [key]: typed }) } : {};
  return (
    <>
      <div className="min-w-36 flex-1 self-start">
        <label htmlFor={`${idPrefix}-first`} className="mb-1 block text-sm font-semibold">
          First name
        </label>
        <PersonNameInput id={`${idPrefix}-first`} name="first_name" part="first" required {...bind("first")} />
      </div>
      <div className="min-w-36 flex-1 self-start">
        <label htmlFor={`${idPrefix}-last`} className="mb-1 block text-sm font-semibold">
          Last name
        </label>
        <PersonNameInput id={`${idPrefix}-last`} name="last_name" part="last" required {...bind("last")} />
      </div>
    </>
  );
}

function AddJudgeForm({ activityId }: { activityId: string }) {
  const [state, action] = useActionState<FormResult, FormData>(addJudge.bind(null, activityId), null);
  return (
    <form action={action} className="mt-6 space-y-2">
      <fieldset>
        <legend className="label">Add a judge</legend>
        <div className="flex max-w-xl flex-wrap items-end gap-2">
          <NameFields idPrefix="new-judge" />
          <SubmitButton pendingLabel="Adding…">Add judge</SubmitButton>
        </div>
      </fieldset>
      <FormMessage state={state} small />
    </form>
  );
}

export function JudgesTab({
  activityId,
  judges,
  scoredBy,
  locked,
}: {
  activityId: string;
  judges: Judge[];
  scoredBy: Record<string, number>;
  /** Once the session has started the panel can't change. */
  locked: boolean;
}) {
  // Once judging starts the panel is fixed, so it reads as a list rather than a page of disabled forms.
  if (locked) {
    return (
      <div className="max-w-3xl">
        <h2 className="text-xl font-bold">Judges</h2>
        <p role="note" className="note mt-3">
          The session has started, so the panel of judges is locked.
        </p>
        <ul className="mt-4 divide-y divide-line border-y border-line">
          {judges.map((j) => {
            const scored = scoredBy[j.id] ?? 0;
            return (
              <li key={j.id} className="flex items-center gap-4 py-4">
                <Avatar name={j.name} src={j.photoUrl} size={48} />
                <div className="min-w-0 flex-1">
                  <p className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
                    <span className="truncate text-lg font-semibold">{j.name}</span>
                    {j.isChair && (
                      <span className="rounded-full bg-wash px-2 py-0.5 text-xs font-semibold">
                        Chair<span className="sr-only"> of the board of judges</span>
                      </span>
                    )}
                  </p>
                  <p className="hint tabular">
                    {scored} {scored === 1 ? "score" : "scores"} submitted
                  </p>
                </div>
              </li>
            );
          })}
        </ul>
      </div>
    );
  }

  return (
    <div className="max-w-3xl">
      <h2 className="text-xl font-bold">Judges</h2>
      <fieldset className="min-w-0">
        {judges.length === 0 ? (
          <p className="mt-6 rounded-xl border border-dashed border-powder px-4 py-6 text-center">No judges yet. Add one below.</p>
        ) : (
          <ul className="mt-4 divide-y divide-line border-y border-line">
            {judges.map((j) => (
              <JudgeRow key={j.id} judge={j} scored={scoredBy[j.id] ?? 0} />
            ))}
          </ul>
        )}
        <AddJudgeForm activityId={activityId} />
      </fieldset>
    </div>
  );
}
