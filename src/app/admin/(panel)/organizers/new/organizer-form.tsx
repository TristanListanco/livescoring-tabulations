"use client";

import Link from "next/link";
import { useActionState, useState, useTransition, type FormEvent } from "react";
import { PhotoPicker } from "@/components/photo-picker";
import { FieldProblemsProvider } from "../../field-errors";
import { CONSENT_ID, ConsentField } from "../../new/consent-field";
import { createOrganizer } from "../../../account-actions";
import type { FormResult } from "../../../actions";
import { PasswordField } from "../../password-field";
import { Section } from "../../section";

export function OrganizerForm() {
  const [state, dispatch] = useActionState<FormResult, FormData>(createOrganizer, null);
  const [pending, startTransition] = useTransition();
  const [name, setName] = useState("");
  const [photo, setPhoto] = useState<{ blob: Blob; url: string } | null>(null);
  // The organizer's own say-so for their account, confirmed before it's made; said at the box, not in the browser's words.
  const [consent, setConsent] = useState(false);
  const [asked, setAsked] = useState(false);
  const problems = new Map(asked && !consent ? [[CONSENT_ID, "Confirm the organizer agreed to this account."]] : []);

  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!consent) {
      setAsked(true);
      document.getElementById(CONSENT_ID)?.focus();
      return;
    }
    const data = new FormData(e.currentTarget);
    if (photo) data.set("photo", photo.blob, "photo.jpg");
    startTransition(() => dispatch(data));
  };
  const error = state && !state.ok ? state.error : null;

  return (
    <form onSubmit={submit} className="mt-6 max-w-4xl">
      <Section title="Organizer">
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
        <PasswordField label="Password" />
      </Section>

      <FieldProblemsProvider value={problems}>
        <ConsentField checked={consent} onChange={setConsent}>
          The organizer asked for this account, and agreed to the{" "}
          <Link href="/terms" className="font-semibold text-regal underline underline-offset-2">
            terms
          </Link>{" "}
          and the{" "}
          <Link href="/privacy" className="font-semibold text-regal underline underline-offset-2">
            privacy policy
          </Link>
          , which say what&apos;s kept about them.
        </ConsentField>
      </FieldProblemsProvider>

      <div className="mt-6 flex flex-wrap items-center gap-4">
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
