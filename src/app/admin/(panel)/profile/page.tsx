import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Avatar } from "@/components/avatar";
import { getSignatories } from "@/lib/data";
import { requireAdmin } from "@/lib/session";
import { Section } from "../section";
import { SignatoriesEditor } from "../signatories-editor";

export const metadata: Metadata = { title: "Profile" };

/** An organizer's own profile: who they are on the results PDF, and who signs it. */
export default async function ProfilePage() {
  const session = await requireAdmin();
  if (session.kind !== "organizer") redirect("/admin/organizers");
  const { admin } = session;
  const signatories = await getSignatories(admin.id);

  return (
    <>
      <h1 className="text-3xl font-bold tracking-tight">Profile</h1>
      <div className="mt-6 max-w-4xl">
        <Section title="Organizer" hint="Shown in your admin panel and on your results PDFs. Ask the super admin to change these." flush>
          <div className="flex items-center gap-4">
            <Avatar name={admin.name} src={admin.photoUrl} size={72} />
            <div className="min-w-0">
              <p className="text-lg font-bold">{admin.name}</p>
              <p className="hint">{admin.email}</p>
            </div>
          </div>
        </Section>
        <Section
          title="Results PDF signatories"
          hint="Board of tabulators, representatives and others who sign your results. Each prints as a signature line with their designation."
        >
          <SignatoriesEditor adminId={null} initial={signatories} />
        </Section>
      </div>
    </>
  );
}
