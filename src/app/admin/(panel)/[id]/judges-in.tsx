import Link from "next/link";
import { TallyGate } from "@/components/brand";
import type { startReady } from "@/lib/judging";

type Ready = NonNullable<ReturnType<typeof startReady>> | { what: "break"; paired: number; count: number };

/** Who's in, what starts, and where the button goes: the Session tab, with that start asked. */
function wording(ready: Ready): { heading: string; line: string; button: string; start: string | null } {
  // The break between a pageant's segments, pageant proper's judges still pairing: the way back to the desk.
  if (ready.what === "break") {
    return {
      heading: "The preliminary has ended",
      line: `${ready.paired} of ${ready.count} of pageant proper's judges have an approved device. Approve the rest, then start pageant proper, from the Session tab.`,
      button: "Go to the Session tab",
      start: null,
    };
  }
  const { what, count } = ready;
  if (what === "proper") {
    return {
      heading: count === 1 ? "Pageant proper's judge is in" : `Pageant proper's ${count === 2 ? "two" : count} judges are in`,
      line: "Every device is approved and waiting. Start pageant proper when you're ready.",
      button: "Start pageant proper",
      start: "proper",
    };
  }
  const who = what === "preliminary" ? "preliminary " : "";
  return {
    heading: count === 1 ? `The ${who}judge is in` : count === 2 ? `Both ${who}judges are in` : `All ${count} ${who}judges are in`,
    line: `Every device is approved and waiting. Start the ${what === "preliminary" ? "preliminary" : "session"} when you're ready.`,
    button: what === "preliminary" ? "Start preliminary" : "Start session",
    start: "1",
  };
}

/**
 * Once every judge a start opens screens for has an approved device (see startReady): an event's session, a pageant's
 * preliminary, or pageant proper in the break. Said on whichever of the activity's tabs the organizer is on, other than
 * the Session tab, whose desk already says so. The tally mark counts them in as it appears, and its one button goes to
 * the Session tab with that start asked. In the break it shows anyway, while pageant proper's judges are still pairing,
 * as the way back to the desk.
 */
export function JudgesIn({ activityId, ready }: { activityId: string; ready: Ready }) {
  const { heading, line, button, start } = wording(ready);
  return (
    <section
      aria-labelledby="judges-in"
      className="judges-in keep-light mt-6 flex max-w-4xl flex-wrap items-center gap-x-5 gap-y-4 rounded-[1.25rem] bg-prussian px-5 py-4 text-mint sm:px-6"
    >
      <TallyGate className="size-11 shrink-0" strokes="text-powder" slash="text-mint" />
      <div className="min-w-0 flex-1 basis-60">
        <h2 id="judges-in" className="text-xl leading-snug font-light tracking-[-0.015em]">
          {heading}
        </h2>
        <p className="mt-0.5 text-[15px] text-powder">{line}</p>
      </div>
      <Link
        href={`/admin/${activityId}?tab=session${start ? `&start=${start}` : ""}`}
        className="btn shrink-0 bg-mint text-prussian hover:bg-white max-sm:w-full"
      >
        {button}
        <svg viewBox="0 0 16 16" className="size-4" aria-hidden>
          <path d="M3 8h9.5M8.5 4l4 4-4 4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </Link>
    </section>
  );
}
