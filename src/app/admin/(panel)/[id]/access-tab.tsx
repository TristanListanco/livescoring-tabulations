import { QrDialog } from "@/components/qr-dialog";
import { MIN_PROPER_JUDGES } from "@/lib/pageant-setup";
import { qrSvg } from "@/lib/qr";
import type { Judge, JudgeDevice } from "@/lib/types";
import { DeviceApproval, LiveRefresh } from "./judge-devices";
import { AddJudgeForm, JudgeEditor, JudgeIdentity, RemoveJudge } from "./judges-tab";

/**
 * A judge's row in three columns once the card is wide enough (the card is the container): who they are, how they sign
 * in (one button), and their device. Narrower, the judge spans the top and the other two sit side by side; on a phone, they stack.
 */
const ROW_COLUMNS = "@xl:grid-cols-[auto_minmax(0,1fr)] @3xl:grid-cols-[minmax(0,1fr)_auto_minmax(0,15rem)]";

/**
 * The judges, one row each: who they are (changed here until the session starts), their judge code and QR code, and
 * their device, approved here when they read out its pairing code. A pageant with separate boards lists each board
 * apart, in the order they judge: the preliminary's, any judging both segments, then pageant proper's.
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
  properOpen = false,
  ended,
  pageant,
  chairs,
  reset,
}: {
  /** A pageant whose preliminary runs: pageant proper's own judges can still be added, changed and removed. */
  properOpen?: boolean;
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

  // Separate boards: each apart. One board (or an event): one list.
  const separate = pageant && judges.some((j) => j.panel !== "all");
  const groups = separate
    ? [
        { key: "preliminary", title: "Preliminary", judges: judges.filter((j) => j.panel === "preliminary") },
        { key: "all", title: "Both segments", judges: judges.filter((j) => j.panel === "all") },
        { key: "proper", title: "Pageant proper", judges: judges.filter((j) => j.panel === "proper") },
      ].filter((g) => g.judges.length > 0)
    : [{ key: "panel", title: null, judges }];
  // Pageant proper's board: its own judges and those judging both segments.
  const properShort = pageant && judges.filter((j) => j.panel !== "preliminary").length < MIN_PROPER_JUDGES;
  const adding = !locked || properOpen;

  const row = (judge: Judge) => {
    const i = judgeLinks.findIndex((l) => l.judge.id === judge.id);
    const code = judgeLinks[i]?.code ?? "";
    const scored = scoredBy.get(judge.id) ?? 0;
    // How far they've got, once there's something to count: not before the session starts.
    const detail = locked ? `${scored} of ${expected?.[judge.id] ?? entryCount} scored` : "";
    // Their row can change: before the start, or a pageant proper judge until pageant proper starts.
    const open = !locked || (properOpen && judge.panel === "proper");
    return (
      <li key={judge.id} className={`grid items-start gap-x-6 gap-y-4 px-5 py-5 ${ROW_COLUMNS}`}>
        <div className="min-w-0 @xl:col-span-2 @3xl:col-span-1">
          {!open ? (
            <JudgeIdentity judge={judge} detail={detail} pageant={pageant} />
          ) : (
            <JudgeEditor
              judge={judge}
              pageant={pageant}
              detail={detail}
              fixedPanel={locked}
              canChair={chairs && !judge.isChair && (chaired.has(judge.panel) || !pageant)}
            />
          )}
        </div>
        {/*
          How the judge signs in, behind one button: the QR code to scan, the judge code to type ("judge code", as the
          judge portal asks for it), and the link to send, in a dialog large enough to scan from the screen.
        */}
        <div className="flex items-center @xl:pl-16 @3xl:pt-1 @3xl:pl-0">
          {code && (
            <QrDialog
              triggerClassName="btn btn-quiet btn-sm gap-1.5"
              // The dialog's button draws the QR mark itself.
              trigger={
                <>
                  Sign-in<span className="sr-only"> QR code, code and link for {judge.name}</span>
                </>
              }
              title={judge.name}
              svg={judgeQrs[i]}
              label={`QR code that signs in ${judge.name}`}
              link={judgeLinks[i].url}
            >
              <p className="tabular">
                <span className="block text-xs font-semibold text-prussian/70">Judge code </span>
                {/* The tracking trails the last letter too: as much before the first keeps it centred. */}
                <span className="block pl-[0.2em] text-2xl font-bold tracking-[0.2em] text-regal">{code}</span>
              </p>
              <p className="mt-2">Scan it with the judge&apos;s phone camera and tap Start judging, or send them the link.</p>
            </QrDialog>
          )}
        </div>
        <div className="min-w-0 @3xl:pt-1.5">
          <DeviceApproval judge={judge} devices={devices.filter((d) => d.judgeId === judge.id)} end={open ? <RemoveJudge judge={judge} scored={scored} /> : undefined} />
        </div>
      </li>
    );
  };

  return (
    // Marked, so a device asking to be approved here isn't also shown in the panel's dialog (see AssistanceAlerts).
    <div className="max-w-4xl" data-device-approvals={activityId}>
      <LiveRefresh activityId={activityId} ended={ended} />
      <h2 className="sr-only">Judges</h2>
      {/* No judge portal link to hand out: judges scan their QR code, or type their code at the portal. */}
      {locked && (
        <p role="note" className="note mt-4">
          {reset
            ? "The scores were reset, but judging has started before: the panel of judges stays as it was, and the same judges score again."
            : properOpen
              ? "The preliminary has started, so its judges are locked. Judges of pageant proper only can still be added and changed until it starts."
              : "The session has started, so the panel of judges is locked."}
        </p>
      )}
      {properShort && (
        <p role="note" className="note mt-4">
          Pageant proper needs at least three judges before it starts.
        </p>
      )}

      <p role="status" className={`mt-6 font-semibold ${waiting ? "text-regal" : "sr-only"}`}>
        {waiting ? `${waiting} ${waiting === 1 ? "device is" : "devices are"} waiting for approval.` : "No devices are waiting for approval."}
      </p>
      {separate ? (
        <>
          {groups.map((group) => {
            const chair = group.judges.find((j) => j.isChair);
            return (
              <section key={group.key} aria-labelledby={`board-${group.key}`} className="mt-6">
                <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                  <h3 id={`board-${group.key}`} className="title-sm">
                    {group.title}
                  </h3>
                  <p className="hint tabular">
                    {group.judges.length} {group.judges.length === 1 ? "judge" : "judges"}
                    {chair && ` · Chair: ${chair.name}`}
                  </p>
                </div>
                <div className="card @container mt-3 overflow-hidden">
                  <ul className="divide-y divide-line">{group.judges.map(row)}</ul>
                </div>
              </section>
            );
          })}
          {adding && (
            <div className="card @container mt-6 overflow-hidden">
              <AddJudgeForm activityId={activityId} pageant={pageant} properOnly={locked} first />
            </div>
          )}
        </>
      ) : (
        /* The panel, then (until the session starts) adding a judge as the card's last row, in the same shape as theirs. */
        <div className="card @container mt-3 overflow-hidden">
          {judges.length === 0 && <p className={`px-5 text-[15px] text-prussian/75 ${locked ? "py-5" : "pt-5"}`}>No judges yet.</p>}
          <ul className="divide-y divide-line">{judges.map(row)}</ul>
          {adding && <AddJudgeForm activityId={activityId} pageant={pageant} properOnly={locked} first={judges.length === 0} />}
        </div>
      )}
    </div>
  );
}
