import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getAdmin, listActivities } from "@/lib/data";
import { requireSuperAdmin } from "@/lib/session";
import { EditOrganizer } from "./edit-organizer";

export const metadata: Metadata = { title: "Organizer" };

export default async function OrganizerPage({ params }: PageProps<"/admin/organizers/[adminId]">) {
  await requireSuperAdmin();
  const { adminId } = await params;
  const organizer = await getAdmin(adminId);
  if (!organizer) notFound();
  const activities = await listActivities(organizer.id);

  return (
    <>
      <Link href="/admin/organizers" className="text-sm font-semibold text-regal hover:underline">
        Organizers
      </Link>
      <h1 className="mt-1 text-3xl font-bold tracking-tight">{organizer.name}</h1>
      <p className="hint mt-1">{organizer.email}</p>
      <EditOrganizer organizer={organizer} activities={activities.map((a) => ({ id: a.id, name: a.name }))} />
    </>
  );
}
