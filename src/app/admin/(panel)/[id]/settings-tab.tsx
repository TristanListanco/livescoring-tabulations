"use client";

import { useActionState, useState, useTransition } from "react";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { SubmitButton } from "@/components/submit-button";
import type { Activity, ActionResult } from "@/lib/types";
import { formatBound, rangeLabel } from "@/lib/scoring";
import { deleteActivity, setActivityOwner, setShowRank, updateSettings, type FormResult } from "../../actions";
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
      <div className="flex items-center gap-4">
        <button
          type="button"
          role="switch"
          aria-checked={on}
          aria-labelledby="rank-label"
          onClick={toggle}
          disabled={pending}
          className={`relative inline-flex h-7 w-12 shrink-0 items-center rounded-full border-2 transition-colors disabled:opacity-60 ${
            on ? "border-regal bg-regal" : "border-field bg-white"
          }`}
        >
          <span
            className={`inline-block size-5 rounded-full shadow transition-transform ${on ? "translate-x-5.5 bg-mint" : "translate-x-0.5 bg-field"}`}
          />
        </button>
        <p id="rank-label" className="font-semibold">
          Show ranks on the live results page
        </p>
      </div>
      {result && <Message state={result} />}
    </div>
  );
}

/** How the activity is scored. Fixed when it was created, so it's shown here, not edited. */
function ScoringSummary({ activity }: { activity: Activity }) {
  const places = (n: number) => (n === 0 ? "Whole numbers" : `${n} decimal place${n > 1 ? "s" : ""}`);
  const criteria = activity.scoringMode === "criteria";
  const rows: [string, React.ReactNode][] = criteria
    ? [
        ["Scoring", "Criteria"],
        [
          "Criteria",
          <table key="criteria" className="w-full max-w-sm text-left">
            <thead className="sr-only">
              <tr>
                <th scope="col">Criterion</th>
                <th scope="col">Max points</th>
              </tr>
            </thead>
            <tbody className="tabular">
              {activity.criteria.map((c) => (
                <tr key={c.id} className="border-b border-line">
                  <td className="py-1.5 pr-4">{c.name}</td>
                  <td className="py-1.5 text-right">{formatBound(c.max)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot className="tabular font-semibold text-prussian">
              <tr>
                <th scope="row" className="pt-1.5 pr-4 font-semibold">
                  Total
                </th>
                <td className="pt-1.5 text-right">100</td>
              </tr>
            </tfoot>
          </table>,
        ],
        ["Judges give points in", places(activity.decimals)],
        ["Totals shown", activity.criteriaDisplay === "ten" ? "Scaled to 10" : "As a percentage"],
        ["Results show", places(activity.resultDecimals)],
      ]
    : [
        ["Scoring", `Simple, scores from ${rangeLabel(activity)}`],
        ["Judges score with", places(activity.decimals)],
        ["Results show", places(activity.resultDecimals)],
      ];
  return (
    <dl className="grid max-w-2xl gap-x-8 gap-y-3 sm:grid-cols-[auto_1fr]">
      {rows.map(([term, value]) => (
        <div key={term} className="contents">
          <dt className="font-semibold">{term}</dt>
          <dd className="text-prussian/80">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

type OrganizerOption = { id: string; name: string; email: string };

/**
 * Super admin only: hand this activity to an organizer. Organizers' activities are private to them, so
 * the super admin can't open it afterwards.
 */
function OwnerPicker({ activity, organizers }: { activity: Activity; organizers: OrganizerOption[] }) {
  const [owner, setOwner] = useState("");
  const chosen = organizers.find((o) => o.id === owner);

  if (organizers.length === 0) return <p className="hint">Create organizer accounts on the Organizers page to hand activities over.</p>;
  return (
    <div className="space-y-3">
      <label htmlFor="owner" className="label">
        Organizer
      </label>
      <div className="flex max-w-xl flex-wrap gap-2">
        <select id="owner" value={owner} onChange={(e) => setOwner(e.target.value)} className="field max-w-sm flex-1">
          <option value="">Choose an organizer</option>
          {organizers.map((o) => (
            <option key={o.id} value={o.id}>
              {o.name} ({o.email})
            </option>
          ))}
        </select>
        <ConfirmDialog
          triggerLabel="Hand over"
          triggerClassName="btn btn-quiet"
          triggerDisabled={!chosen}
          title={`Hand ${activity.name} to ${chosen?.name ?? "this organizer"}?`}
          confirmLabel="Hand over"
          onConfirm={() => setActivityOwner(activity.id, owner)}
        >
          They&apos;ll manage it from their own admin panel. After this you&apos;ll only see its name in your list: you won&apos;t be able to open it,
          change it or export its results.
        </ConfirmDialog>
      </div>
    </div>
  );
}

function ExportResults({
  activityId,
  progress,
  reportId,
}: {
  activityId: string;
  progress: { submitted: number; possible: number; complete: boolean };
  reportId: string;
}) {
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
        <>
          <p className="text-[15px]">
            Report ID <span className="tabular font-bold tracking-wide">{reportId}</span>
          </p>
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
        </>
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
  progress,
  reportId,
  organizers,
}: {
  activity: Activity;
  progress: { submitted: number; possible: number; complete: boolean };
  reportId: string;
  /** Present for the super admin only. */
  organizers: OrganizerOption[] | null;
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
          <div className="mt-4 flex flex-wrap items-center gap-4">
            <SubmitButton>Save name</SubmitButton>
            <Message state={state} />
          </div>
        </Section>
      </form>

      <Section title="Scoring">
        <ScoringSummary activity={activity} />
      </Section>

      {organizers && (
        <Section title="Organizer">
          <OwnerPicker activity={activity} organizers={organizers} />
        </Section>
      )}

      <Section title="Live results page">
        <div className="space-y-6">
          <RankingSwitch activity={activity} />
        </div>
      </Section>

      <Section title="Export">
        <ExportResults activityId={activity.id} progress={progress} reportId={reportId} />
      </Section>

      <Section title="Delete activity">
        <ConfirmDialog
          triggerLabel="Delete activity"
          triggerClassName="btn btn-danger"
          title="Delete this activity?"
          tone="danger"
          confirmLabel="Delete activity"
          requireText={activity.name}
          onConfirm={() => deleteActivity(activity.id)}
        >
          This permanently deletes {activity.name} with its judges, entries, scores and photos. Judge codes and the live results link stop working.
        </ConfirmDialog>
      </Section>
    </div>
  );
}
