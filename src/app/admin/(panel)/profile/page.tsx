import type { Metadata } from "next";
import Link from "next/link";
import { Avatar } from "@/components/avatar";
import { listAdminSessions, requireAdmin } from "@/lib/session";
import { Section } from "../section";
import { ChangePassword } from "./change-password";
import { SignedInDevices } from "./signed-in-devices";

export const metadata: Metadata = { title: "Profile" };

const DEVICES_HINT =
  "Every browser signed in to your account. Sign out any you don't recognize or don't use anymore: it ends there at once.";

/**
 * Your own profile: for an organizer, who they are on the results PDF, and their password; for anyone,
 * the browsers signed in to their account.
 */
export default async function ProfilePage() {
  const session = await requireAdmin();
  const sessions = await listAdminSessions(session);
  const super_ = session.kind !== "organizer";
  const devices = sessions && (
    <Section
      title="Signed-in devices"
      hint={super_ ? `${DEVICES_HINT} Changing ADMIN_PASSWORD signs you out everywhere.` : DEVICES_HINT}
      flush={super_}
    >
      <SignedInDevices sessions={sessions} />
    </Section>
  );

  if (super_) {
    return (
      <>
        <Link href="/admin" className="text-action">
          Back to activities
        </Link>
        <h1 className="mt-1 text-3xl font-bold tracking-tight">Profile</h1>
        <div className="mt-6 max-w-4xl">{devices ?? <p className="hint">Signed-in devices need a database update: run supabase/migrations/022_admin_sessions.sql.</p>}</div>
      </>
    );
  }
  const { admin } = session;

  return (
    <>
      <Link href="/admin" className="text-action">
        Back to activities
      </Link>
      <h1 className="mt-1 text-3xl font-bold tracking-tight">Profile</h1>
      <div className="mt-6 max-w-4xl">
        <Section title="Organizer" hint="To change your name, email or photo, ask the administrator who set up your account." flush>
          <div className="flex items-center gap-4">
            <Avatar name={admin.name} src={admin.photoUrl} size={72} />
            <div className="min-w-0">
              <p className="text-lg font-bold">{admin.name}</p>
              <p className="hint">{admin.email}</p>
            </div>
          </div>
        </Section>
        <Section title="Password" hint="Change the password you were given for one of your own. Your other devices are signed out; this one stays signed in.">
          <ChangePassword />
        </Section>
        {devices}
      </div>
    </>
  );
}
