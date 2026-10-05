"use client";

import { useActionState, useState, useTransition } from "react";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { PhotoPicker } from "@/components/photo-picker";
import { SubmitButton } from "@/components/submit-button";
import { MIN_PASSWORD_LENGTH } from "@/lib/password-rules";
import type { AdminAccount, Signatory } from "@/lib/types";
import { deleteOrganizer, setOrganizerPhoto, updateOrganizer } from "../../../account-actions";
import type { FormResult } from "../../../actions";
import { FormMessage } from "../../form-message";
import { Section } from "../../section";
import { SignatoriesEditor } from "../../signatories-editor";

export function EditOrganizer({
  organizer,
  activities,
  signatories,
}: {
  organizer: AdminAccount;
  /** Names only: an organizer's activities are private to them. */
  activities: string[];
  signatories: Signatory[];
}) {
  const [state, action] = useActionState<FormResult, FormData>(updateOrganizer.bind(null, organizer.id), null);
  const [photoPending, startPhoto] = useTransition();
  const [photoState, setPhotoState] = useState<FormResult>(null);
  const [preview, setPreview] = useState<string | null>(null);

  const changePhoto = (photo: Blob | null, url: string | null) =>
    startPhoto(async () => {
      setPreview(url);
      const data = new FormData();
      if (photo) data.set("photo", photo, "photo.jpg");
      const result = await setOrganizerPhoto(organizer.id, data);
      setPhotoState(result.ok ? null : result);
    });

  return (
    <div className="mt-6 max-w-4xl">
      <form action={action}>
        <Section title="Organizer" flush>
          <div className="flex flex-wrap items-start gap-6">
            <div className="flex flex-col items-center gap-2">
              <div className={photoPending ? "opacity-60" : undefined}>
                <PhotoPicker
                  name={organizer.name}
                  currentUrl={photoPending ? preview : organizer.photoUrl}
                  size={80}
                  onPick={(blob, url) => changePhoto(blob, url)}
                />
              </div>
              {organizer.photoUrl && !photoPending && (
                <button type="button" className="text-action" onClick={() => changePhoto(null, null)}>
                  Remove photo
                </button>
              )}
              <FormMessage state={photoState} />
            </div>
            <div className="min-w-64 flex-1 space-y-4">
              <div>
                <label htmlFor="name" className="label">
                  Organizer name
                </label>
                <input id="name" name="name" required maxLength={120} defaultValue={organizer.name} className="field max-w-md" />
              </div>
              <div>
                <label htmlFor="email" className="label">
                  Email
                </label>
                <input id="email" name="email" type="email" required defaultValue={organizer.email} autoComplete="off" className="field max-w-md" />
              </div>
            </div>
          </div>
        </Section>

        <Section title="Password" hint="Leave blank to keep their current password. A new one signs them out on their other devices.">
          <label htmlFor="password" className="label">
            New password
          </label>
          <input
            id="password"
            name="password"
            type="password"
            minLength={MIN_PASSWORD_LENGTH}
            autoComplete="new-password"
            className="field max-w-md"
          />
        </Section>

        {/* Full width with its own rule, so it reads as saving the whole account (name, email and password), not just the password. */}
        <div className="flex flex-wrap items-center gap-4 border-t border-line py-6">
          <SubmitButton>Save account details</SubmitButton>
          <FormMessage state={state} />
        </div>
      </form>

      <Section title="Results PDF signatories">
        <SignatoriesEditor adminId={organizer.id} initial={signatories} />
      </Section>

      <Section title="Activities">
        {activities.length === 0 ? (
          <p className="hint">None yet. Activities they create appear here.</p>
        ) : (
          <ul className="list-disc space-y-1.5 pl-5">
            {activities.map((name, i) => (
              <li key={i} className="font-semibold">
                {name}
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title="Delete account">
        <ConfirmDialog
          triggerLabel="Delete organizer"
          triggerClassName="btn btn-danger-quiet"
          title={`Delete ${organizer.name}?`}
          tone="danger"
          confirmLabel="Delete organizer"
          requireText={organizer.email}
          onConfirm={() => deleteOrganizer(organizer.id)}
        >
          {organizer.name} will be signed out and can&apos;t sign in again.{" "}
          {activities.length > 0
            ? `Their ${activities.length} ${activities.length === 1 ? "activity is" : "activities are"} deleted too, with every judge, entry, score and photo. This can't be undone.`
            : "They have no activities."}
        </ConfirmDialog>
      </Section>
    </div>
  );
}
