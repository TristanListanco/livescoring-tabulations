import { redirect } from "next/navigation";
import { findJudgeIdByCode } from "@/lib/data";
import { signInJudgeDevice } from "@/lib/devices";

/** The per-judge link (and QR code). Signs this device in as that judge; the organizer still approves it. */
export async function GET(_request: Request, { params }: RouteContext<"/judge/join/[code]">) {
  const { code } = await params;
  const judgeId = await findJudgeIdByCode(code);
  // Relative redirects: building absolute URLs from request.url yields the server's bind
  // address (e.g. 0.0.0.0), which phones on the venue Wi-Fi can't reach.
  if (!judgeId) redirect(`/judge?code=${encodeURIComponent(code)}&invalid=1`);
  await signInJudgeDevice(judgeId);
  redirect("/judge/score");
}
