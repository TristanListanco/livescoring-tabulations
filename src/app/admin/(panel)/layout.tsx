import { cookies } from "next/headers";
import Link from "next/link";
import { Avatar } from "@/components/avatar";
import { TallyMark } from "@/components/brand";
import { LegalLinks } from "@/components/legal-links";
import { requireAdmin } from "@/lib/session";
import { logout } from "../actions";
import { SIDEBAR_COOKIE, THEME_COOKIE } from "@/lib/theme";
import { AdminNav } from "./admin-nav";
import { ArchivedNav } from "./archived-nav";
import { AssistanceAlerts } from "./assistance-alerts";
import { SidebarDrawer } from "./sidebar-drawer";
import { CollapseToggle, SidebarShell } from "./sidebar-shell";
import { SIDEBAR_IDLE, SIDEBAR_ROW } from "./sidebar-styles";
import { ThemeToggle } from "./theme-toggle";

/**
 * The panel: a sidebar beside the page from tablet-landscape width up, which collapses to its icons, and a slim bar
 * with a Menu that opens it as a drawer below that. `nav`: the open activity's tabs, for the sidebar (see ActivityTree).
 */
export default async function AdminLayout({ children, nav }: LayoutProps<"/admin">) {
  const session = await requireAdmin();
  const jar = await cookies();
  const theme = jar.get(THEME_COOKIE)?.value === "dark" ? "dark" : "light";

  const sidebar = (
    <>
      <AdminNav isSuper={session.kind === "super"} archived={<ArchivedNav />}>
        {nav}
      </AdminNav>
      <div className="mt-auto space-y-1 pt-6">
        {session.kind === "organizer" ? (
          <Link href="/admin/profile" className={`${SIDEBAR_ROW} h-auto! py-2 ${SIDEBAR_IDLE}`} title="Your profile">
            <Avatar name={session.admin.name} src={session.admin.photoUrl} size={24} className="shrink-0" />
            <span className="sidebar-label min-w-0 leading-tight">
              <span className="block truncate text-sm font-medium text-prussian">{session.admin.name}</span>
              <span className="block truncate text-xs">{session.admin.email}</span>
            </span>
          </Link>
        ) : (
          <Link href="/admin/profile" className={`${SIDEBAR_ROW} ${SIDEBAR_IDLE}`} title="Your profile">
            <svg viewBox="0 0 20 20" className="size-5 shrink-0" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" aria-hidden>
              <circle cx="10" cy="7" r="3" />
              <path d="M4 16.5c.7-3 3-4.6 6-4.6s5.3 1.6 6 4.6" />
            </svg>
            <span className="sidebar-label">Super admin</span>
          </Link>
        )}
        <ThemeToggle initial={theme} />
        <form action={logout}>
          <button className={`${SIDEBAR_ROW} ${SIDEBAR_IDLE}`} title="Sign out">
            <svg viewBox="0 0 20 20" className="size-5 shrink-0" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="M8 4H5.5A1.5 1.5 0 004 5.5v9A1.5 1.5 0 005.5 16H8M12.5 7l3 3-3 3M15.5 10H8" />
            </svg>
            <span className="sidebar-label">Sign out</span>
          </button>
        </form>
      </div>
    </>
  );

  return (
    <SidebarShell theme={theme} initialCollapsed={jar.get(SIDEBAR_COOKIE)?.value === "collapsed"}>
      {/* Its edge is a shadow, not a border, so nothing shifts as it narrows and the hairline runs its full height. */}
      <header className="admin-sidebar flex items-center justify-between gap-4 bg-mint px-4 py-2.5 shadow-[0_1px_0_var(--color-line)] sm:px-6 lg:sticky lg:top-0 lg:h-dvh lg:shrink-0 lg:flex-col lg:items-stretch lg:justify-start lg:px-4 lg:py-6 lg:shadow-[1px_0_0_var(--color-line)]">
        <Link href="/admin" aria-label="Tabulous" className="tap-target flex items-center gap-[0.35em] self-start px-3 text-lg font-bold tracking-tight whitespace-nowrap">
          <TallyMark className="size-[1.25em] shrink-0" />
          <span className="sidebar-label">Tabulous</span>
        </Link>
        <div className="hidden min-h-0 flex-1 flex-col overflow-x-hidden overflow-y-auto lg:mt-6 lg:flex">{sidebar}</div>
        <SidebarDrawer>{sidebar}</SidebarDrawer>
        <CollapseToggle />
      </header>
      <div className="min-w-0 flex-1">
        <main className="mx-auto max-w-6xl px-4 py-8 sm:px-6 sm:py-10 lg:px-10">{children}</main>
        <footer className="mx-auto max-w-6xl px-4 pb-8 sm:px-6 lg:px-10">
          <LegalLinks className="text-prussian/70" />
        </footer>
      </div>
      {/* Judges' calls for help, wherever the organizer is in the panel. */}
      <AssistanceAlerts />
    </SidebarShell>
  );
}
