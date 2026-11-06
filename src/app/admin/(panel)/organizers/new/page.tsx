import type { Metadata } from "next";
import { requireSuperAdmin } from "@/lib/session";
import { OrganizerForm } from "./organizer-form";
import { BackLink } from "../../back-link";

export const metadata: Metadata = { title: "New organizer" };

export default async function NewOrganizerPage() {
  await requireSuperAdmin();
  return (
    <>
      <BackLink href="/admin/organizers">Organizers</BackLink>
      <h1 className="title mt-1">New organizer</h1>
      <OrganizerForm />
    </>
  );
}
