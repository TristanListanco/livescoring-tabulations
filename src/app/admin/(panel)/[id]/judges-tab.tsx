"use client";

import { useActionState, useOptimistic, useState, useTransition } from "react";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { PhotoPicker } from "@/components/photo-picker";
import { SubmitButton } from "@/components/submit-button";
import type { Judge } from "@/lib/types";
import { addJudge, removeJudge, renameJudge, setJudgeMovesEntries, setJudgePhoto, type FormResult } from "../../actions";

function FormMessage({ state }: { state: FormResult }) {
  if (!state) return null;
  return state.ok ? (
    <p role="status" className="text-sm text-regal">
      {state.message}
    </p>
  ) : (
    <p role="alert" className="text-sm font-semibold text-danger">
      {state.error}
    </p>
  );
}

function JudgeRow({ judge, scored }: { judge: Judge; scored: number }) {
  const [state, rename] = useActionState<FormResult, FormData>(renameJudge.bind(null, judge.id), null);
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
        <form action={rename} className="flex max-w-md items-center gap-2">
          <label htmlFor={`name-${judge.id}`} className="sr-only">
            Name
          </label>
          <input id={`name-${judge.id}`} name="name" required maxLength={120} defaultValue={judge.name} className="field" />
          <SubmitButton className="btn btn-quiet" pendingLabel="Saving…">
            Save
          </SubmitButton>
        </form>
        <FormMessage state={state} />
        {photoError && (
          <p role="alert" className="text-sm font-semibold text-danger">
            {photoError}
          </p>
        )}
        <p className="hint tabular">
          {scored} {scored === 1 ? "score" : "scores"} submitted
          {judge.photoUrl && !photoPending && (
            <>
              {" "}
              <button type="button" className="ml-2 font-semibold text-regal hover:underline" onClick={() => changePhoto(null, null)}>
                Remove photo
              </button>
            </>
          )}
        </p>
      </div>

      <ConfirmDialog
        triggerLabel="Remove"
        triggerClassName="btn btn-sm text-danger hover:bg-danger/10"
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

function AddJudgeForm({ activityId }: { activityId: string }) {
  const [state, action] = useActionState<FormResult, FormData>(addJudge.bind(null, activityId), null);
  return (
    <form action={action} className="mt-6 space-y-2">
      <label htmlFor="new-judge" className="label">
        Add a judge
      </label>
      <div className="flex max-w-md gap-2">
        <input id="new-judge" name="name" required maxLength={120} placeholder="Full name" className="field" />
        <SubmitButton pendingLabel="Adding…">Add judge</SubmitButton>
      </div>
      <label className="flex w-fit cursor-pointer items-center gap-2 text-[15px]">
        <input type="checkbox" name="moves" className="size-4 accent-regal" />
        Can move entries (board of tabulators)
      </label>
      <FormMessage state={state} />
    </form>
  );
}

/**
 * Board of tabulators: judges who can move to the previous or next entry from their own screen, as the
 * organizer can from the Session tab. Saves on change and stays editable after the session starts.
 */
function Tabulators({ judges }: { judges: Judge[] }) {
  const [moves, setMoves] = useOptimistic(
    new Map(judges.map((j) => [j.id, j.canMoveEntries])),
    (map: Map<string, boolean>, change: { id: string; on: boolean }) => new Map(map).set(change.id, change.on),
  );
  const [result, setResult] = useState<FormResult>(null);
  const [, startTransition] = useTransition();
  const toggle = (judge: Judge, on: boolean) =>
    startTransition(async () => {
      setMoves({ id: judge.id, on });
      setResult(await setJudgeMovesEntries(judge.id, on));
    });

  return (
    <section aria-labelledby="tabulators" className="mt-10">
      <h2 id="tabulators" className="text-xl font-bold">
        Board of tabulators
      </h2>
      <p className="hint mt-1 max-w-2xl">
        Who can move entries besides you. A judge you tick here gets Previous and Next entry buttons on their screen once they&apos;ve scored the
        entry, and the LED wall follows. You can change this at any time, even during the session.
      </p>
      {judges.length === 0 ? (
        <p className="hint mt-4">Add judges first.</p>
      ) : (
        <fieldset className="mt-4">
          <legend className="sr-only">Judges who can move entries</legend>
          <ul className="flex flex-wrap gap-2">
            {judges.map((j) => (
              <li key={j.id}>
                <label className="flex cursor-pointer items-center gap-2.5 rounded-lg border border-line bg-white px-3.5 py-2.5 has-checked:border-regal has-checked:bg-regal has-checked:text-mint">
                  <input
                    type="checkbox"
                    checked={moves.get(j.id) ?? false}
                    onChange={(e) => toggle(j, e.target.checked)}
                    className="size-4 accent-mint"
                    aria-label={`${j.name} can move entries`}
                  />
                  <span className="font-semibold">{j.name}</span>
                </label>
              </li>
            ))}
          </ul>
        </fieldset>
      )}
      <div className="mt-3">
        <FormMessage state={result} />
      </div>
    </section>
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
  return (
    <div className="max-w-3xl">
      <h2 className="text-xl font-bold">Judges</h2>
      {locked ? (
        <p role="note" className="mt-3 rounded-lg bg-wash px-4 py-3 text-[15px]">
          Judges are locked because the session has started. To change them, reset scores in the Developer tab, which puts the session back to not
          started.
        </p>
      ) : (
        <p className="hint mt-1">Click a photo to change it. New judges get an access code right away, shown in the Access tab.</p>
      )}
      <fieldset disabled={locked} className="min-w-0">
        {judges.length === 0 ? (
          <p className="mt-6 rounded-xl border border-dashed border-powder px-4 py-6 text-center">No judges yet. Add one below.</p>
        ) : (
          <ul className="mt-4 divide-y divide-line border-y border-line">
            {judges.map((j) => (
              <JudgeRow key={j.id} judge={j} scored={scoredBy[j.id] ?? 0} />
            ))}
          </ul>
        )}
        {!locked && <AddJudgeForm activityId={activityId} />}
      </fieldset>
      <Tabulators judges={judges} />
    </div>
  );
}
