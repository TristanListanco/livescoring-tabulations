import { QrDialog } from "@/components/qr-dialog";
import { qrSvg } from "@/lib/qr";
import type { Judge, JudgeDevice } from "@/lib/types";
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
  // Each board's chair, by the segments it chairs: a judge on the same segments can take over.
  const chaired = new Set(judges.filter((j) => j.isChair).map((j) => j.panel));

  return (
    // Marked, so a device asking to be approved here isn't also shown in the panel's dialog (see AssistanceAlerts).
    <div className="max-w-4xl" data-device-approvals={activityId}>
      <LiveRefresh activityId={activityId} ended={ended} />
      <h2 className="sr-only">Judges</h2>
      {/* No judge portal link to hand out: judges scan their QR code, or type their code at the portal. */}
      {pageant && <BoardsSummary judges={judges} />}
      {locked && (
        <p role="note" className="note mt-4">
          The session has started, so the panel of judges is locked.
        </p>
      )}

      <p role="status" className={`mt-6 font-semibold ${waiting ? "text-regal" : "sr-only"}`}>
        {waiting ? `${waiting} ${waiting === 1 ? "device is" : "devices are"} waiting for approval.` : "No devices are waiting for approval."}
      </p>
      {/* The panel, then (until the session starts) adding a judge as the card's last row, in the same shape as theirs. */}
      <div className="card mt-3 overflow-hidden">
        {judges.length === 0 && <p className={`px-5 text-[15px] text-prussian/75 ${locked ? "py-5" : "pt-5"}`}>No judges yet.</p>}
        <ul className="divide-y divide-line">
          {judgeLinks.map(({ judge, code }, i) => {
            const scored = scoredBy.get(judge.id) ?? 0;
            // How far they've got, once there's something to count: not before the session starts.
            const detail = locked ? `${scored} of ${expected?.[judge.id] ?? entryCount} scored` : "";
            return (
              <li key={judge.id} className="px-5 py-5">
                <div className="flex flex-wrap items-start gap-x-6 gap-y-3">
                  <div className="min-w-0 flex-1 basis-80">
                    {locked ? (
                      <JudgeIdentity judge={judge} pageant={pageant} detail={detail} />
                    ) : (
                      <JudgeEditor judge={judge} scored={scored} pageant={pageant} detail={detail} canChair={!judge.isChair && chaired.has(judge.panel)} />
                    )}
                  </div>
                  {/*
                    The two ways a judge signs in, together: the code to type ("judge code", as the judge portal asks for it),
                    and the QR code to scan instead, opened in a dialog large enough to scan from the screen.
                  */}
                  {code && (
                    <div className="sm:text-right">
                      <p className="tabular">
                        <span className="block text-xs font-semibold text-prussian/70">Judge code </span>
                        <span className="text-2xl font-bold tracking-[0.2em] text-regal">{code}</span>
                      </p>
                      <QrDialog
                        triggerClassName="tap-target mt-1.5 inline-flex items-center gap-1.5 text-sm font-semibold text-regal hover:underline"
                        trigger={
                          <>
                            Show QR code<span className="sr-only"> for {judge.name}</span>
                          </>
                        }
                        title={judge.name}
                        svg={judgeQrs[i]}
                        label={`QR code that signs in ${judge.name}`}
                      >
                        {/* The tracking trails the last letter too: as much before the first keeps it centred. */}
                        <p className="tabular pl-[0.2em] text-2xl font-bold tracking-[0.2em] text-regal">{code}</p>
                        <p className="mt-2">Scan it with the judge&apos;s phone camera, then tap Start judging.</p>
                      </QrDialog>
                    </div>
                  )}
                </div>
                <div className="sm:pl-16">
                  <DeviceApproval judge={judge} devices={devices.filter((d) => d.judgeId === judge.id)} />
                </div>
              </li>
            );
          })}
        </ul>
        {!locked && <AddJudgeForm activityId={activityId} pageant={pageant} first={judges.length === 0} />}
      </div>
    </div>
  );
}
