"use client";

import { useEffect, useState, type RefObject } from "react";
import type { JudgePanel } from "@/lib/types";
import { saveDraft } from "../../actions";
import type { DraftCandidate } from "./candidates-fields";
import type { DraftJudge } from "./judges-fields";

/** A draft opened from the Activities page: which one, and the form state it saved. */
export type OpenedDraft = { id: string; data: unknown };

/**
 * What the create forms share with the page around them: the draft they open, whether they have unsaved changes,
 * the form element (so the page's leave guard never stops it submitting), and how to save.
 */
export type DraftHostProps = {
  draft: OpenedDraft | null;
  onDirty: (dirty: boolean) => void;
  formRef: RefObject<HTMLFormElement | null>;
  saveRef: RefObject<() => Promise<boolean>>;
};

/** A judge as a draft keeps them: the photo as a small image in the JSON (photos are resized to ~30 KB first). */
export type SavedJudge = { first: string; last: string; photo: string | null; panel?: JudgePanel };

const blobToDataUrl = (blob: Blob) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });

function dataUrlToBlob(url: string): Blob | null {
  const match = /^data:([^;,]+);base64,(.*)$/.exec(url);
  if (!match) return null;
  const bytes = Uint8Array.from(atob(match[2]), (c) => c.charCodeAt(0));
  return new Blob([bytes], { type: match[1] });
}

export async function saveJudges(judges: DraftJudge[]): Promise<SavedJudge[]> {
  return Promise.all(judges.map(async (j) => ({ first: j.first, last: j.last, photo: j.photo ? await blobToDataUrl(j.photo) : null, panel: j.panel })));
}

/** Judges from a draft, with fresh row keys; anything malformed comes back blank. */
export function openJudges(value: unknown): DraftJudge[] | null {
  if (!Array.isArray(value) || value.length === 0) return null;
  return value.slice(0, 20).map((v, key) => {
    const j = (typeof v === "object" && v !== null ? v : {}) as Record<string, unknown>;
    const photo = typeof j.photo === "string" && j.photo.startsWith("data:image/") ? j.photo : null;
    const panel: JudgePanel = j.panel === "preliminary" || j.panel === "proper" ? j.panel : "all";
    return { key, first: String(j.first ?? ""), last: String(j.last ?? ""), photo: photo ? dataUrlToBlob(photo) : null, preview: photo, panel };
  });
}

/** A candidate as a pageant draft keeps them, with the photo as an image in the JSON like a judge's. */
export type SavedCandidate = { name: string; photo: string | null };

// Room for photos in one draft: a save over 4.5 MB doesn't reach the server, and candidate photos are ~100 KB each.
const PHOTO_ROOM = 3_500_000;

/**
 * Candidates for a draft, with as many photos as fit beside `used` characters of other photos (the judges'),
 * in running order. `dropped` counts the photos left out.
 */
export async function saveCandidates(candidates: DraftCandidate[], used: number): Promise<{ saved: SavedCandidate[]; dropped: number }> {
  let room = PHOTO_ROOM - used;
  let dropped = 0;
  const saved: SavedCandidate[] = [];
  for (const c of candidates) {
    let photo = c.photo ? await blobToDataUrl(c.photo) : null;
    if (photo && photo.length > room) {
      photo = null;
      dropped++;
    }
    if (photo) room -= photo.length;
    saved.push({ name: c.name, photo });
  }
  return { saved, dropped };
}

/** Candidates from a draft: rows with photos, or (drafts saved before photos) names one per line. */
export function openCandidates(value: unknown): DraftCandidate[] {
  const rows: unknown[] = typeof value === "string" ? value.split(/\r?\n/).filter((l) => l.trim()) : Array.isArray(value) ? value : [];
  return rows.slice(0, 300).map((v, key) => {
    if (typeof v === "string") return { key, name: v.trim(), photo: null, preview: null };
    const c = (typeof v === "object" && v !== null ? v : {}) as Record<string, unknown>;
    const photo = typeof c.photo === "string" && c.photo.startsWith("data:image/") ? c.photo : null;
    return { key, name: String(c.name ?? ""), photo: photo ? dataUrlToBlob(photo) : null, preview: photo };
  });
}

const timeFormat = new Intl.DateTimeFormat("en", { hour: "numeric", minute: "2-digit" });

/**
 * Saving a create form as a draft. `snapshot` is the form's state as text: anything that differs from the last
 * saved (or opened) one counts as unsaved. `collect` builds the JSON to save, and can `note` something the save
 * left out. After the first save the address becomes /admin/new?draft=…, so a reload opens the draft and later
 * saves update it.
 */
export function useDraft({
  openedId,
  onDirty,
  saveRef,
  kind,
  name,
  snapshot,
  collect,
}: {
  /** The draft the form was opened from, if any. */
  openedId: string | null;
  onDirty: (dirty: boolean) => void;
  saveRef: RefObject<() => Promise<boolean>>;
  kind: "event" | "pageant";
  name: string;
  snapshot: string;
  collect: (note: (text: string) => void) => Promise<unknown>;
}) {
  const [draftId, setDraftId] = useState(openedId);
  const [saved, setSaved] = useState(snapshot);
  const [status, setStatus] = useState<{ ok: boolean; text: string } | null>(openedId ? { ok: true, text: "Continuing your saved draft." } : null);
  const [saving, setSaving] = useState(false);
  const dirty = snapshot !== saved;

  useEffect(() => onDirty(dirty), [dirty, onDirty]);

  const save = async (): Promise<boolean> => {
    setSaving(true);
    const taken = snapshot;
    let note = "";
    let result: Awaited<ReturnType<typeof saveDraft>>;
    try {
      result = await saveDraft(draftId, kind, name, JSON.stringify(await collect((text) => (note = text))));
    } catch {
      result = { ok: false, error: "That didn't reach the server. Check this screen's connection and try again." };
    }
    setSaving(false);
    if (!result.ok) {
      setStatus({ ok: false, text: result.error });
      return false;
    }
    setDraftId(result.id);
    setSaved(taken);
    setStatus({ ok: true, text: `Draft saved at ${timeFormat.format(new Date(result.savedAt))}.${note ? ` ${note}` : ""}` });
    window.history.replaceState(null, "", `/admin/new?draft=${result.id}`);
    return true;
  };
  // The page's leave dialog saves through this, so it always calls the latest save.
  useEffect(() => {
    saveRef.current = save;
  });

  return { draftId, dirty, save, saving, status };
}

/** The Save draft button and what the last save did, for the bottom of a create form. */
export function SaveDraftButton({ draft }: { draft: ReturnType<typeof useDraft> }) {
  return (
    <>
      <button type="button" className="btn btn-quiet" onClick={() => void draft.save()} disabled={draft.saving}>
        {draft.saving ? "Saving draft…" : "Save draft"}
      </button>
      {draft.status && (
        <p role={draft.status.ok ? "status" : "alert"} className={`text-sm ${draft.status.ok ? "text-regal" : "font-semibold text-danger"}`}>
          {draft.status.text}
          {draft.status.ok && draft.dirty && " You've made changes since."}
        </p>
      )}
    </>
  );
}
