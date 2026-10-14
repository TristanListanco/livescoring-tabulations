import { redirect } from "next/navigation";
import { findJudgeIdByCode } from "@/lib/data";
import { approvedDevice, signInJudgeDevice } from "@/lib/devices";
import { judgeSession } from "@/lib/session";
import { clientAddress, LIMITS, recordFailure, tooManyFailures } from "@/lib/sign-in-limits";

/** The per-judge link (and QR code). Signs this device in as that judge; the organizer still approves it. */
export async function GET(_request: Request, { params }: RouteContext<"/judge/join/[code]">) {
  const code = (await params).code.slice(0, 32);
  // Relative redirects: building absolute URLs from request.url yields the server's bind
  // address (e.g. 0.0.0.0), which phones on the venue Wi-Fi can't reach.
  const address = `judge-ip:${await clientAddress()}`;
  if (await tooManyFailures([[address, LIMITS.judgeAddress]])) redirect(`/judge?code=${encodeURIComponent(code)}&limited=1`);
  const judgeId = await findJudgeIdByCode(code);
  if (!judgeId) {
    await recordFailure([address]);
    redirect(`/judge?code=${encodeURIComponent(code)}&invalid=1`);
  }
  // A device already approved for another judge isn't switched by a link: a link sent mid-show would take it off
  // judging until the organizer approved it again. It asks first, on the sign-in page, where switching is a form.
  const current = await judgeSession();
  if (current && current.judgeId !== judgeId && (await approvedDevice(current.judgeId, current.deviceId))) {
    redirect(`/judge?code=${encodeURIComponent(code)}&switch=1`);
  }
  await signInJudgeDevice(judgeId);
  redirect("/judge/score");
}
