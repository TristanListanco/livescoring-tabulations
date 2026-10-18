"use client";

import { useSyncExternalStore } from "react";
import type { Activity } from "@/lib/types";
import type { LiveStatus } from "@/lib/use-live-refresh";
import { LiveStatusBadge } from "./live-status";

/**
 * Where a show stands, for the screens that follow it (the live results, the private tally): "Judging hasn't started"
 * before the session, the connection while judging is on, "Judges deliberating" while they deliberate, and "Ended",
 * with when, once judging has ended. A screen that has lost its connection says so whatever the show is doing.
 * `className` sets the text colour for the screen's theme.
 */
export function ShowStatus({
  activity,
  connection,
  className = "",
}: {
  activity: Pick<Activity, "sessionState" | "sessionEndedAt">;
  connection: LiveStatus;
  className?: string;
}) {
  if (activity.sessionState === "ended") return <EndedBadge endedAt={activity.sessionEndedAt} className={className} />;
  // Before the session, "Live" would promise scores that aren't coming yet.
  if (activity.sessionState === "draft" && connection !== "offline") {
    return (
      <p className={`inline-flex items-center gap-2 text-sm font-semibold ${className}`}>
        <span aria-hidden className="size-2.5 rounded-full border-2 border-powder" />
        Judging hasn&apos;t started
      </p>
    );
  }
  if (activity.sessionState === "deliberation") {
    return (
      <p className={`inline-flex items-center gap-2 text-sm font-semibold ${className}`}>
        <span aria-hidden className="size-2.5 rounded-full bg-powder" />
        Judges deliberating
      </p>
    );
  }
  return <LiveStatusBadge status={connection} className={className} />;
}

const endedFormat = new Intl.DateTimeFormat("en", { dateStyle: "medium", timeStyle: "short" });
const noSubscription = () => () => {};

/**
 * Once judging has ended, the results are final: "Ended", with when, in place of the connection's "Live". The time is
 * written on the viewer's device, in their time zone (the server's could differ), so the server render says "Ended".
 */
function EndedBadge({ endedAt, className }: { endedAt: string | null; className: string }) {
  const onDevice = useSyncExternalStore(
    noSubscription,
    () => true,
    () => false,
  );
  return (
    <p className={`inline-flex items-center gap-2 text-sm font-semibold ${className}`}>
      <span aria-hidden className="size-2.5 rounded-full bg-powder/60" />
      <span>
        Ended
        {endedAt && onDevice && (
          <>
            {" "}
            · <time dateTime={endedAt}>{endedFormat.format(new Date(endedAt))}</time>
          </>
        )}
      </span>
    </p>
  );
}
