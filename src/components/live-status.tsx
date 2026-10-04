import type { LiveStatus } from "@/lib/use-live-refresh";

const COPY: Record<LiveStatus, string> = {
  live: "Live",
  connecting: "Connecting",
  polling: "Updating automatically",
  offline: "Offline",
};

/** `compact` shows only the dot on small screens; the label stays available to screen readers. */
export function LiveStatusBadge({ status, className = "", compact = false }: { status: LiveStatus; className?: string; compact?: boolean }) {
  return (
    <span role="status" className={`inline-flex items-center gap-2 text-sm font-semibold ${className}`}>
      <span className="relative flex size-2.5">
        {status === "live" && (
          <span className="absolute inline-flex size-full animate-ping rounded-full bg-powder opacity-60 motion-reduce:hidden" />
        )}
        <span
          className={`relative inline-flex size-2.5 rounded-full ${
            status === "live" ? "bg-powder" : status === "offline" ? "bg-[#f4b4ae]" : "bg-powder/40"
          }`}
        />
      </span>
      <span className={compact ? "sr-only sm:not-sr-only" : undefined}>{COPY[status]}</span>
    </span>
  );
}
