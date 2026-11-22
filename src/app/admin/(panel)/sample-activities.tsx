"use client";

import { useState } from "react";
import { SubmitButton } from "@/components/submit-button";
import type { SampleKind } from "@/lib/sample-activity";
import type { ActionResult } from "@/lib/types";
import { createSample } from "../actions";
import { FormMessage } from "./form-message";
import { toastOnRedirect } from "./toaster";

/**
 * On a test site only, under the activities: a sample event or pageant made in one click, with made-up judges and
 * entries and nothing scored yet, to try things out on. It opens once it's made.
 */
export function SampleActivities() {
  const [result, setResult] = useState<ActionResult | null>(null);
  const make = (kind: SampleKind) => async () => {
    setResult(null);
    setResult(await toastOnRedirect(createSample(kind), `Sample ${kind} created`));
  };
  return (
    <section aria-labelledby="samples" className="mt-10">
      <h2 id="samples" className="title-sm">
        Sample data
      </h2>
      <p className="hint mt-1 max-w-[65ch]">
        Test site only. An event scored live by criteria (3 judges, 6 teams), or a pageant with its whole program by criteria (5 judges, 8 candidates).
      </p>
      <div className="mt-4 flex flex-wrap gap-3">
        <form action={make("event")}>
          <SubmitButton className="btn btn-quiet" pendingLabel="Creating…">
            Sample event
          </SubmitButton>
        </form>
        <form action={make("pageant")}>
          <SubmitButton className="btn btn-quiet" pendingLabel="Creating…">
            Sample pageant
          </SubmitButton>
        </form>
      </div>
      <FormMessage state={result} className="mt-2" />
    </section>
  );
}
