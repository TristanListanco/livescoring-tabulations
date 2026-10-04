"use client";

import { useActionState, useState, useTransition, type FormEvent } from "react";
import { PhotoPicker } from "@/components/photo-picker";
import { MIN_PASSWORD_LENGTH } from "@/lib/password-rules";
import { createOrganizer } from "../../../account-actions";
import type { FormResult } from "../../../actions";
import { Section } from "../../section";

export function OrganizerForm() {
  const [state, dispatch] = useActionState<FormResult, FormData>(createOrganizer, null);
  const [pending, startTransition] = useTransition();
  const [name, setName] = useState("");
  const [photo, setPhoto] = useState<{ blob: Blob; url: string } | null>(null);

  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const data = new FormData(e.currentTarget);
    if (photo) data.set("photo", photo.blob, "photo.jpg");
    startTransition(() => dispatch(data));
  };
  const error = state && !state.ok ? state.error : null;

  return (
    <form onSubmit={submit} className="mt-6 max-w-4xl">
      <Section title="Organizer" flush>
        <div className="flex flex-wrap items-start gap-6">
          <PhotoPicker name={name} currentUrl={photo?.url ?? null} size={80} onPick={(blob, url) => setPhoto({ blob, url })} />
          <div className="min-w-64 flex-1 space-y-4">
            <div>
              <label htmlFor="name" className="label">
                Organizer name
              </label>
              <input
                id="name"
                name="name"
                required
                maxLength={120}
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="field max-w-md"
              />
            </div>
            <div>
              <label htmlFor="email" className="label">
                Email
              </label>
              <input id="email" name="email" type="email" required autoComplete="off" className="field max-w-md" />
            </div>
          </div>
        </div>
      </Section>

      <Section title="Password">
        <label htmlFor="password" className="label">
          Password
        </label>
        <input
          id="password"
          name="password"
          type="password"
          required
          minLength={MIN_PASSWORD_LENGTH}
          autoComplete="new-password"
          className="field max-w-md"
          aria-describedby="password-hint"
        />
        <p id="password-hint" className="hint mt-1.5">
          At least {MIN_PASSWORD_LENGTH} characters.
        </p>
      </Section>

      <div className="flex flex-wrap items-center gap-4 border-t border-line pt-6">
        <button type="submit" className="btn btn-primary" disabled={pending}>
          {pending ? "Creating…" : "Create organizer"}
        </button>
        {error && (
          <p role="alert" className="font-semibold text-danger">
            {error}
          </p>
        )}
      </div>
    </form>
  );
}
