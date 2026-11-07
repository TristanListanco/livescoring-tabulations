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
    <div className="mt-6 max-w-2xl">
      <label className={`flex items-start gap-3 rounded-xl border px-4 py-3 ${flagged ? "border-danger ring-2 ring-danger/15" : "border-line bg-white"}`}>
        <input
          id={CONSENT_ID}
          type="checkbox"
          name="consent"
          checked={checked}
          onChange={(e) => onChange(e.target.checked)}
          aria-describedby={describedBy(flagged && problemId(CONSENT_ID))}
          className="mt-0.5 size-5 shrink-0 accent-regal"
        />
        <span className="text-[15px] leading-relaxed">{children}</span>
      </label>
      <FieldProblem fieldId={CONSENT_ID} className="mt-2" />
    </div>
  );
}
