"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const LINKS = [
  { href: "/admin", label: "Activities" },
  { href: "/admin/organizers", label: "Organizers" },
] as const;

/** The super admin's sections. Activities also covers each activity's pages; Organizers covers each account's. */
export function AdminNav() {
  const pathname = usePathname();
  const section = pathname.startsWith("/admin/organizers") ? "/admin/organizers" : "/admin";

  return (
    <nav aria-label="Admin" className="order-last -ml-2.5 flex w-full items-center gap-1 text-sm font-semibold sm:order-none sm:ml-0 sm:w-auto">
      {LINKS.map((link) => {
        const active = link.href === section;
        return (
          <Link
            key={link.href}
            href={link.href}
            aria-current={active ? (pathname === link.href ? "page" : "true") : undefined}
            className={`rounded-md px-2.5 py-1.5 pointer-coarse:py-3 ${active ? "bg-oxford text-mint" : "text-powder hover:bg-oxford hover:text-mint"}`}
          >
            {link.label}
          </Link>
        );
      })}
    </nav>
  );
}
