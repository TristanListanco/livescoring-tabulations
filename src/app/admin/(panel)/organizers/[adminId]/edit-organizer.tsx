"use client";

import Link from "next/link";
import { useActionState, useState, useTransition } from "react";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { PhotoPicker } from "@/components/photo-picker";
import { SubmitButton } from "@/components/submit-button";
import { MIN_PASSWORD_LENGTH } from "@/lib/password-rules";
import type { AdminAccount, Signatory } from "@/lib/types";
import { deleteOrganizer, setOrganizerPhoto, updateOrganizer } from "../../../account-actions";
import type { FormResult } from "../../../actions";
import { Section } from "../../section";
import { SignatoriesEditor } from "../../signatories-editor";

function Message({ state }: { state: FormResult }) {
  if (!state) return null;
  return (
    <p role={state.ok ? "status" : "alert"} className={state.ok ? "text-regal" : "font-semibold text-danger"}>
      {state.ok ? state.message : state.error}
    </p>
  );
}

export function EditOrganizer({
  organizer,
  activities,
  signatories,
}: {
  organizer: AdminAccount;
  activities: { id: string; name: string }[];
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
        <Section title="Organizer" hint="Shown in their admin panel after they sign in." flush>
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
                <button type="button" className="text-sm font-semibold text-regal hover:underline" onClick={() => changePhoto(null, null)}>
                  Remove photo
                </button>
              )}
              <Message state={photoState} />
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
          <input id="password" name="password" type="password" minLength={MIN_PASSWORD_LENGTH} autoComplete="new-password" className="field max-w-md" />
        </Section>

        <div className="flex flex-wrap items-center gap-4 pb-8 md:pl-[calc(14rem+2.5rem)]">
          <SubmitButton>Save changes</SubmitButton>
          <Message state={state} />
        </div>
      </form>

      <Section
        title="Results PDF signatories"
        hint="Board of tabulators, representatives and others who sign the results. Each prints as a signature line with their designation, under the organizer's photo and name."
      >
        <SignatoriesEditor adminId={organizer.id} initial={signatories} />
      </Section>

      <Section title="Activities" hint="Activities this organizer can manage. Change an activity's organizer from its Settings tab.">
        {activities.length === 0 ? (
          <p className="hint">None yet. Activities they create appear here.</p>
        ) : (
          <ul className="space-y-1.5">
            {activities.map((a) => (
              <li key={a.id}>
                <Link href={`/admin/${a.id}`} className="font-semibold text-regal hover:underline">
                  {a.name}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title="Delete account" hint="They can no longer sign in. Their activities stay, and only you can manage them afterwards.">
        <ConfirmDialog
          triggerLabel="Delete organizer"
          triggerClassName="btn btn-danger"
          title={`Delete ${organizer.name}?`}
          tone="danger"
          confirmLabel="Delete organizer"
          requireText={organizer.email}
          onConfirm={() => deleteOrganizer(organizer.id)}
        >
          {organizer.name} will be signed out and can&apos;t sign in again.{" "}
          {activities.length > 0
            ? `Their ${activities.length} ${activities.length === 1 ? "activity stays" : "activities stay"}, managed only by you.`
            : "They have no activities."}
        </ConfirmDialog>
      </Section>
    </div>
  );
}
