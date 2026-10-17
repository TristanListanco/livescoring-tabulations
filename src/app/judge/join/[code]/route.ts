import { redirect } from "next/navigation";
import { findJudgeIdByCode, getDevice } from "@/lib/data";
import { approvedDevice } from "@/lib/devices";
import { judgeSession } from "@/lib/session";
import { clientAddress, LIMITS, recordFailure, tooManyFailures } from "@/lib/sign-in-limits";

/**
 * The per-judge link (and QR code). It opens the sign-in page with the judge's code filled in, and the judge taps
 * Start judging: the link itself signs nothing in. Anything can fetch a link without a judge behind it (a messaging
 * app building its preview, a QR scanner checking it, a browser preloading it), and each fetch used to ask the
 * organizer to approve a device that wasn't a judge's: a second request, often "Mac · Safari", beside the real one.
 * A browser already signed in as this judge goes straight to its screen.
 */
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
  const current = await judgeSession();
  // Already this judge's device (waiting or approved): nothing to ask again.
  if (current?.judgeId === judgeId && current.deviceId) {
    const device = await getDevice(current.deviceId);
    if (device && device.judgeId === judgeId && device.status !== "revoked") redirect("/judge/score");
  }
  // A device already approved for another judge isn't switched by a link: a link sent mid-show would take it off
  // judging until the organizer approved it again. It asks first, on the sign-in page, where switching is a form.
  const switching = !!current && current.judgeId !== judgeId && (await approvedDevice(current.judgeId, current.deviceId));
  redirect(`/judge?code=${encodeURIComponent(code)}&${switching ? "switch" : "link"}=1`);
}
