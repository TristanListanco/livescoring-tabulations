"use client";

import Link, { useLinkStatus } from "next/link";

/**
 * One of an activity's tabs. Opening a tab can take a moment (each reads the activity afresh), so the tab picked shows
 * it at once: it lights up with a bar running under it, and the panel below dims until the new one arrives (see
 * .activity-tabs in globals.css).
 */
export function TabLink({ href, active, children }: { href: string; active: boolean; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      scroll={false}
      aria-current={active ? "page" : undefined}
      className={`relative -mb-px block border-b-2 px-2.5 py-3 text-[15px] font-semibold transition-colors sm:px-3 ${
        active ? "border-regal text-regal" : "border-transparent text-prussian/70 hover:text-prussian has-[[data-tab-pending]]:text-regal"
      }`}
    >
      {children}
      <Pending />
    </Link>
  );
}

/** While its tab is opening: a bar under it, and the mark the panel dims by. Always rendered, so nothing shifts. */
function Pending() {
  const { pending } = useLinkStatus();
  return (
    <span aria-hidden data-tab-pending={pending || undefined} className="tab-pending absolute inset-x-0 -bottom-0.5 h-0.5 overflow-hidden">
      <span className="tab-pending-run block h-full w-1/2 bg-regal" />
    </span>
  );
}
