import Link from "next/link";
import { TallyGate } from "@/components/brand";

/**
 * Before the session starts, once every judge's device is approved (each judge is on their screen, waiting to start):
 * said on whichever of the activity's tabs the organizer is on, other than the Session tab, whose desk already says so.
 * The tally mark counts them in as it appears, and its one button goes to the Session tab with Start session asked.
 */
export function JudgesIn({ activityId, count }: { activityId: string; count: number }) {
  return (
    <section
      aria-labelledby="judges-in"
      className="judges-in keep-light mt-6 flex max-w-4xl flex-wrap items-center gap-x-5 gap-y-4 rounded-[1.25rem] bg-prussian px-5 py-4 text-mint sm:px-6"
    >
      <TallyGate className="size-11 shrink-0" strokes="text-powder" slash="text-mint" />
      <div className="min-w-0 flex-1 basis-60">
        <h2 id="judges-in" className="text-xl leading-snug font-light tracking-[-0.015em]">
          {count === 1 ? "The judge is in" : count === 2 ? "Both judges are in" : `All ${count} judges are in`}
        </h2>
        <p className="mt-0.5 text-[15px] text-powder">Every device is approved and waiting. Start the session when you&apos;re ready.</p>
      </div>
      <Link href={`/admin/${activityId}?tab=session&start=1`} className="btn shrink-0 bg-mint text-prussian hover:bg-white max-sm:w-full">
        Start session
        <svg viewBox="0 0 16 16" className="size-4" aria-hidden>
          <path d="M3 8h9.5M8.5 4l4 4-4 4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </Link>
    </section>
  );
}
