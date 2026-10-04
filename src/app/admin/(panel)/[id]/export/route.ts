import { getAdmin, getBoard } from "@/lib/data";
import { reportId } from "@/lib/report";
import { renderResultsPdf } from "@/lib/results-pdf";
import { scoreProgress } from "@/lib/scoring";
import { currentAdmin } from "@/lib/session";

function fileName(name: string): string {
  const slug = name
    .normalize("NFKD")
    .replace(/[^\w\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .toLowerCase();
  return `${slug || "activity"}-results.pdf`;
}

/** Results sheet as a PDF. Only once every judge has scored every entry. */
export async function GET(request: Request, { params }: RouteContext<"/admin/[id]/export">) {
  const session = await currentAdmin();
  if (!session) return new Response("Sign in to the admin panel first.", { status: 401 });

  const board = await getBoard((await params).id);
  // Organizers can only export their own activities; anything else is "not found".
  if (!board || (session.kind === "organizer" && board.activity.ownerId !== session.admin.id)) {
    return new Response("Activity not found.", { status: 404 });
  }

  const progress = scoreProgress(board);
  if (!progress.complete) {
    return new Response(`Results can be exported once all scores are in (${progress.submitted} of ${progress.possible} so far).`, {
      status: 409,
    });
  }

  const timeZone = new URL(request.url).searchParams.get("tz") ?? undefined;
  const organizer = board.activity.ownerId ? await getAdmin(board.activity.ownerId) : null;
  const pdf = await renderResultsPdf(board, { timeZone, reportId: reportId(board), organizer: organizer?.name ?? null });
  return new Response(new Uint8Array(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${fileName(board.activity.name)}"`,
      "Cache-Control": "no-store",
    },
  });
}
