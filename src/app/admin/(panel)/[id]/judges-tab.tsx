"use client";

import { useActionState, useState, useTransition } from "react";
import { Avatar } from "@/components/avatar";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { PhotoPicker } from "@/components/photo-picker";
import { SubmitButton } from "@/components/submit-button";
import type { Judge } from "@/lib/types";
import { nameParts } from "@/lib/names";
import { reach } from "@/lib/reach";
import type { ActionResult, JudgePanel } from "@/lib/types";
import { MIN_PROPER_JUDGES } from "@/lib/pageant-setup";
import { addJudge, removeJudge, renameJudge, setJudgePanel, setJudgePhoto, type FormResult } from "../../actions";
import { PANEL_OPTIONS } from "../new/judges-fields";
import { FormMessage } from "../form-message";
import { PersonNameInput } from "../person-name-input";

/** Pageants: which segments a judge judges, changed straight away. A chair's board is fixed, like the chair. */
function PanelSelect({ judge }: { judge: Judge }) {
  const [result, setResult] = useState<ActionResult | null>(null);
  const [pending, start] = useTransition();
  const id = `${judge.id}-panel`;
  return (
    <div className="flex flex-wrap items-center gap-2">
      <label htmlFor={id} className="text-sm font-semibold">
        Judges in<span className="sr-only"> for {judge.name}</span>
      </label>
      <select
        id={id}
        defaultValue={judge.panel}
        disabled={pending || judge.isChair}
        onChange={(e) => {
          const panel = e.target.value as JudgePanel;
          start(async () => setResult(await reach(() => setJudgePanel(judge.id, panel))));
        }}
        className="field h-9 w-auto py-0 text-sm"
      >
        {PANEL_OPTIONS.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      <FormMessage state={result} small />
    </div>
  );
}

const panelLabel = (panel: JudgePanel) => PANEL_OPTIONS.find((o) => o.value === panel)?.label ?? "Both segments";

/** What a chair chairs: the board of judges, or in a pageant with separate boards, one of them. */
const boardOf = (judge: Judge) =>
  judge.panel === "preliminary" ? "the preliminary board" : judge.panel === "proper" ? "the pageant proper board" : "the board of judges";

function ChairBadge({ judge }: { judge: Judge }) {
  return (
    <span className="rounded-full bg-wash px-2 py-0.5 text-xs font-semibold">
      {judge.panel === "preliminary" ? "Preliminary chair" : judge.panel === "proper" ? "Pageant proper chair" : "Chair"}
      <span className="sr-only">, chair of {boardOf(judge)}</span>
    </span>
  );
}

/** A pageant's boards at a glance: one board, or the preliminary's and pageant proper's, each with its chair. */
function BoardsSummary({ judges }: { judges: Judge[] }) {
  const separate = judges.some((j) => j.panel !== "all");
  const board = (panel: "preliminary" | "proper") => judges.filter((j) => j.panel === "all" || j.panel === panel);
  const chair = (list: Judge[]) => list.find((j) => j.isChair)?.name;
  const describe = (list: Judge[]) => `${list.length} ${list.length === 1 ? "judge" : "judges"}${chair(list) ? `, chaired by ${chair(list)}` : ""}`;
  const proper = board("proper");
  return (
    <div className="mt-3 space-y-2">
      <p className="hint">
        {separate
          ? `Separate boards. Preliminary: ${describe(board("preliminary"))}. Pageant proper: ${describe(proper)}.`
          : `One board for the whole pageant: ${describe(judges)}.`}
      </p>
      {proper.length < MIN_PROPER_JUDGES && (
        <p role="note" className="note">
          Pageant proper needs at least three judges before the session starts.
        </p>
      )}
    </div>
  );
}

function JudgeRow({ judge, scored, pageant }: { judge: Judge; scored: number; pageant: boolean }) {
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
        {pageant && <PanelSelect judge={judge} />}
        {judge.isChair && (
          <p className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-sm">
            {pageant ? (
              <ChairBadge judge={judge} />
            ) : (
              <span className="rounded-full bg-wash px-2 py-0.5 text-xs font-semibold">
                Chair<span className="sr-only"> of the board of judges</span>
              </span>
            )}
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

function AddJudgeForm({ activityId, pageant }: { activityId: string; pageant: boolean }) {
  const [state, action] = useActionState<FormResult, FormData>(addJudge.bind(null, activityId), null);
  return (
    <form action={action} className="mt-6 space-y-2">
      <fieldset>
        <legend className="label">Add a judge</legend>
        <div className="flex max-w-xl flex-wrap items-end gap-2">
          <NameFields idPrefix="new-judge" />
          {pageant && (
            <div className="min-w-40">
              <label htmlFor="new-judge-panel" className="mb-1 block text-sm font-semibold">
                Judges in
              </label>
              <select id="new-judge-panel" name="panel" defaultValue="all" className="field">
                {PANEL_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </div>
          )}
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
  pageant = false,
}: {
  activityId: string;
  judges: Judge[];
  scoredBy: Record<string, number>;
  /** Pageants: each judge judges both segments, or only the preliminary or pageant proper. */
  pageant?: boolean;
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
        {pageant && <BoardsSummary judges={judges} />}
        <ul className="mt-4 divide-y divide-line border-y border-line">
          {judges.map((j) => {
            const scored = scoredBy[j.id] ?? 0;
            return (
              <li key={j.id} className="flex items-center gap-4 py-4">
                <Avatar name={j.name} src={j.photoUrl} size={48} />
                <div className="min-w-0 flex-1">
                  <p className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
                    <span className="truncate text-lg font-semibold">{j.name}</span>
                    {j.isChair &&
                      (pageant ? (
                        <ChairBadge judge={j} />
                      ) : (
                        <span className="rounded-full bg-wash px-2 py-0.5 text-xs font-semibold">
                          Chair<span className="sr-only"> of the board of judges</span>
                        </span>
                      ))}
                  </p>
                  <p className="hint tabular">
                    {pageant && `${panelLabel(j.panel)} · `}
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
      {pageant && <BoardsSummary judges={judges} />}
      <fieldset className="min-w-0">
        {judges.length === 0 ? (
          <p className="mt-6 rounded-xl border border-dashed border-powder px-4 py-6 text-center">No judges yet. Add one below.</p>
        ) : (
          <ul className="mt-4 divide-y divide-line border-y border-line">
            {judges.map((j) => (
              <JudgeRow key={j.id} judge={j} scored={scoredBy[j.id] ?? 0} pageant={pageant} />
            ))}
          </ul>
        )}
        <AddJudgeForm activityId={activityId} pageant={pageant} />
      </fieldset>
    </div>
  );
}
