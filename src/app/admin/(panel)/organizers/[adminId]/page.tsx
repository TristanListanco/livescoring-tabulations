import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getAdmin, listOrganizerActivityNames } from "@/lib/data";
import { requireSuperAdmin } from "@/lib/session";
import { EditOrganizer } from "./edit-organizer";

export const metadata: Metadata = { title: "Organizer" };

export default async function OrganizerPage({ params }: PageProps<"/admin/organizers/[adminId]">) {
  await requireSuperAdmin();
  const { adminId } = await params;
  const organizer = await getAdmin(adminId);
  if (!organizer) notFound();
  const activities = await listOrganizerActivityNames(organizer.id);

  return (
    <>
      <Link href="/admin/organizers" className="text-action">
        Organizers
      </Link>
      <h1 className="mt-1 text-3xl font-bold tracking-tight">{organizer.name}</h1>
      <p className="hint mt-1">{organizer.email}</p>
      <EditOrganizer
        organizer={organizer}
        activities={activities.map((a) => ({ name: a.name, running: a.sessionState === "live" || a.sessionState === "deliberation" }))}
      />
    </>
  );
}
