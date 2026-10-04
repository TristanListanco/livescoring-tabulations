import { redirect } from "next/navigation";
import { findJudgeIdByCode } from "@/lib/data";
import { startJudgeSession } from "@/lib/session";

/** The per-judge link (and QR code). Signs the device in as that judge in one tap. */
export async function GET(_request: Request, { params }: RouteContext<"/judge/join/[code]">) {
  const { code } = await params;
  const judgeId = await findJudgeIdByCode(code);
  // Relative redirects: building absolute URLs from request.url yields the server's bind
  // address (e.g. 0.0.0.0), which phones on the venue Wi-Fi can't reach.
  if (!judgeId) redirect(`/judge?code=${encodeURIComponent(code)}&invalid=1`);
  await startJudgeSession(judgeId);
  redirect("/judge/score");
}
