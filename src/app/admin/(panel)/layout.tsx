import { cookies } from "next/headers";
import Link from "next/link";
import { Avatar } from "@/components/avatar";
import { requireAdmin } from "@/lib/session";
import { logout } from "../actions";
import { THEME_COOKIE } from "@/lib/theme";
import { AdminNav } from "./admin-nav";
import { ThemeToggle } from "./theme-toggle";

export default async function AdminLayout({ children }: LayoutProps<"/admin">) {
  const session = await requireAdmin();
  const theme = (await cookies()).get(THEME_COOKIE)?.value === "dark" ? "dark" : "light";

  return (
    <div data-admin-theme data-theme={theme} className="min-h-dvh bg-mint text-prussian">
      <header className="admin-header keep-light bg-prussian text-mint">
        {/* On phones the super admin's links drop to a second row, so nothing runs off the screen. */}
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-4 gap-y-1 px-4 py-2.5 sm:h-16 sm:flex-nowrap sm:gap-6 sm:px-6 sm:py-0">
          <Link href="/admin" className="tap-target text-lg font-bold">
            LiveScoring
          </Link>
          {session.kind === "super" && <AdminNav />}
          <div className="ml-auto flex min-w-0 items-center gap-1 sm:gap-5">
            {session.kind === "organizer" ? (
              // On phones the photo alone, so the header stays one row; the name is still the link's name.
              <Link href="/admin/profile" className="flex min-w-0 items-center gap-3 rounded-lg px-1.5 py-1 hover:bg-oxford" title="Your profile">
                <Avatar name={session.admin.name} src={session.admin.photoUrl} size={36} />
                <div className="min-w-0 leading-tight max-sm:sr-only">
                  <p className="truncate text-sm font-semibold">{session.admin.name}</p>
                  <p className="hidden truncate text-xs text-powder sm:block">{session.admin.email}</p>
                </div>
              </Link>
            ) : (
              <Link href="/admin/profile" className="tap-target rounded-lg px-1.5 py-1 text-sm font-semibold text-powder hover:bg-oxford hover:text-mint" title="Your profile">
                Super admin
              </Link>
            )}
            <ThemeToggle initial={theme} />
            <form action={logout}>
              <button className="btn btn-sm text-powder hover:bg-oxford hover:text-mint">Sign out</button>
            </form>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-8 sm:px-6 sm:py-10">{children}</main>
    </div>
  );
}
