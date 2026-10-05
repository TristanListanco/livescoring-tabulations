import type { LiveStatus } from "@/lib/use-live-refresh";

const COPY: Record<LiveStatus, string> = {
  live: "Live",
  connecting: "Connecting",
  polling: "Updating automatically",
  offline: "Offline",
};

/**
 * The connection as a dot and a word. Screen readers hear the state's name once, when the connection changes;
 * the visible text can say more (`detail`, like "Updated 12 seconds ago") and change as often as it likes
 * without being read out again.
 *
 * `compact` shows only the dot on small screens. `labels` renames states where "Live" would mean something
 * else, like the admin's desk, where the session itself is live.
 */
export function LiveStatusBadge({
  status,
  className = "",
  compact = false,
  labels,
  detail,
}: {
  status: LiveStatus;
  className?: string;
  compact?: boolean;
  labels?: Partial<Record<LiveStatus, string>>;
  /** Shown instead of the state's name, but never announced. */
  detail?: string;
}) {
  const name = labels?.[status] ?? COPY[status];
  return (
    <span className={`inline-flex items-center gap-2 text-sm font-semibold ${className}`}>
      <span role="status" className="sr-only">
        {name}
      </span>
      <span aria-hidden className="relative flex size-2.5">
        {status === "live" && (
          <span className="absolute inline-flex size-full animate-ping rounded-full bg-powder opacity-60 motion-reduce:hidden" />
        )}
        <span
          className={`relative inline-flex size-2.5 rounded-full ${
            status === "live" ? "bg-powder" : status === "offline" ? "bg-danger-soft" : "bg-powder/40"
          }`}
        />
      </span>
      <span aria-hidden className={compact ? "hidden sm:inline" : undefined}>
        {detail ?? name}
      </span>
    </span>
  );
}
