"use client";

import { useActionState, useRef, useState, useTransition } from "react";
import { Avatar } from "@/components/avatar";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { PhotoPicker } from "@/components/photo-picker";
import { SubmitButton } from "@/components/submit-button";
import type { Judge } from "@/lib/types";
import { nameParts } from "@/lib/names";
import { reach } from "@/lib/reach";
import type { ActionResult, JudgePanel } from "@/lib/types";
import { addJudge, removeJudge, renameJudge, setChair, setJudgePanel, setJudgePhoto, type FormResult } from "../../actions";
import { PANEL_OPTIONS } from "../new/judges-fields";
import { FormMessage } from "../form-message";
import { toast, toastSaved } from "../toaster";
import { PersonNameInput } from "../person-name-input";

/** Pageants: which segments a judge judges, changed straight away. A chair stays on their board while they chair it. */
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
          start(async () => {
            const label = PANEL_OPTIONS.find((o) => o.value === panel)?.label ?? panel;
            setResult(toastSaved(await reach(() => setJudgePanel(judge.id, panel)), `${judge.name}: ${label}`));
          });
        }}
        className="field h-9 w-auto py-0 text-sm"
      >
        {PANEL_OPTIONS.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      <FormMessage state={result?.ok ? null : result} small />
    </div>
  );
}

/** What a chair chairs: the board of judges, or in a pageant with separate boards, one of them. */
const boardOf = (judge: Judge) =>
  judge.panel === "preliminary" ? "the preliminary board" : judge.panel === "proper" ? "the pageant proper board" : "the board of judges";

export function ChairBadge({ judge }: { judge: Judge }) {
  return (
    <span className="rounded-full bg-wash px-2 py-0.5 text-xs font-semibold">
      {judge.panel === "preliminary" ? "Preliminary chair" : judge.panel === "proper" ? "Pageant proper chair" : "Chair"}
      <span className="sr-only">, chair of {boardOf(judge)}</span>
    </span>
  );
}

/**
 * Another judge takes over as chair, until the session starts: from the chair of the same segments, so it's offered
 * only to a judge on a chair's segments. In a pageant with separate boards it names the board.
 */
function TakeChair({ judge, pageant, onResult }: { judge: Judge; pageant: boolean; onResult: (result: ActionResult) => void }) {
  const [pending, start] = useTransition();
  const label = pageant && judge.panel === "preliminary" ? "Make preliminary chair" : pageant && judge.panel === "proper" ? "Make pageant proper chair" : "Make chair";
  return (
    <button type="button" className="text-action disabled:opacity-50" disabled={pending} onClick={() => start(async () => onResult(toastSaved(await reach(() => setChair(judge.id)))))}>
      {label}
      <span className="sr-only"> {judge.name}</span>
    </button>
  );
}

/**
 * A judge's row before the session starts, on the Judges tab: their photo and name to change (Save appears once the
 * name is edited), a pageant's segments and the chair. `detail`: the line under the name (how far they've got). Remove
 * is at the row's end (RemoveJudge).
 */
export function JudgeEditor({
  judge,
  pageant,
  detail,
  canChair,
  fixedPanel = false,
}: {
  judge: Judge;
  pageant: boolean;
  detail: string;
  /** Their segments can't change: a pageant proper judge while the preliminary runs (moving them would change its board). */
  fixedPanel?: boolean;
  /** They can take over as chair: they're on the same segments as a chair. */
  canChair: boolean;
}) {
  const [state, rename] = useActionState<FormResult, FormData>(async (previous, data) => {
    const name = [data.get("first_name"), data.get("last_name")].map((v) => String(v ?? "").trim()).filter(Boolean).join(" ");
    return toastSaved(await renameJudge(judge.id, previous, data), `${name || judge.name} saved`);
  }, null);
  // Save shows only once a name has been edited.
  const initial = nameParts(judge);
  const [edited, setEdited] = useState(initial);
  const dirty = edited.first.trim() !== initial.first || edited.last.trim() !== initial.last;
  const [photoPending, startPhoto] = useTransition();
  const [photoError, setPhotoError] = useState<string | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  // Taking over as chair: kept here, since the button goes once they're chair. Said while they still are.
  const [chairResult, setChairResult] = useState<ActionResult | null>(null);

  const changePhoto = (photo: Blob | null, previewUrl: string | null) =>
    startPhoto(async () => {
      setPhotoError(null);
      setPreview(previewUrl);
      const data = new FormData();
      if (photo) data.set("photo", photo, "photo.jpg");
      const result = await setJudgePhoto(judge.id, data);
      if (!result.ok) setPhotoError(result.error);
      else toast(photo ? `${judge.name}'s photo updated` : `${judge.name}'s photo removed`);
    });

  return (
    <div className="flex items-start gap-4">
      <div className={photoPending ? "opacity-60" : undefined}>
        <PhotoPicker
          name={judge.name}
          currentUrl={photoPending ? preview : judge.photoUrl}
          size={48}
          onPick={(photo, url) => changePhoto(photo, url)}
          onRemove={() => changePhoto(null, null)}
        />
      </div>
      <div className="min-w-0 flex-1 space-y-2">
        {/* The column says it's the judge: the names need no labels on show, only for screen readers. */}
        <form action={rename} className="flex flex-wrap items-end gap-2">
          <NameFields idPrefix={judge.id} value={edited} onChange={setEdited} quiet />
          <SubmitButton className={`btn btn-quiet ${dirty ? "" : "hidden"}`} pendingLabel="Saving…">
            Save<span className="sr-only"> {judge.name}</span>
          </SubmitButton>
        </form>
        <FormMessage state={state?.ok ? null : state} small />
        <FormMessage state={photoError ? { ok: false, error: photoError } : null} small />
        {/* Which segments they judge: the board's section heading says it; here it can be changed until it's fixed. */}
        {pageant && !fixedPanel && <PanelSelect judge={judge} />}
        {(judge.isChair || detail || canChair) && (
          <div className="hint tabular flex flex-wrap items-center gap-x-3 gap-y-1">
            {judge.isChair && (pageant ? <ChairBadge judge={judge} /> : <PlainChairBadge />)}
            {detail}
            {canChair && <TakeChair judge={judge} pageant={pageant} onResult={setChairResult} />}
          </div>
        )}
        <FormMessage state={chairResult && !chairResult.ok ? chairResult : null} small />
      </div>
    </div>
  );
}

/** Taking a judge off the panel, until the session starts: not the chair, whose board would be left without one. */
export function RemoveJudge({ judge, scored }: { judge: Judge; scored: number }) {
  return (
    <ConfirmDialog
      triggerLabel={
        <>
          Remove<span className="sr-only"> {judge.name}</span>
        </>
      }
      triggerClassName="btn btn-sm px-2.5 text-danger hover:bg-danger/10 disabled:hover:bg-transparent"
      // Their board would be left without a chair: another judge takes over first.
      triggerDisabled={judge.isChair}
      title={`Remove ${judge.name}?`}
      tone="danger"
      confirmLabel="Remove judge"
      onConfirm={async () => toastSaved(await removeJudge(judge.id), `${judge.name} removed`)}
    >
      {scored > 0
        ? `Their ${scored} submitted ${scored === 1 ? "score" : "scores"} will be deleted, so averages will change. `
        : "They haven't submitted any scores. "}
      Their access code will stop working.
    </ConfirmDialog>
  );
}

/** A judge's row once the session has started: the panel is locked, so their name and chair only. */
export function JudgeIdentity({ judge, pageant, detail }: { judge: Judge; pageant: boolean; detail: string }) {
  return (
    <div className="flex items-center gap-4">
      <Avatar name={judge.name} src={judge.photoUrl} size={48} />
      <div className="min-w-0 flex-1">
        <p className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
          <span className="truncate text-lg font-semibold">{judge.name}</span>
          {judge.isChair && (pageant ? <ChairBadge judge={judge} /> : <PlainChairBadge />)}
        </p>
        {/* Their segments are their board's section heading (or, with one board, both). */}
        {detail && <p className="hint tabular">{detail}</p>}
      </div>
    </div>
  );
}

function PlainChairBadge() {
  return (
    <span className="rounded-full bg-wash px-2 py-0.5 text-xs font-semibold text-prussian">
      Chair<span className="sr-only"> of the board of judges</span>
    </span>
  );
}

type Name = { first: string; last: string };

/**
 * First and last name. The full name goes on the results PDF; the LED wall shows the first name. `quiet`: the labels
 * for screen readers only, in a judge's row (its column says what the names are).
 */
function NameFields({ idPrefix, value, onChange, quiet = false }: { idPrefix: string; value?: Name; onChange?: (name: Name) => void; quiet?: boolean }) {
  const labelClass = quiet ? "sr-only" : "mb-1 block text-sm font-semibold";
  // Controlled when editing a judge (so Save can appear on change), uncontrolled when adding one.
  const bind = (key: keyof Name) =>
    value && onChange ? { value: value[key], onValueChange: (typed: string) => onChange({ ...value, [key]: typed }) } : {};
  return (
    <>
      <div className="min-w-36 flex-1 self-start">
        <label htmlFor={`${idPrefix}-first`} className={labelClass}>
          First name
        </label>
        <PersonNameInput id={`${idPrefix}-first`} name="first_name" part="first" required {...bind("first")} />
      </div>
      <div className="min-w-36 flex-1 self-start">
        <label htmlFor={`${idPrefix}-last`} className={labelClass}>
          Last name
        </label>
        <PersonNameInput id={`${idPrefix}-last`} name="last_name" part="last" required {...bind("last")} />
      </div>
    </>
  );
}

/**
 * Adding a judge, as the judges card's last row: shaped like the rows above it (a round place for the photo, then the
 * names), on the card's quieter wash so it reads as the row still to fill in. A toast says they're added (problems stay
 * under the fields); their photo goes on from their own row.
 */
export function AddJudgeForm({
  activityId,
  pageant,
  first,
  properOnly = false,
}: {
  activityId: string;
  pageant: boolean;
  first: boolean;
  /** While the preliminary runs: a judge added now judges pageant proper only. */
  properOnly?: boolean;
}) {
  // The new judge's photo, chosen before they're added and sent with them. Kept in a ref too, for the action to read.
  const [photo, setPhoto] = useState<{ blob: Blob; url: string } | null>(null);
  const chosen = useRef(photo);
  const choose = (next: typeof photo) => {
    chosen.current = next;
    setPhoto(next);
  };
  const [state, action] = useActionState<FormResult, FormData>(async (previous, data) => {
    if (chosen.current) data.set("photo", chosen.current.blob, "photo.jpg");
    const result = await addJudge(activityId, previous, data);
    if (result?.ok) {
      choose(null);
      toast(result.message ? result.message.replace(/\.$/, "") : "Judge added");
      // Back to the first name, for the next judge, without reaching for the mouse.
      requestAnimationFrame(() => document.getElementById("new-judge-first")?.focus());
    }
    return result;
  }, null);
  return (
    <form action={action} className={`bg-wash/60 px-5 py-5 ${first ? "" : "border-t border-line"}`}>
      <fieldset className="min-w-0">
        <legend className="mb-3 font-semibold">{properOnly ? "Add a pageant proper judge" : "Add a judge"}</legend>
        {/* Shaped like the rows above: a photo (optional, chosen here), then the names. */}
        <div className="flex items-start gap-4 sm:items-end">
          <PhotoPicker
            name="New judge"
            currentUrl={photo?.url ?? null}
            size={48}
            label="Photo for the new judge (optional)"
            onPick={(blob, url) => choose({ blob, url })}
            onRemove={() => choose(null)}
          />
          <div className="flex max-w-2xl min-w-0 flex-1 flex-wrap items-end gap-2">
          <NameFields idPrefix="new-judge" />
          {properOnly && <input type="hidden" name="panel" value="proper" />}
          {pageant && !properOnly && (
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
        </div>
        <FormMessage state={state?.ok ? null : state} small className="mt-2" />
      </fieldset>
    </form>
  );
}
