"use client";

import Link, { useLinkStatus } from "next/link";

/**
 * One of an activity's tabs: a branch of its tree in the sidebar, or (without the sidebar's tree) a pill under its name.
 * Opening a tab can take a moment when it isn't cached, so the tab picked shows it at once: it lights up with a bar
 * running under it, and the panel dims until the new one arrives (see .activity-tabs in globals.css).
 */
export function TabLink({ href, active, look, children }: { href: string; active: boolean; look: "tree" | "pill"; children: React.ReactNode }) {
  const shape =
    look === "tree"
      ? // The open tab's mark sits on the tree's line, beside it.
        `flex h-9 items-center rounded-lg px-3 text-[15px] pointer-coarse:h-11 ${
          active
            ? "bg-white font-medium text-prussian shadow-[0_1px_2px_rgb(11_37_69/0.08)] before:absolute before:inset-y-2 before:-left-[0.8125rem] before:w-0.5 before:rounded-full before:bg-regal"
            : "text-prussian/70 hover:bg-white/60 hover:text-prussian"
        }`
      : // A cell of the phones' grid, filling it (a narrow phone shortens a long name rather than overflow); a pill wider.
        `flex h-9 items-center justify-center rounded-full px-2 text-[15px] font-semibold whitespace-nowrap pointer-coarse:h-11 md:px-4 ${
          active ? "bg-white text-prussian shadow-[0_1px_2px_rgb(11_37_69/0.08)]" : "text-prussian/70 hover:text-prussian"
        }`;
  return (
    <Link
      href={href}
      scroll={false}
      aria-current={active ? "page" : undefined}
      className={`relative transition-colors has-[[data-tab-pending]]:text-regal ${shape}`}
    >
      {look === "pill" ? <span className="min-w-0 truncate">{children}</span> : children}
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
