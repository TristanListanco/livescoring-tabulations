import { getAdmin, getBoard, getSignatories } from "@/lib/data";
import { reportId } from "@/lib/report";
import { renderResultsPdf, type ReportOrganizer } from "@/lib/results-pdf";
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

/** The activity's organizer for the sheet's header and signature lines. A photo that won't load is left out, not fatal. */
async function reportOrganizer(ownerId: string | null): Promise<ReportOrganizer | null> {
  if (!ownerId) return null;
  const [admin, signatories] = await Promise.all([getAdmin(ownerId), getSignatories(ownerId)]);
  if (!admin) return null;
  let photo: Buffer | null = null;
  if (admin.photoUrl) {
    try {
      const response = await fetch(admin.photoUrl, { signal: AbortSignal.timeout(5000) });
      if (response.ok) photo = Buffer.from(await response.arrayBuffer());
    } catch {
      photo = null;
    }
  }
  return { name: admin.name, photo, signatories };
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
  const pdf = await renderResultsPdf(board, { timeZone, reportId: reportId(board), organizer: await reportOrganizer(board.activity.ownerId) });
  return new Response(new Uint8Array(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${fileName(board.activity.name)}"`,
      "Cache-Control": "no-store",
    },
  });
}
