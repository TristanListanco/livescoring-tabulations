import Link from "next/link";
import { describedBy, FieldProblem, problemId, useFieldProblems } from "../field-errors";

/** The consent box's field id, for a create form's problem to point at. */
export const CONSENT_ID = "consent";
/** What a create form says when it isn't ticked. */
export const CONSENT_PROBLEM = "Confirm you have the consent of the people named here.";

/** What an activity's creator confirms: the people they name in it agreed, as the terms ask. */
const NAMED_CONSENT = (
  <>
    I&apos;ve told the people named here how their names, photos and scores will be shown, and I have their consent (a parent&apos;s or
    guardian&apos;s for anyone under 18), as the{" "}
    <Link href="/terms" className="font-semibold text-regal underline underline-offset-2">
      terms
    </Link>{" "}
    ask.
  </>
);

/**
 * A form's consent, ticked before it's sent: by default, before an activity is created, that the organizer has the
 * consent of the people they name in it (judges, entries or candidates, and signatories, with a parent's or guardian's
 * for anyone under 18), as the terms ask. `children`: another statement. Asked on every send (a draft doesn't keep
 * it), and checked again on the server. Its problem shows when the form's FieldProblems has one for CONSENT_ID.
 */
export function ConsentField({ checked, onChange, children = NAMED_CONSENT }: { checked: boolean; onChange: (checked: boolean) => void; children?: React.ReactNode }) {
  const problems = useFieldProblems();
  const flagged = problems.has(CONSENT_ID);
  return (
    <div className="mt-6">
      {/*
        On the panel's wash, like a note to read before the button: a short lead, then the statement. The box is drawn
        to match: it fills navy and its tick draws itself as it's ticked (.tick-box), and a missing tick outlines it.
      */}
      <label
        className={`flex cursor-pointer items-start gap-3.5 rounded-[1.25rem] bg-wash px-5 py-4 transition-shadow ${
          flagged ? "ring-2 ring-danger/50" : checked ? "ring-1 ring-regal/35" : ""
        }`}
      >
        <span className="relative mt-0.5 grid size-[22px] shrink-0 place-items-center">
          <input
            id={CONSENT_ID}
            type="checkbox"
            name="consent"
            checked={checked}
            onChange={(e) => onChange(e.target.checked)}
            aria-describedby={describedBy(flagged && problemId(CONSENT_ID))}
            className={`tick-box absolute inset-0 size-full cursor-pointer appearance-none rounded-md border-2 bg-white transition-colors checked:border-regal checked:bg-regal ${
              flagged ? "border-danger" : "border-field"
            }`}
          />
          <svg viewBox="0 0 16 16" className="pointer-events-none relative size-3.5 text-mint" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path pathLength={1} d="M3.2 8.6l3 3 6.6-7.2" className={checked ? "" : "opacity-0"} />
          </svg>
        </span>
        <span className="min-w-0">
          <span className="block font-semibold">Consent</span>
          <span className="mt-1 block text-[15px] leading-relaxed text-prussian/80">{children}</span>
        </span>
      </label>
      <FieldProblem fieldId={CONSENT_ID} className="mt-2" />
    </div>
  );
}
