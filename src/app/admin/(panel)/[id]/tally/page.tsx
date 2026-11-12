import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getAdminBoard, withBreakdowns } from "@/lib/data";
import { canManageActivity, requireAdmin } from "@/lib/session";
import { tallyUnlockedUntil } from "@/lib/tally-access";
import { TallyLock } from "./tally-lock";
import { TallyView } from "./tally-view";

export const metadata: Metadata = { title: "Private tally", robots: { index: false, follow: false } };

/**
 * The private tally: every score so far, judge by judge and criterion by criterion, for the organizer to tabulate by
 * hand if something fails during judging. Events without live scoring (with it, the live results show every score),
 * and pageants: their standings, and any sub-activity holding its scores back, are the organizer's alone. Opens with the
 * admin's password, on this browser, for a few minutes (see tally-access.ts).
 */
export default async function TallyPage({ params }: PageProps<"/admin/[id]/tally">) {
  const session = await requireAdmin();
  const { id } = await params;
  const board = await getAdminBoard(id);
  if (!board || !canManageActivity(session, board.activity.ownerId)) notFound();
  const { activity } = board;
  const back = (
    <Link href={`/admin/${id}?tab=session`} className="text-action">
      Back to {activity.name}
    </Link>
  );

  if (activity.kind === "event" && activity.liveScoring) {
    return (
      <>
        {back}
        <h1 className="title mt-1">Private tally</h1>
        <p className="hint mt-2 max-w-xl">This event scores live, so its live results already show every score as it comes in.</p>
      </>
    );
  }

  // Archived: the results are final and download from its page, so the tally is closed for good.
  if (activity.archivedAt) {
    return (
      <>
        {back}
        <h1 className="title mt-1">Private tally</h1>
        <p className="hint mt-2 max-w-xl">The private tally closed when {activity.name} was archived. Its results and score sheets download from its page.</p>
      </>
    );
  }

  const until = await tallyUnlockedUntil(session, id);
  if (!until) {
    return (
      <>
        {back}
        <TallyLock
          activityId={id}
          name={activity.name}
          superAdmin={session.kind === "super"}
          // A pageant's tally is official once it has ended (see TallyView).
          official={activity.kind === "pageant" ? activity.sessionState === "ended" : activity.signedOffAt !== null}
        />
      </>
    );
  }
  const viewer = session.kind === "super" ? "Super admin" : `${session.admin.name} · ${session.admin.email}`;
  return (
    <>
      {back}
      <TallyView board={await withBreakdowns(board)} viewer={viewer} until={until} />
    </>
  );
}
