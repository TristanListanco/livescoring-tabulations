import { Avatar } from "@/components/avatar";
import { Qr } from "@/components/qr";
import { qrSvg } from "@/lib/qr";
import type { Judge, JudgeDevice } from "@/lib/types";
import { LinkField } from "../link-field";
import { DeviceApproval, LiveRefresh } from "./judge-devices";

export async function AccessTab({
  activityId,
  devices,
  origin,
  judges,
  codes,
  scoredBy,
  entryCount,
}: {
  activityId: string;
  devices: JudgeDevice[];
  origin: string;
  judges: Judge[];
  codes: Map<string, string>;
  scoredBy: Map<string, number>;
  entryCount: number;
}) {
  const portalUrl = `${origin}/judge`;
  const judgeLinks = judges.map((j) => {
    const code = codes.get(j.id) ?? "";
    return { judge: j, code, url: `${origin}/judge/join/${code}` };
  });
  const judgeQrs = await Promise.all(judgeLinks.map((l) => qrSvg(l.url)));
  const waiting = devices.filter((d) => d.status === "pending").length;

  return (
    <div className="max-w-4xl space-y-12">
      <LiveRefresh activityId={activityId} />
      <section>
        <h2 className="text-xl font-bold">Judge devices</h2>
        <p className="mt-2 max-w-2xl text-[15px] leading-relaxed text-prussian/80">
          Each judge signs in at the judge portal with their judge code, or scans their QR code. Approve the device showing the pairing code
          they read out: only an approved device can score.
        </p>
        <p className="label mt-5">Judge portal</p>
        <LinkField url={portalUrl} />

        <p role="status" className={`mt-6 font-semibold ${waiting ? "text-regal" : "sr-only"}`}>
          {waiting ? `${waiting} ${waiting === 1 ? "device is" : "devices are"} waiting for approval.` : "No devices are waiting for approval."}
        </p>
        <ul className="mt-3 divide-y divide-line border-y border-line">
          {judgeLinks.map(({ judge, code }, i) => (
            <li key={judge.id} className="py-4">
              <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
                <div className="flex min-w-48 flex-1 items-center gap-3">
                  <Avatar name={judge.name} src={judge.photoUrl} size={44} />
                  <div className="min-w-0">
                    <p className="flex min-w-0 items-center gap-2">
                      <span className="truncate font-semibold">{judge.name}</span>
                      {judge.isChair && (
                        <span className="shrink-0 rounded-full bg-wash px-2 py-0.5 text-xs font-semibold">
                        Chair<span className="sr-only"> of the board of judges</span>
                      </span>
                      )}
                    </p>
                    <p className="hint tabular">
                      {scoredBy.get(judge.id) ?? 0} of {entryCount} scored
                    </p>
                  </div>
                </div>
                {/* Called "judge code" here because that's what the judge portal asks them for. */}
                <p className="tabular">
                  <span className="block text-xs font-semibold text-prussian/70">Judge code </span>
                  <span className="text-2xl font-bold tracking-[0.2em] text-regal">{code}</span>
                </p>
              </div>
              <DeviceApproval judge={judge} devices={devices.filter((d) => d.judgeId === judge.id)} />
              <details className="group mt-2 sm:pl-14">
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
            </li>
          ))}
        </ul>
        {judges.length === 0 && <p className="hint mt-4">Add judges in the Judges tab to get their codes.</p>}
      </section>
    </div>
  );
}
