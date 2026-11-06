import Link from "next/link";

/**
 * The way back to the page this one sits under (a form, an activity, an account): above its title at every width, so
 * leaving never means hunting for it in the sidebar. A form with unsaved changes still asks first (see LeaveGuard).
 */
export function BackLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link href={href} className="text-action inline-flex items-center gap-1">
      <svg viewBox="0 0 16 16" className="-ml-1 size-4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <path d="M10 3.5 5.5 8l4.5 4.5" />
      </svg>
      {children}
    </Link>
  );
}
