import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getDevice, getJudgeContext } from "@/lib/data";
import { approvedDevice } from "@/lib/devices";
import { judgeSession } from "@/lib/session";
import { TOO_MANY } from "@/lib/sign-in-limits";
import { CodeForm } from "./code-form";

export const metadata: Metadata = { title: "Judge sign-in" };

export default async function JudgePortal({ searchParams }: PageProps<"/judge">) {
  const query = await searchParams;
  const code = typeof query.code === "string" ? query.code.slice(0, 32) : "";
  const session = await judgeSession();
  const context = session ? await getJudgeContext(session.judgeId) : null;
  // Resetting an activity's scores signs every judge device out: this one's gone, so the judge signs in again.
  const signedOut = !!context && !!session?.deviceId && !(await getDevice(session.deviceId));
  // A judge link for someone else, opened on a device that's judging: it asks before switching (see the join route).
  const switching = query.switch === "1" && !!context && !!session && (await approvedDevice(session.judgeId, session.deviceId));
  // A judge link opened: its code is filled in, for the judge to tap Start judging (the link signs nothing in itself),
  // even on a browser still waiting as another judge.
  const fromLink = query.link === "1" && !!code;
  if (context && !switching && !signedOut && !fromLink) redirect("/judge/score");

  const invalid = query.invalid === "1";
  const limited = query.limited === "1";

  return (
    <main className="flex min-h-dvh items-center justify-center bg-prussian px-4 py-12 text-mint">
      <div className="w-full max-w-md">
        {switching && context ? (
          <>
            <h1 className="judge-title">Switch judge?</h1>
            <p className="judge-lede mt-3">
              This device is judging as {context.judge.name}. Switching signs it out for them, and the organizer has to approve it again
              before it can score.
            </p>
            <Link href="/judge/score" className="btn mt-8 h-16 w-full rounded-2xl bg-mint text-xl text-prussian hover:bg-white">
              Keep judging as {context.judge.name}
            </Link>
            <p className="mt-8 text-sm font-semibold text-powder">Or switch to the code from the link:</p>
            <CodeForm initialCode={code} submitLabel="Switch judge" quiet />
          </>
        ) : (
          <>
            <h1 className="judge-title">Judge sign-in</h1>
            {signedOut && (
              <p role="status" className="mt-4 rounded-xl bg-oxford px-4 py-3 font-semibold">
                You were signed out because the organizer reset the scores. Sign in again to judge.
              </p>
            )}
            <p className="judge-lede mt-3">
              {fromLink ? "Your judge code is filled in. Tap Start judging." : "Enter the judge code the organizer gave you."}
            </p>
            <CodeForm
              initialCode={code}
              // Filled in from a link, the keyboard would only cover the button.
              autoFocus={!fromLink}
              initialError={limited ? TOO_MANY : invalid ? "That code doesn't match any judge. Check it with the organizer." : undefined}
            />
          </>
        )}
      </div>
    </main>
  );
}
