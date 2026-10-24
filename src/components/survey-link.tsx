import { SURVEY_URL } from "@/lib/survey";

/**
 * A link to the feedback survey, in a new tab so the page stays open behind it. No referrer: the survey is anonymous, so
 * it isn't told which activity or page the link was on. Nothing while there's no survey. Look from `className`.
 */
export function SurveyLink({ className = "", children = "Feedback survey" }: { className?: string; children?: React.ReactNode }) {
  if (!SURVEY_URL) return null;
  return (
    <a href={SURVEY_URL} target="_blank" rel="noreferrer" className={className}>
      {children}
      <span className="sr-only"> (opens in a new tab)</span>
    </a>
  );
}
