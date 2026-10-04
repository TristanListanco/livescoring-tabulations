import Link from "next/link";
import { requireAdmin } from "@/lib/session";
import { logout } from "../actions";

export default async function AdminLayout({ children }: LayoutProps<"/admin">) {
  await requireAdmin();

  return (
    <div className="min-h-dvh">
      <header className="bg-prussian text-mint">
        <div className="mx-auto flex h-16 max-w-6xl items-center gap-4 px-4 sm:px-6">
          <Link href="/admin" className="text-lg font-bold">
            LiveScoring
          </Link>
          <span className="text-sm text-powder">Admin</span>
          <form action={logout} className="ml-auto">
            <button className="btn btn-sm text-powder hover:bg-oxford hover:text-mint">Sign out</button>
          </form>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-8 sm:px-6 sm:py-10">{children}</main>
    </div>
  );
}
