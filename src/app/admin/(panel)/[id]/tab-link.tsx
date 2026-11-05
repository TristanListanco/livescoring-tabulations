"use client";

import Link, { useLinkStatus } from "next/link";

/**
 * One of an activity's tabs: a branch of its tree in the sidebar, or (on phones and tablets, without the sidebar) a pill
 * in the row under its name. Opening a tab can take a moment (each reads the activity afresh), so the tab picked shows
 * it at once: it lights up with a bar running under it, and the panel dims until the new one arrives (see
 * .activity-tabs in globals.css).
 */
export function TabLink({ href, active, look, children }: { href: string; active: boolean; look: "tree" | "pill"; children: React.ReactNode }) {
  const shape =
    look === "tree"
      ? `flex h-9 items-center rounded-lg px-3 text-[15px] pointer-coarse:h-11 ${
          active ? "bg-white font-semibold text-prussian ring-1 ring-line" : "text-prussian/70 hover:bg-white/60 hover:text-prussian"
        }`
      : `block rounded-full px-4 py-1.5 text-[15px] font-semibold whitespace-nowrap pointer-coarse:py-2.5 ${
          active ? "bg-white text-prussian ring-1 ring-line" : "text-prussian/70 hover:text-prussian"
        }`;
  return (
    <Link
      href={href}
      scroll={false}
      aria-current={active ? "page" : undefined}
      className={`relative transition-colors has-[[data-tab-pending]]:text-regal ${shape}`}
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
    <span aria-hidden data-tab-pending={pending || undefined} className="tab-pending absolute inset-x-3 bottom-1 h-0.5 overflow-hidden rounded-full">
      <span className="tab-pending-run block h-full w-1/2 bg-regal" />
    </span>
  );
}
