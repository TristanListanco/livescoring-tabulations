import { QrDialog } from "@/components/qr-dialog";
import { qrSvg } from "@/lib/qr";
import type { Judge, JudgeDevice } from "@/lib/types";
import { DeviceApproval, LiveRefresh } from "./judge-devices";
import { AddJudgeForm, BoardsSummary, JudgeEditor, JudgeIdentity, RemoveJudge } from "./judges-tab";

/**
 * A judge's row in three columns once the card is wide enough (the card is the container): who they are, how they sign
 * in, and their device. Narrower, the judge spans the top and the other two sit side by side; on a phone, they stack.
 */
const ROW_COLUMNS = "@xl:grid-cols-[auto_minmax(0,1fr)] @3xl:grid-cols-[minmax(0,1fr)_10.5rem_minmax(0,15rem)]";

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
  chairs,
  reset,
}: {
  /** The scores were reset: the session is back to not started, but the panel stays locked. */
  reset: boolean;
  /** Whether this activity has a chair: not an event with live scoring. */
  chairs: boolean;
  activityId: string;
  devices: JudgeDevice[];
  origin: string;
  judges: Judge[];
  codes: Map<string, string>;
  scoredBy: Map<string, number>;
  entryCount: number;
  /** Pageants: how many scores each judge gives, which depends on the segments they judge. */
  expected?: Record<string, number>;
  /** The session has started, or did before its scores were reset: the panel can't change (see judgesLocked). */
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
          {reset
            ? "The scores were reset, but judging has started before: the panel of judges stays as it was, and the same judges score again."
            : "The session has started, so the panel of judges is locked."}
        </p>
      )}

      <p role="status" className={`mt-6 font-semibold ${waiting ? "text-regal" : "sr-only"}`}>
        {waiting ? `${waiting} ${waiting === 1 ? "device is" : "devices are"} waiting for approval.` : "No devices are waiting for approval."}
      </p>
      {/* The panel, then (until the session starts) adding a judge as the card's last row, in the same shape as theirs. */}
      <div className="card @container mt-3 overflow-hidden">
        {judges.length === 0 && <p className={`px-5 text-[15px] text-prussian/75 ${locked ? "py-5" : "pt-5"}`}>No judges yet.</p>}
        {/* The columns named once, for the eye; each row's own labels say the same to a screen reader. */}
        {judges.length > 0 && (
          <div aria-hidden className={`hidden gap-x-6 border-b border-line px-5 py-2.5 text-xs font-semibold text-prussian/70 @3xl:grid ${ROW_COLUMNS}`}>
            <span>Judge</span>
            <span>Sign-in</span>
            <span>Device</span>
          </div>
        )}
        <ul className="divide-y divide-line">
          {judgeLinks.map(({ judge, code }, i) => {
            const scored = scoredBy.get(judge.id) ?? 0;
            // How far they've got, once there's something to count: not before the session starts.
            const detail = locked ? `${scored} of ${expected?.[judge.id] ?? entryCount} scored` : "";
            return (
              <li key={judge.id} className={`grid items-start gap-x-6 gap-y-4 px-5 py-5 ${ROW_COLUMNS}`}>
                <div className="min-w-0 @xl:col-span-2 @3xl:col-span-1">
                  {locked ? (
                    <JudgeIdentity judge={judge} pageant={pageant} detail={detail} />
                  ) : (
                    <JudgeEditor judge={judge} pageant={pageant} detail={detail} canChair={chairs && !judge.isChair && (chaired.has(judge.panel) || !pageant)} />
                  )}
                </div>
                {/*
                  The two ways a judge signs in, together: the code to type ("judge code", as the judge portal asks for it),
                  and the QR code to scan instead, opened in a dialog large enough to scan from the screen.
                */}
                <div className="flex items-center gap-3 @xl:pl-16 @3xl:pt-1.5 @3xl:pl-0">
                  {code && (
                    <>
                      <p className="tabular">
                        <span className="block text-xs font-semibold text-prussian/70 @3xl:sr-only">Judge code </span>
                        <span className="text-xl font-bold tracking-[0.2em] text-regal">{code}</span>
                      </p>
                      <QrDialog
                        triggerClassName="btn btn-quiet btn-sm w-9 px-0 pointer-coarse:w-11 @3xl:self-center"
                        // The dialog's button draws the QR mark itself.
                        trigger={<span className="sr-only">Show QR code for {judge.name}</span>}
                        title={judge.name}
                        svg={judgeQrs[i]}
                        label={`QR code that signs in ${judge.name}`}
                      >
                        {/* The tracking trails the last letter too: as much before the first keeps it centred. */}
                        <p className="tabular pl-[0.2em] text-2xl font-bold tracking-[0.2em] text-regal">{code}</p>
                        <p className="mt-2">Scan it with the judge&apos;s phone camera, then tap Start judging.</p>
                      </QrDialog>
                    </>
                  )}
                </div>
                <div className="min-w-0 @3xl:pt-1.5">
                  <DeviceApproval
                    judge={judge}
                    devices={devices.filter((d) => d.judgeId === judge.id)}
                    end={locked ? undefined : <RemoveJudge judge={judge} scored={scored} />}
                  />
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
