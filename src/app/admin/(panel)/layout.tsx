import { cookies } from "next/headers";
import Link from "next/link";
import { Avatar } from "@/components/avatar";
import { Wordmark } from "@/components/brand";
import { LegalLinks } from "@/components/legal-links";
import { SurveyLink } from "@/components/survey-link";
import { requireAdmin } from "@/lib/session";
import { SURVEY_URL } from "@/lib/survey";
import { logout } from "../actions";
import { THEME_COOKIE } from "@/lib/theme";
import { AdminNav } from "./admin-nav";
import { AssistanceAlerts } from "./assistance-alerts";
import { SidebarDrawer } from "./sidebar-drawer";
import { SIDEBAR_IDLE, SIDEBAR_ROW } from "./sidebar-styles";
import { ThemeToggle } from "./theme-toggle";

/**
 * The panel: a sidebar beside the page, from tablet-landscape width up, and a slim bar with a Menu that opens it as a
 * drawer below that. `nav`: the open activity's tabs, for the sidebar (see ActivityTree).
 */
export default async function AdminLayout({ children, nav }: LayoutProps<"/admin">) {
  const session = await requireAdmin();
  const theme = (await cookies()).get(THEME_COOKIE)?.value === "dark" ? "dark" : "light";

  const sidebar = (
    <>
      <AdminNav isSuper={session.kind === "super"}>{nav}</AdminNav>
      <div className="mt-auto space-y-3 pt-6">
        {SURVEY_URL && (
          <div className="rounded-2xl border border-line bg-white p-3.5">
            <p className="text-sm font-semibold">Help make Tabulous better</p>
            <p className="mt-0.5 text-[13px] leading-snug text-prussian/70">A short anonymous survey, about 8 minutes.</p>
            <SurveyLink className="btn btn-sm btn-quiet mt-2.5">Take the survey</SurveyLink>
          </div>
        )}
        <div className="space-y-1 border-t border-line pt-3">
          {session.kind === "organizer" ? (
            <Link href="/admin/profile" className={`${SIDEBAR_ROW} h-auto! py-2 ${SIDEBAR_IDLE}`} title="Your profile">
              <Avatar name={session.admin.name} src={session.admin.photoUrl} size={32} />
              <span className="min-w-0 leading-tight">
                <span className="block truncate text-sm font-semibold text-prussian">{session.admin.name}</span>
                <span className="block truncate text-xs">{session.admin.email}</span>
              </span>
            </Link>
          ) : (
            <Link href="/admin/profile" className={`${SIDEBAR_ROW} ${SIDEBAR_IDLE}`} title="Your profile">
              <svg viewBox="0 0 20 20" className="size-5 shrink-0" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" aria-hidden>
                <circle cx="10" cy="7" r="3" />
                <path d="M4 16.5c.7-3 3-4.6 6-4.6s5.3 1.6 6 4.6" />
              </svg>
              Super admin
            </Link>
          )}
          <ThemeToggle initial={theme} />
          <form action={logout}>
            <button className={`${SIDEBAR_ROW} ${SIDEBAR_IDLE}`}>
              <svg viewBox="0 0 20 20" className="size-5 shrink-0" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <path d="M8 4H5.5A1.5 1.5 0 004 5.5v9A1.5 1.5 0 005.5 16H8M12.5 7l3 3-3 3M15.5 10H8" />
              </svg>
              Sign out
            </button>
          </form>
        </div>
      </div>
    </>
  );

  return (
    <div data-admin-theme data-theme={theme} className="min-h-dvh bg-mint text-prussian lg:flex">
      <header className="flex items-center justify-between gap-4 border-b border-line px-4 py-2.5 sm:px-6 lg:sticky lg:top-0 lg:h-dvh lg:w-64 lg:shrink-0 lg:flex-col lg:items-stretch lg:justify-start lg:border-r lg:border-b-0 lg:px-4 lg:py-6">
        <Link href="/admin" className="tap-target self-start px-3 text-lg">
          <Wordmark />
        </Link>
        <div className="hidden min-h-0 flex-1 flex-col overflow-y-auto lg:mt-6 lg:flex">{sidebar}</div>
        <SidebarDrawer>{sidebar}</SidebarDrawer>
      </header>
      <div className="min-w-0 flex-1">
        <main className="mx-auto max-w-6xl px-4 py-8 sm:px-6 sm:py-10 lg:px-10">{children}</main>
        <footer className="mx-auto max-w-6xl px-4 pb-8 sm:px-6 lg:px-10">
          <LegalLinks className="text-prussian/70" />
        </footer>
      </div>
      {/* Judges' calls for help, wherever the organizer is in the panel. */}
      <AssistanceAlerts />
    </div>
  );
}
