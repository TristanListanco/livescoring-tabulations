import { getAdminBoard } from "@/lib/data";
import { exportResponse } from "@/lib/exports";
import { canManageActivity, currentAdmin } from "@/lib/session";
import { traced } from "@/lib/observe";

/**
 * An activity's downloads (see exports.ts): the results as a PDF, or with ?sheet=judges each judge's score sheet,
 * ?sheet=notes the judges' notes, and a pageant's sheets by ?round, ?cut or ?segment. ?format=csv writes the results or
 * the judges' scores as CSV instead. Only once they're ready.
 */
export const GET = traced("GET /admin/[id]/export", async function GET(request: Request, { params }: RouteContext<"/admin/[id]/export">) {
  const session = await currentAdmin();
  if (!session) return new Response("Sign in to the admin panel first.", { status: 401 });

  // With a pageant's deductions, which its standings sheets list.
  const board = await getAdminBoard((await params).id);
  // Organizers export only their own activities, the super admin only those no organizer owns.
  if (!board || !canManageActivity(session, board.activity.ownerId)) {
    return new Response("Activity not found.", { status: 404 });
  }
  return exportResponse(board, new URL(request.url).searchParams);
});
