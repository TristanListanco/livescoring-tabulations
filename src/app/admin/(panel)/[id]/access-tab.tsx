import { Qr } from "@/components/qr";
import { qrSvg } from "@/lib/qr";
import type { Judge, JudgeDevice } from "@/lib/types";
import { LinkField } from "../link-field";
import { DeviceApproval, LiveRefresh } from "./judge-devices";
import { AddJudgeForm, BoardsSummary, JudgeEditor, JudgeIdentity } from "./judges-tab";

/**
 * The judges, one row each: who they are (changed here until the session starts), their judge code and QR code, and
 * their device, approved here when they read out its pairing code.
 */
export async function JudgesTab({
  activityId,
  devices,
  origin,
  judges,
  codes,
  scoredBy,
  entryCount,
  expected,
  locked,
  ended,
  pageant,
}: {
  activityId: string;
  devices: JudgeDevice[];
  origin: string;
  judges: Judge[];
  codes: Map<string, string>;
  scoredBy: Map<string, number>;
  entryCount: number;
  /** Pageants: how many scores each judge gives, which depends on the segments they judge. */
  expected?: Record<string, number>;
  /** The session has started: the panel can't change. */
  locked: boolean;
  /** Judging has ended: nothing much changes here until it's reopened. */
  ended: boolean;
  pageant: boolean;
}) {
  const judgeLinks = judges.map((j) => {
    const code = codes.get(j.id) ?? "";
    return { judge: j, code, url: `${origin}/judge/join/${code}` };
  });
  const judgeQrs = await Promise.all(judgeLinks.map((l) => qrSvg(l.url)));
  const waiting = devices.filter((d) => d.status === "pending").length;

  return (
    <div className="max-w-4xl">
      <LiveRefresh activityId={activityId} ended={ended} />
      <h2 className="text-xl font-bold">Judges</h2>
      <p className="mt-1 max-w-2xl text-[15px] text-prussian/80">
        Judges sign in with their code or QR code, then read out the pairing code their device shows: approve it here.
      </p>
      <p className="label mt-4">Judge portal</p>
      <LinkField url={`${origin}/judge`} />
      {pageant && <BoardsSummary judges={judges} />}
      {locked && (
        <p role="note" className="note mt-4">
          The session has started, so the panel of judges is locked.
        </p>
      )}

      <p role="status" className={`mt-6 font-semibold ${waiting ? "text-regal" : "sr-only"}`}>
        {waiting ? `${waiting} ${waiting === 1 ? "device is" : "devices are"} waiting for approval.` : "No devices are waiting for approval."}
      </p>
      {judges.length === 0 ? (
        <p className="mt-4 rounded-xl border border-dashed border-powder px-4 py-6 text-center">No judges yet. Add one below.</p>
      ) : (
        <ul className="mt-3 divide-y divide-line border-y border-line">
          {judgeLinks.map(({ judge, code }, i) => {
            const scored = scoredBy.get(judge.id) ?? 0;
            const detail = `${scored} of ${expected?.[judge.id] ?? entryCount} scored`;
            return (
              <li key={judge.id} className="py-5">
                <div className="flex flex-wrap items-start gap-x-6 gap-y-3">
                  <div className="min-w-0 flex-1 basis-80">
                    {locked ? (
                      <JudgeIdentity judge={judge} pageant={pageant} detail={detail} />
                    ) : (
                      <JudgeEditor judge={judge} scored={scored} pageant={pageant} detail={detail} />
                    )}
                  </div>
                  {/* Called "judge code" here because that's what the judge portal asks them for. */}
                  {code && (
                    <p className="tabular sm:text-right">
                      <span className="block text-xs font-semibold text-prussian/70">Judge code </span>
                      <span className="text-2xl font-bold tracking-[0.2em] text-regal">{code}</span>
                    </p>
                  )}
                </div>
                <div className="sm:pl-16">
                  <DeviceApproval judge={judge} devices={devices.filter((d) => d.judgeId === judge.id)} />
                  <details className="group mt-2">
                    <summary className="tap-target cursor-pointer text-sm font-semibold text-regal select-none hover:underline">
                      <span className="group-open:hidden">
                        Show QR code<span className="sr-only"> for {judge.name}</span>
                      </span>
                      <span className="hidden group-open:inline">
                        Hide QR code<span className="sr-only"> for {judge.name}</span>
                      </span>
                    </summary>
                    <div className="mt-3">
                      <Qr svg={judgeQrs[i]} label={`QR code that signs in ${judge.name}`} />
                    </div>
                  </details>
                </div>
              </li>
            );
          })}
        </ul>
      )}
      {!locked && <AddJudgeForm activityId={activityId} pageant={pageant} />}
    </div>
  );
}
