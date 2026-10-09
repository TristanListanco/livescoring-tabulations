"use client";

import { useRef, useState } from "react";
import type { ActivityKind } from "@/lib/types";
import { useLeaveGuard } from "../leave-guard";
import { ActivityForm } from "./activity-form";
import { PageantForm } from "./pageant-form";
import type { OpenedDraft } from "./use-draft";

const KINDS: { value: ActivityKind; label: string; hint: string }[] = [
  { value: "event", label: "Event", hint: "One round of judging. Every judge scores every entry." },
  {
    value: "pageant",
    label: "Pageant",
    hint: "Candidates go through a preliminary and pageant proper, each with its own sub-activities, and cuts down to the winners.",
  },
];

/**
 * A new activity: an event, or a pageant set up step by step. Either can be saved as a draft and continued later,
 * and leaving with unsaved changes asks first (see useLeaveGuard).
 */
export function NewActivity({ draft, missingDraft }: { draft: (OpenedDraft & { kind: ActivityKind }) | null; missingDraft: boolean }) {
  const [kind, setKind] = useState<ActivityKind>(draft?.kind ?? "event");
  const [dirty, setDirty] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);
  const saveRef = useRef<() => Promise<boolean>>(async () => false);
  const guard = useLeaveGuard({ dirty, form: formRef, save: () => saveRef.current() });
  // The draft belongs to the form of its own kind; switching to the other kind starts that one blank.
  const opened = draft?.kind === kind ? draft : null;

  return (
    <>
      {missingDraft && (
        <p role="note" className="note mt-6 max-w-3xl">
          That draft isn&apos;t here anymore. It may have been deleted, or used to create its activity.
        </p>
      )}
      <fieldset className="mt-6 max-w-3xl">
        <legend className="label">What are you scoring?</legend>
        <div className="grid gap-2 sm:grid-cols-2">
          {KINDS.map((k) => (
            <label key={k.value} className="choice">
              <input
                type="radio"
                name="activity-kind"
                className="mt-1"
                checked={kind === k.value}
                // Switching starts the other form blank, so unsaved changes here ask first.
                onChange={() =>
                  guard.confirm(() => {
                    setDirty(false);
                    setKind(k.value);
                  })
                }
              />
              <span>
                <span className="block font-semibold">{k.label}</span>
                <span className="block text-sm opacity-80">{k.hint}</span>
              </span>
            </label>
          ))}
        </div>
      </fieldset>
      {kind === "event" ? (
        <ActivityForm draft={opened} onDirty={setDirty} formRef={formRef} saveRef={saveRef} />
      ) : (
        <PageantForm draft={opened} onDirty={setDirty} formRef={formRef} saveRef={saveRef} />
      )}
      {guard.dialog}
    </>
  );
}
