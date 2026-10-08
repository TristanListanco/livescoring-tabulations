"use client";

import { useState } from "react";
import type { ActivityKind } from "@/lib/types";
import { ActivityForm } from "./activity-form";
import { PageantForm } from "./pageant-form";

const KINDS: { value: ActivityKind; label: string; hint: string }[] = [
  { value: "event", label: "Event", hint: "One round of judging. Every judge scores every entry." },
  {
    value: "pageant",
    label: "Pageant",
    hint: "Candidates go through a preliminary and pageant proper, each with its own sub-activities, and cuts down to the winners.",
  },
];

/** A new activity: an event, or a pageant set up step by step. */
export function NewActivity() {
  const [kind, setKind] = useState<ActivityKind>("event");
  return (
    <>
      <fieldset className="mt-6 max-w-3xl">
        <legend className="label">What are you scoring?</legend>
        <div className="grid gap-2 sm:grid-cols-2">
          {KINDS.map((k) => (
            <label key={k.value} className="choice">
              <input type="radio" name="activity-kind" className="mt-1" checked={kind === k.value} onChange={() => setKind(k.value)} />
              <span>
                <span className="block font-semibold">{k.label}</span>
                <span className="block text-sm opacity-80">{k.hint}</span>
              </span>
            </label>
          ))}
        </div>
      </fieldset>
      {kind === "event" ? <ActivityForm /> : <PageantForm />}
    </>
  );
}
