"use client";

import { useActionState, useState, useTransition } from "react";
import { SubmitButton } from "@/components/submit-button";
import type { Activity, ActionResult } from "@/lib/types";
import { setShowRank, updateSettings, type FormResult } from "../../actions";
import { RulesFields } from "../rules-fields";
import { Section } from "../section";

function Message({ state }: { state: FormResult }) {
  if (!state) return null;
  return (
    <p role={state.ok ? "status" : "alert"} className={state.ok ? "text-regal" : "font-semibold text-danger"}>
      {state.ok ? state.message : state.error}
    </p>
  );
}

function RankingSwitch({ activity }: { activity: Activity }) {
  const [on, setOn] = useState(activity.showRank);
  const [result, setResult] = useState<ActionResult | null>(null);
  const [pending, startTransition] = useTransition();

  const toggle = () => {
    const next = !on;
    setOn(next);
    startTransition(async () => {
      const r = await setShowRank(activity.id, next);
      setResult(r);
      if (!r.ok) setOn(!next);
    });
  };

  return (
    <div className="space-y-3">
      <div className="flex items-start gap-4">
        <button
          type="button"
          role="switch"
          aria-checked={on}
          aria-labelledby="rank-label"
          aria-describedby="rank-hint"
          onClick={toggle}
          disabled={pending}
          className={`relative mt-0.5 inline-flex h-7 w-12 shrink-0 items-center rounded-full border-2 transition-colors disabled:opacity-60 ${
            on ? "border-regal bg-regal" : "border-field bg-white"
          }`}
        >
          <span className={`inline-block size-5 rounded-full shadow transition-transform ${on ? "translate-x-5.5 bg-mint" : "translate-x-0.5 bg-field"}`} />
        </button>
        <div>
          <p id="rank-label" className="font-semibold">
            Show ranks on the live results page
          </p>
          <p id="rank-hint" className="hint mt-0.5 max-w-xl">
            {on
              ? "Entries are sorted by average, numbered by placement, and the top 3 stand out."
              : "Entries stay in their running order with no placements, so the audience sees scores without the standings."}{" "}
            The change shows on every open results screen within seconds.
          </p>
        </div>
      </div>
      {result && <Message state={result} />}
    </div>
  );
}

function ExportResults({ activityId, progress }: { activityId: string; progress: { submitted: number; possible: number; complete: boolean } }) {
  const percent = progress.possible ? Math.round((progress.submitted / progress.possible) * 100) : 0;
  const href = () => `/admin/${activityId}/export?tz=${encodeURIComponent(Intl.DateTimeFormat().resolvedOptions().timeZone)}`;

  return (
    <div className="space-y-4">
      <div className="max-w-md">
        <div className="flex items-baseline justify-between text-sm">
          <span className="font-semibold">Scores in</span>
          <span className="tabular hint">
            {progress.submitted} of {progress.possible}
          </span>
        </div>
        <div
          className="mt-1.5 h-2 overflow-hidden rounded-full bg-wash"
          role="progressbar"
          aria-label="Scores in"
          aria-valuemin={0}
          aria-valuemax={progress.possible}
          aria-valuenow={progress.submitted}
        >
          <div className="h-full rounded-full bg-regal transition-[width]" style={{ width: `${percent}%` }} />
        </div>
      </div>
      {progress.complete ? (
        <a
          href={`/admin/${activityId}/export`}
          onClick={(e) => {
            e.currentTarget.href = href();
          }}
          className="btn btn-primary"
          download
        >
          Download results PDF
        </a>
      ) : (
        <>
          <button type="button" className="btn btn-primary" disabled>
            Download results PDF
          </button>
          <p className="hint">
            {progress.possible === 0
              ? "Add judges and entries first."
              : `Available once every judge has scored every entry. ${progress.possible - progress.submitted} still to come.`}
          </p>
        </>
      )}
    </div>
  );
}

export function SettingsTab({
  activity,
  hasScores,
  progress,
}: {
  activity: Activity;
  hasScores: boolean;
  progress: { submitted: number; possible: number; complete: boolean };
}) {
  const [state, action] = useActionState<FormResult, FormData>(updateSettings.bind(null, activity.id), null);

  return (
    <div className="max-w-4xl">
      <form action={action}>
        <Section title="Details" flush>
          <label htmlFor="name" className="label">
            Activity name
          </label>
          <input id="name" name="name" required maxLength={120} defaultValue={activity.name} className="field max-w-xl" />
        </Section>

        <Section
          title="Scoring"
          hint={hasScores ? "Locked while scores exist. Reset scores in the Developer tab to change it." : "Judges can only submit scores inside this range."}
        >
          {hasScores && (
            <>
              {/* Disabled fields aren't submitted, so send the current values instead. */}
              <input type="hidden" name="min" value={activity.min} />
              <input type="hidden" name="max" value={activity.max} />
              <input type="hidden" name="decimals" value={activity.decimals} />
            </>
          )}
          <RulesFields min={activity.min} max={activity.max} decimals={activity.decimals} locked={hasScores} />
        </Section>
        <div className="flex flex-wrap items-center gap-4 pb-8 md:pl-[calc(14rem+2.5rem)]">
          <SubmitButton>Save name and scoring</SubmitButton>
          <Message state={state} />
        </div>
      </form>

      <Section title="Live results page" hint="What the audience sees on the public link.">
        <RankingSwitch activity={activity} />
      </Section>

      <Section title="Export" hint="An official results sheet with every judge's score, averages, ranks and signature lines.">
        <ExportResults activityId={activity.id} progress={progress} />
      </Section>
    </div>
  );
}
