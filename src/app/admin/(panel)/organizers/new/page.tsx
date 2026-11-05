import type { Metadata } from "next";
import Link from "next/link";
import { requireSuperAdmin } from "@/lib/session";
import { OrganizerForm } from "./organizer-form";

export const metadata: Metadata = { title: "New organizer" };

export default async function NewOrganizerPage() {
  await requireSuperAdmin();
  return (
    <>
      <Link href="/admin/organizers" className="text-action lg:hidden">
        Organizers
      </Link>
      <h1 className="title mt-1">New organizer</h1>
      <OrganizerForm />
    </>
  );
}
