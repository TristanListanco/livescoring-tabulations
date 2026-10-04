import type { Metadata } from "next";
import Link from "next/link";
import { Avatar } from "@/components/avatar";
import { listAdmins } from "@/lib/data";
import { requireSuperAdmin } from "@/lib/session";

export const metadata: Metadata = { title: "Organizers" };

export default async function OrganizersPage() {
  await requireSuperAdmin();
  const organizers = await listAdmins();

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Organizers</h1>
          <p className="hint mt-1 max-w-xl">
            Organizer accounts sign in with their email and password, and see and manage only their own activities.
          </p>
        </div>
        <Link href="/admin/organizers/new" className="btn btn-primary">
          New organizer
        </Link>
      </div>

      {organizers.length === 0 ? (
        <div className="mt-10 rounded-2xl border border-dashed border-powder px-6 py-14 text-center">
          <p className="text-lg font-semibold">No organizer accounts yet</p>
          <p className="hint mx-auto mt-1 max-w-md">Create one for each event organizer. You can hand them existing activities from each activity&apos;s Settings tab.</p>
        </div>
      ) : (
        <ul className="mt-8 divide-y divide-line border-y border-line">
          {organizers.map((o) => (
            <li key={o.id} className="group relative flex items-center gap-4 py-4 hover:bg-white/70">
              <Avatar name={o.name} src={o.photoUrl} size={48} />
              <div className="min-w-0 flex-1">
                <Link href={`/admin/organizers/${o.id}`} className="font-semibold text-regal after:absolute after:inset-0 group-hover:underline">
                  {o.name}
                </Link>
                <p className="hint truncate">{o.email}</p>
              </div>
              <p className="tabular hint shrink-0">
                {o.activityCount} {o.activityCount === 1 ? "activity" : "activities"}
              </p>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
