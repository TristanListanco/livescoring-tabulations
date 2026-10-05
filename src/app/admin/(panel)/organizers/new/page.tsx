import type { Metadata } from "next";
import Link from "next/link";
import { requireSuperAdmin } from "@/lib/session";
import { OrganizerForm } from "./organizer-form";

export const metadata: Metadata = { title: "New organizer" };

export default async function NewOrganizerPage() {
  await requireSuperAdmin();
  return (
    <>
      <Link href="/admin/organizers" className="text-action">
        Organizers
      </Link>
      <h1 className="mt-1 text-3xl font-bold tracking-tight">New organizer</h1>
      <OrganizerForm />
    </>
  );
}
