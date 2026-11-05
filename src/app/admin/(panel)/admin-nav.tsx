"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { SIDEBAR_IDLE, SIDEBAR_OPEN, SIDEBAR_ROW } from "./sidebar-styles";

const ICONS = {
  activities: <path d="M4.5 3.5h11a1 1 0 011 1v11a1 1 0 01-1 1h-11a1 1 0 01-1-1v-11a1 1 0 011-1zM7 8h6M7 11.5h4" />,
  organizers: (
    <>
      <circle cx="8" cy="7" r="2.75" />
      <path d="M3 16c.5-2.6 2.4-4.1 5-4.1s4.5 1.5 5 4.1M13.2 4.6a2.5 2.5 0 010 4.8M14.8 12.2c1.3.5 2.1 1.7 2.4 3.6" />
    </>
  ),
};

/**
 * The sidebar's sections: Activities (with the open activity's tabs under it, `children`), the archived ones
 * (`archived`) and, for the super admin, Organizers. Activities also covers each activity's pages; Organizers covers
 * each account's.
 */
export function AdminNav({ isSuper, archived, children }: { isSuper: boolean; archived: React.ReactNode; children?: React.ReactNode }) {
  const pathname = usePathname();
  const section = pathname.startsWith("/admin/organizers") ? "organizers" : pathname.startsWith("/admin/profile") ? null : "activities";
  const link = (href: string, id: keyof typeof ICONS, label: string) => {
    const active = section === id;
    return (
      <Link
        href={href}
        aria-current={active ? (pathname === href ? "page" : "true") : undefined}
        title={label}
        className={`${SIDEBAR_ROW} ${active ? SIDEBAR_OPEN : SIDEBAR_IDLE}`}
      >
        <svg viewBox="0 0 20 20" className="size-5 shrink-0" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          {ICONS[id]}
        </svg>
        <span className="sidebar-label">{label}</span>
      </Link>
    );
  };

  return (
    <nav aria-label="Admin" className="flex flex-col gap-1">
      {link("/admin", "activities", "Activities")}
      {children}
      {archived}
      {isSuper && link("/admin/organizers", "organizers", "Organizers")}
    </nav>
  );
}
