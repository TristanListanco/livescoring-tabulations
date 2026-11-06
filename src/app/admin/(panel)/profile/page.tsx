import type { Metadata } from "next";
import { Avatar } from "@/components/avatar";
import { LegalLinks } from "@/components/legal-links";
import { listAdminSessions, requireAdmin } from "@/lib/session";
import { Section } from "../section";
import { ChangePassword } from "./change-password";
import { SignedInDevices } from "./signed-in-devices";
import { BackLink } from "../back-link";

export const metadata: Metadata = { title: "Profile" };


/**
 * Your own profile: for an organizer, who they are on the results PDF, and their password; for anyone,
 * the browsers signed in to their account.
 */
export default async function ProfilePage() {
  const session = await requireAdmin();
  const sessions = await listAdminSessions(session);
  const super_ = session.kind !== "organizer";
  // The privacy policy and terms of service live here, with the account, rather than at the foot of every page.
  const legal = <LegalLinks className="mt-8 text-prussian/70" />;
  const devices = sessions && (
    <Section title="Signed-in devices">
      <SignedInDevices sessions={sessions} />
    </Section>
  );

  if (super_) {
    return (
      <>
        <BackLink href="/admin">Activities</BackLink>
        <h1 className="title mt-1">Profile</h1>
        <div className="mt-6 max-w-4xl">{devices ?? <p className="hint">Signed-in devices need a database update: run supabase/migrations/022_admin_sessions.sql.</p>}</div>
        {legal}
      </>
    );
  }
  const { admin } = session;

  return (
    <>
      <BackLink href="/admin">Activities</BackLink>
      <h1 className="title mt-1">Profile</h1>
      <div className="mt-6 max-w-4xl">
        <Section title="Organizer">
          <div className="flex items-center gap-4">
            <Avatar name={admin.name} src={admin.photoUrl} size={72} />
            <div className="min-w-0">
              <p className="text-lg font-bold">{admin.name}</p>
              <p className="hint">{admin.email}</p>
            </div>
          </div>
        </Section>
        <Section title="Password">
          <ChangePassword />
        </Section>
        {devices}
      </div>
      {legal}
    </>
  );
}
