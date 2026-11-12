"use client";

import { useActionState, useState, useTransition } from "react";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { SubmitButton } from "@/components/submit-button";
import { reach } from "@/lib/reach";
import type { ActionResult, Activity, Round, Signatory } from "@/lib/types";
import { editable, scoresGoOutLive } from "@/lib/lifecycle";
import { formatBound, rangeLabel } from "@/lib/scoring";
import { MAX_GUIDE } from "@/lib/scoring-rules";
import { deleteActivity, setActivityOption, setActivityOwner, setEventTimer, setLedOptions, setLiveScoring, setScoringPlaces, updateCriterionGuides, updateSettings, type FormResult } from "../../actions";
import { FormMessage } from "../form-message";
import { toastOnRedirect, toastSaved } from "../toaster";
import { Section } from "../section";
import { SignatoriesEditor } from "../signatories-editor";
import { Switch } from "../switch";
import { TestSiteTools } from "./developer-tab";
import { ResetScoresButton } from "./reset-scores";
import { ArchiveButton } from "../archive-controls";
import { DECIMAL_OPTIONS, RESULT_DECIMAL_OPTIONS } from "../scoring-fields";
import { RankingSwitch } from "./ranking-switch";
import { CriteriaTable, PageantScoring } from "./pageant-scoring";

/**
 * How the activity is scored, shown here. The method and range are fixed when it's created; the decimal places and an
 * event's timer can change until judging first starts (ScoringPlaces, EventTimer), then they're shown here too.
 */
function ScoringSummary({ activity }: { activity: Activity }) {
  const fixed = (n: number) => (n === 0 ? "Whole numbers" : `${n} decimal place${n > 1 ? "s" : ""}`);
  const open = editable(activity, "rules");
  // Rows for what can still change are left out: their own controls show them under the summary.
  const places = (n: number): React.ReactNode => (open ? null : fixed(n));
  const criteria = activity.scoringMode === "criteria";
  const timeLimit: [string, React.ReactNode][] = open ? [] : [["Time limit", activity.timerSeconds ? `${activity.timerSeconds} seconds per entry` : "None"]];
  const rows: [string, React.ReactNode][] = activity.kind === "pageant"
    ? [
        ["Method", "Pageant: each sub-activity has its own scoring, below"],
        ["Preliminary", `${formatBound(activity.preliminaryWeight)}% of the overall score`],
        ["Pageant proper", `${formatBound(100 - activity.preliminaryWeight)}% of the overall score`],
        ["Results show", places(activity.resultDecimals)],
      ]
    : criteria
    ? [
        ["Method", "Criteria"],
        [
          "Criteria",
          <CriteriaTable key="criteria" criteria={activity.criteria} />,
        ],
        ["Judges give points in", places(activity.decimals)],
        ["Totals shown", activity.criteriaDisplay === "ten" ? "Scaled to 10" : "As a percentage"],
        ["Results show", places(activity.resultDecimals)],
        ...timeLimit,
      ]
    : [
        ["Method", `Simple, scores from ${rangeLabel(activity)}`],
        ["Judges score with", places(activity.decimals)],
        ["Results show", places(activity.resultDecimals)],
        ...timeLimit,
      ];
  return (
    <dl className="grid max-w-2xl gap-x-8 gap-y-3 sm:grid-cols-[11rem_1fr]">
      {rows.filter(([, value]) => value !== null).map(([term, value]) => (
        <div key={term} className="contents">
          <dt className="font-semibold">{term}</dt>
          <dd className="text-prussian/80">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

/**
 * Until judging first starts, the decimal places judges score with (an event's: a pageant's sub-activities have their
 * own) and those its results show: the same choices as the create form. Saved together, with a toast.
 */
function ScoringPlaces({ activity }: { activity: Activity }) {
  const event = activity.kind === "event";
  const [decimals, setDecimals] = useState(activity.decimals);
  const [results, setResults] = useState(activity.resultDecimals);
  const [result, setResult] = useState<ActionResult | null>(null);
  const [pending, startTransition] = useTransition();
  const dirty = (event && decimals !== activity.decimals) || results !== activity.resultDecimals;
  const save = () =>
    startTransition(async () => {
      setResult(toastSaved(await reach(() => setScoringPlaces(activity.id, event ? decimals : null, results))));
    });
  const places = (n: number) => (n === 0 ? "Whole numbers" : `${n} decimal place${n > 1 ? "s" : ""}`);
  return (
    <div className="mt-6 space-y-5 border-t border-line pt-5">
      {event && (
        <fieldset>
          <legend className="label">{activity.scoringMode === "criteria" ? "Judges give points in" : "Judges score with"}</legend>
          <div className="flex flex-wrap gap-2">
            {DECIMAL_OPTIONS.map((o) => (
              <label key={o.value} className="choice items-center">
                <input type="radio" name="places-decimals" checked={decimals === o.value} onChange={() => setDecimals(o.value)} disabled={pending} />
                <span className="font-semibold whitespace-nowrap">{o.label}</span>
                <span className="tabular text-sm whitespace-nowrap opacity-75">e.g. {o.example}</span>
              </label>
            ))}
          </div>
        </fieldset>
      )}
      <fieldset>
        <legend className="label">Results show</legend>
        <div className="flex flex-wrap gap-2">
          {RESULT_DECIMAL_OPTIONS.map((n) => (
            <label key={n} className="choice items-center">
              <input type="radio" name="places-results" checked={results === n} onChange={() => setResults(n)} disabled={pending} />
              <span className="font-semibold whitespace-nowrap">{places(n)}</span>
              <span className="tabular text-sm whitespace-nowrap opacity-75">e.g. {(87.4567).toFixed(n)}</span>
            </label>
          ))}
        </div>
      </fieldset>
      <p className="hint">You can change these until the session starts.</p>
      {(dirty || (result && !result.ok)) && (
        <div className="flex flex-wrap items-center gap-3">
          {dirty && (
            <button type="button" className="btn btn-primary btn-sm" onClick={save} disabled={pending}>
              {pending ? "Saving…" : "Save decimal places"}
            </button>
          )}
          <FormMessage state={result?.ok ? null : result} small />
        </div>
      )}
    </div>
  );
}

/**
 * An event's scoring timer, until the session starts: off, or the seconds judges get for each entry shown. Saved on its
 * own (Save timer shows only once it's changed). After the start, the Scoring summary says what it was set to.
 */
function EventTimer({ activity }: { activity: Activity }) {
  const saved = activity.timerSeconds;
  const [value, setValue] = useState(saved ? String(saved) : "");
  const [result, setResult] = useState<ActionResult | null>(null);
  const [pending, startTransition] = useTransition();
  const seconds = value === "" ? null : Number(value);
  const save = () =>
    startTransition(async () => {
      setResult(toastSaved(await reach(() => setEventTimer(activity.id, seconds)), seconds === null ? "Time limit turned off" : `Time limit saved: ${seconds} seconds per entry`));
    });
  return (
    <div className="mt-6 border-t border-line pt-5">
      <label className="flex items-center gap-2.5 font-semibold">
        <input type="checkbox" className="size-5 shrink-0 accent-regal" checked={value !== ""} onChange={(e) => setValue(e.target.checked ? String(saved ?? 60) : "")} />
        Time limit for scoring
      </label>
      {value !== "" && (
        <div className="mt-2 ml-7.5 flex flex-wrap items-center gap-x-3 gap-y-2">
          <label htmlFor="timer" className="text-sm">
            Judges get<span className="sr-only"> this many seconds to score each entry</span>
          </label>
          <input
            id="timer"
            value={value}
            onChange={(e) => setValue(e.target.value.replace(/[^0-9]/g, "").replace(/^0+(?=\d)/, "").slice(0, 4) || "0")}
            inputMode="numeric"
            className="field tabular w-20"
          />
          <span className="text-sm">seconds per entry</span>
        </div>
      )}
      <p className="hint mt-2 ml-7.5">
        {activity.independentScoring && !activity.liveScoring
          ? "Judges scoring at their own pace have no timer: it runs only when you show entries one at a time."
          : "It starts as you show each entry. When it runs out, scoring closes until you give more time from the desk."}
      </p>
      <div className="mt-3 ml-7.5 flex flex-wrap items-center gap-3">
        {seconds !== saved && (
          <button type="button" className="btn btn-primary btn-sm" onClick={save} disabled={pending}>
            {pending ? "Saving…" : "Save timer"}
          </button>
        )}
        <FormMessage state={result?.ok ? null : result} small />
      </div>
    </div>
  );
}

/**
 * What judges should look for in each criterion, shown on their screen while they score it. Editable until judging
 * starts, so every entry is judged against the same guides; read-only after.
 */
function CriterionGuides({ activity }: { activity: Activity }) {
  const [state, action] = useActionState<FormResult, FormData>(
    async (previous, data) => toastSaved(await updateCriterionGuides(activity.id, previous, data), "Guides saved"),
    null,
  );
  if (activity.sessionState !== "draft") {
    return (
      <ul className="max-w-2xl space-y-4">
        {activity.criteria.map((c) => (
          <li key={c.id}>
            <p className="font-semibold">{c.name}</p>
            <p className={`mt-1 whitespace-pre-line ${c.guide ? "text-prussian/80" : "text-prussian/60"}`}>{c.guide ?? "No guide"}</p>
          </li>
        ))}
      </ul>
    );
  }
  return (
    <form action={action} className="max-w-2xl space-y-4">
      {activity.criteria.map((c) => (
        <div key={c.id}>
          <label htmlFor={`guide-${c.id}`} className="label">
            {c.name}
          </label>
          <textarea
            id={`guide-${c.id}`}
            name={`guide-${c.id}`}
            defaultValue={c.guide ?? ""}
            maxLength={MAX_GUIDE}
            rows={3}
            placeholder="Guide questions or what to look for"
            className="field min-h-20 resize-y py-2 leading-relaxed"
          />
        </div>
      ))}
      <div className="flex flex-wrap items-center gap-4">
        <SubmitButton>Save guides</SubmitButton>
        <FormMessage state={state?.ok ? null : state} />
      </div>
    </form>
  );
}

/** An event's live scoring: a switch until judging starts, then fixed (the switch stays, locked, to show which). */
function LiveScoring({ activity }: { activity: Activity }) {
  const [on, setOn] = useState(activity.liveScoring);
  const [result, setResult] = useState<ActionResult | null>(null);
  const [pending, startTransition] = useTransition();
  // Until judging starts, and not after a reset either: it's one of the rules judges scored by.
  const changeable = editable(activity, "rules");
  const toggle = () => {
    const next = !on;
    setOn(next);
    startTransition(async () => {
      // In the server's words, which say what follows (no chair, or one to choose).
      const r = toastSaved(await reach(() => setLiveScoring(activity.id, next)));
      setResult(r);
      if (!r.ok) setOn(!next);
    });
  };
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-4">
        <Switch checked={on} onChange={toggle} labelledBy="live-scoring-label" disabled={pending || !changeable} />
        <p id="live-scoring-label" className="font-semibold">
          Show scores live
        </p>
      </div>
      {/* Whether it can still change, said where it's switched: until the session starts, either way. */}
      <p className="hint pl-16">
        {on && "Only you move between entries, so there's no chair of judges. "}
        {changeable ? "You can turn this on or off until the session starts." : "Set for good once the session started."}
      </p>
      <FormMessage state={result?.ok ? null : result} small className="pl-16" />
    </div>
  );
}

/** One of the options for judges' screens (see setActivityOption), switched straight away; locked once it can't change. */
function OptionSwitch({
  activity,
  option,
  label,
  hint,
  editable,
}: {
  activity: Activity;
  /** The LED wall's two (with live scoring) save with its other settings; the rest are options for judges' screens. */
  option: "judgesSeeRanking" | "privacyScreen" | "correctionReasons" | "independentScoring" | "ledHoldScores" | "ledAnonymous";
  label: string;
  /** What it does, under it, when the label alone doesn't say. */
  hint?: string;
  editable: boolean;
}) {
  const [on, setOn] = useState(activity[option]);
  const [result, setResult] = useState<ActionResult | null>(null);
  const [pending, startTransition] = useTransition();
  const id = `${option}-label`;
  const save = (next: boolean) =>
    option === "ledHoldScores"
      ? setLedOptions(activity.id, { holdScores: next })
      : option === "ledAnonymous"
        ? setLedOptions(activity.id, { anonymous: next })
        : setActivityOption(activity.id, option, next);
  const toggle = () => {
    const next = !on;
    setOn(next);
    startTransition(async () => {
      const saved = await reach(() => save(next));
      // The server's words when it has some ("Judges see the ranking while they deliberate"), else the switch's own.
      const r = toastSaved(saved, saved.ok && saved.message ? undefined : `${label}: ${next ? "on" : "off"}`);
      setResult(r);
      if (!r.ok) setOn(!next);
    });
  };
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-4">
        <Switch checked={on} onChange={toggle} labelledBy={id} disabled={pending || !editable} />
        <p id={id} className="font-semibold">
          {label}
        </p>
      </div>
      {hint && <p className="hint pl-16">{hint}</p>}
      <FormMessage state={result?.ok ? null : result} small className="pl-16" />
    </div>
  );
}

type OrganizerOption = { id: string; name: string; email: string };

/**
 * What's done with the activity as a whole, on one line under its settings, straight on the page rather than in a card
 * of its own: archive it once judging has ended, and, at the far end, delete it (or a test site's tools). Out of a
 * card, its buttons take the firmer outline of .bare-actions.
 */
function ManageActivity({ children, end }: { children: React.ReactNode; end: React.ReactNode }) {
  return (
    <section aria-labelledby="manage-activity" className="bare-actions mt-8 flex flex-wrap items-start gap-3 border-t border-line pt-6">
      <h2 id="manage-activity" className="sr-only">
        Manage activity
      </h2>
      {children}
      <div className="flex flex-wrap items-center gap-3 sm:ml-auto">{end}</div>
    </section>
  );
}

/**
 * Super admin only: hand this activity to an organizer. Organizers' activities are private to them, so
 * the super admin can't open it afterwards.
 */
function OwnerPicker({ activity, organizers }: { activity: Activity; organizers: OrganizerOption[] }) {
  const [owner, setOwner] = useState("");
  const chosen = organizers.find((o) => o.id === owner);

  if (organizers.length === 0) return <p className="hint">No organizers yet.</p>;
  return (
    <div className="space-y-3">
      <label htmlFor="owner" className="sr-only">
        Organizer to hand this activity to
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
          onConfirm={() => toastOnRedirect(setActivityOwner(activity.id, owner), `${activity.name} handed to ${chosen?.name ?? "the organizer"}`)}
        >
          They&apos;ll manage it from their own admin panel. After this you&apos;ll only see its name in your list: you won&apos;t be able to open it,
          change it or export its results.
        </ConfirmDialog>
      </div>
    </div>
  );
}

export function SettingsTab({
  activity,
  rounds = [],
  organizers,
  developer = false,
  scoreCount = 0,
  segmentScores,
  archiveBlocked = null,
  signatories,
}: {
  activity: Activity;
  /** A pageant's sub-activities and parts, for their scoring. */
  rounds?: Round[];
  /** A pageant's scores so far in each segment, for resetting one of them. */
  segmentScores?: { preliminary: number; proper: number };
  /** The signature lines its results PDFs print. */
  signatories: Signatory[];
  /** Present for the super admin only. */
  organizers: OrganizerOption[] | null;
  /** A test site: scores can be reset, and the activity deleted even mid-session. */
  developer?: boolean;
  /** Scores submitted so far, for resetting them on a test site. */
  scoreCount?: number;
  /** Why its results can't be downloaded, which archiving makes permanent (see archiveBlocked in lifecycle.ts). */
  archiveBlocked?: string | null;
}) {
  const [state, action] = useActionState<FormResult, FormData>(
    async (previous, data) => toastSaved(await updateSettings(activity.id, previous, data), "Details saved"),
    null,
  );

  return (
    <div className="max-w-4xl">
      <form action={action}>
        <Section quiet title="Details">
          <label htmlFor="name" className="label">
            {activity.kind === "pageant" ? "Pageant name" : "Event name"}
          </label>
          <input id="name" name="name" required maxLength={120} defaultValue={activity.name} className="field max-w-xl" />
          <label htmlFor="location" className="label mt-5">
            Location <span className="font-normal text-prussian/70">(optional)</span>
          </label>
          <input
            id="location"
            name="location"
            maxLength={120}
            defaultValue={activity.location ?? ""}
            placeholder="e.g. Bldg 2, Room 204, 3rd floor"
            className="field max-w-xl"
          />
          <div className="mt-4 flex flex-wrap items-center gap-4">
            <SubmitButton>Save details</SubmitButton>
            <FormMessage state={state?.ok ? null : state} />
          </div>
        </Section>
      </form>

      <Section quiet title="Scoring">
        <ScoringSummary activity={activity} />
        {activity.kind === "pageant" && (
          <div className="mt-6 max-w-2xl border-t border-line pt-5">
            <PageantScoring rounds={rounds} />
          </div>
        )}
        {editable(activity, "rules") && <ScoringPlaces activity={activity} />}
        {activity.kind === "event" && editable(activity, "rules") && <EventTimer activity={activity} />}
      </Section>

      {/* How judging runs, in one list: each a switch, locked (and left showing which way it's set) once it can't change. */}
      <section aria-labelledby="judging-options" className="card mt-4 p-5 sm:p-7">
        <h2 id="judging-options" className="title-sm">
          {activity.kind === "pageant" ? "Pageant settings" : "Event settings"}
        </h2>
        <div className="mt-5 space-y-5">
          {activity.kind === "event" && <LiveScoring activity={activity} />}
          {/* How the live results page lists them: on unless turned off, and changeable through the show. */}
          <RankingSwitch activity={activity} editable={!activity.archivedAt} />
          {/* With live scores, what the audience's screens show of the judges (set here rather than on the LED wall tab). */}
          {scoresGoOutLive(activity) && (
            <>
              <OptionSwitch
                activity={activity}
                option="ledHoldScores"
                label="Show scores only when every judge has scored"
                hint="Until then, the LED wall shows that each judge has scored, not what."
                editable={!activity.archivedAt}
              />
              <OptionSwitch
                activity={activity}
                option="ledAnonymous"
                label="Keep judges anonymous"
                hint="A “?” for each judge on the LED wall, and Judge 1, Judge 2 on the live results."
                editable={!activity.archivedAt}
              />
            </>
          )}
          {activity.kind === "event" && !activity.liveScoring && (
            <>
              <OptionSwitch
                activity={activity}
                option="independentScoring"
                label="Judges score at their own pace"
                editable={editable(activity, "rules")}
              />
              <OptionSwitch
                activity={activity}
                option="correctionReasons"
                label="Judges pick a reason from a list when they correct a score"
                editable={activity.sessionState !== "ended"}
              />
              <OptionSwitch
                activity={activity}
                option="judgesSeeRanking"
                label="Judges see the overall ranking while they deliberate"
                editable={activity.sessionState !== "ended"}
              />
            </>
          )}
          <OptionSwitch activity={activity} option="privacyScreen" label="Privacy screen on judges' phones and tablets" editable={!activity.archivedAt} />
        </div>
      </section>

      {activity.kind === "event" && activity.scoringMode === "criteria" && (
        <Section quiet title="Guides for judges">
          <CriterionGuides activity={activity} />
        </Section>
      )}

      <Section quiet id="signatories" title="Results PDF signatories">
        <SignatoriesEditor activityId={activity.id} initial={signatories} />
      </Section>

      {organizers && (
        <Section quiet title="Organizer">
          <OwnerPicker activity={activity} organizers={organizers} />
        </Section>
      )}

      <ManageActivity
        end={
          <>
            {/* Judging can start over any time until it's archived: with something to reset, once it has started. */}
            {!activity.archivedAt && (!editable(activity, "judges") || scoreCount > 0) && <ResetScoresButton activity={activity} scoreCount={scoreCount} segmentScores={segmentScores} />}
            {developer ? (
            <TestSiteTools activity={activity} />
          ) : activity.sessionState === "live" || activity.sessionState === "deliberation" ? (
            <p role="note" className="hint">
              End the session to delete this activity.
            </p>
          ) : (
            <ConfirmDialog
              triggerLabel="Delete activity"
              triggerClassName="btn btn-danger-quiet"
              title="Delete this activity?"
              tone="danger"
              confirmLabel="Delete activity"
              requireText={activity.name}
              onConfirm={() => toastOnRedirect(deleteActivity(activity.id), `${activity.name} deleted`)}
            >
              This permanently deletes <strong>{activity.name}</strong> with its judges, entries, scores and photos. Judge codes and the live results
              link stop working.
            </ConfirmDialog>
          )}
          </>
        }
      >
        {activity.sessionState === "ended" && <ArchiveButton activityId={activity.id} name={activity.name} blocked={archiveBlocked} />}
      </ManageActivity>
    </div>
  );
}
