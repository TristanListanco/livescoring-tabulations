import Link from "next/link";
import { Avatar } from "@/components/avatar";
import { requireAdmin } from "@/lib/session";
import { logout } from "../actions";

export default async function AdminLayout({ children }: LayoutProps<"/admin">) {
  const session = await requireAdmin();

  return (
    <div className="min-h-dvh">
      <header className="bg-prussian text-mint">
        <div className="mx-auto flex h-16 max-w-6xl items-center gap-4 px-4 sm:gap-6 sm:px-6">
          <Link href="/admin" className="text-lg font-bold">
            LiveScoring
          </Link>
          {session.kind === "super" && (
            <nav aria-label="Admin" className="flex items-center gap-1 text-sm font-semibold">
              <Link href="/admin" className="rounded-md px-2.5 py-1.5 text-powder hover:bg-oxford hover:text-mint">
                Activities
              </Link>
              <Link href="/admin/organizers" className="rounded-md px-2.5 py-1.5 text-powder hover:bg-oxford hover:text-mint">
                Organizers
              </Link>
            </nav>
          )}
          <div className="ml-auto flex min-w-0 items-center gap-3 sm:gap-5">
            {session.kind === "organizer" ? (
              <Link href="/admin/profile" className="flex min-w-0 items-center gap-3 rounded-lg px-1.5 py-1 hover:bg-oxford" title="Your profile">
                <Avatar name={session.admin.name} src={session.admin.photoUrl} size={36} />
                <div className="min-w-0 leading-tight">
                  <p className="truncate text-sm font-semibold">{session.admin.name}</p>
                  <p className="hidden truncate text-xs text-powder sm:block">{session.admin.email}</p>
                </div>
              </Link>
            ) : (
              <span className="rounded-md border border-oxford px-2.5 py-1 text-sm font-semibold text-powder">Super admin</span>
            )}
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
