import type { Metadata } from "next";
import Link from "next/link";
import { getDraft } from "@/lib/data";
import { requireAdmin } from "@/lib/session";
import { NewActivity } from "./new-activity";

export const metadata: Metadata = { title: "New activity" };

/** A new activity, or (?draft=id) one continued from a saved draft. */
export default async function NewActivityPage({ searchParams }: PageProps<"/admin/new">) {
  const session = await requireAdmin();
  const requested = (await searchParams).draft;
  const draftId = typeof requested === "string" ? requested : null;
  // Only the admin's own drafts open: an organizer's, or the super admin's.
  const draft = draftId ? await getDraft(draftId, session.kind === "organizer" ? session.admin.id : null) : null;
  return (
    <>
      <Link href="/admin" className="text-action">
        Activities
      </Link>
      <h1 className="mt-1 text-3xl font-bold tracking-tight">{draft?.name ? draft.name : "New activity"}</h1>
      <NewActivity
        // A fresh form for each draft opened, so its saved state is what the form starts from.
        key={draft?.id ?? "new"}
        draft={draft ? { id: draft.id, kind: draft.kind, data: draft.data } : null}
        missingDraft={draftId !== null && !draft}
      />
    </>
  );
}
