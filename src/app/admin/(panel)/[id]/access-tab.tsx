import QRCode from "qrcode";
import { Avatar } from "@/components/avatar";
import { CopyButton } from "@/components/copy-button";
import type { Judge, JudgeDevice } from "@/lib/types";
import { DeviceApproval, LiveRefresh } from "./judge-devices";

async function qrSvg(url: string): Promise<string> {
  return QRCode.toString(url, { type: "svg", margin: 1, errorCorrectionLevel: "M", color: { dark: "#0b2545", light: "#ffffff" } });
}

function Qr({ svg, label }: { svg: string; label: string }) {
  return (
    <div
      role="img"
      aria-label={label}
      className="size-44 overflow-hidden rounded-lg border border-line bg-white p-2 [&>svg]:size-full"
      // Generated locally by the qrcode library from our own URL.
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
}

export async function AccessTab({
  activityId,
  devices,
  origin,
  liveUrl,
  ledUrl,
  judges,
  codes,
  scoredBy,
  entryCount,
}: {
  activityId: string;
  devices: JudgeDevice[];
  origin: string;
  liveUrl: string;
  ledUrl: string;
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
  const [liveQr, ...judgeQrs] = await Promise.all([qrSvg(liveUrl), ...judgeLinks.map((l) => qrSvg(l.url))]);
  const waiting = devices.filter((d) => d.status === "pending").length;

  return (
    <div className="space-y-12">
      <LiveRefresh activityId={activityId} />
      <section>
        <h2 className="text-xl font-bold">Judge portal</h2>
        <p className="hint mt-1 max-w-2xl">
          Open this link on each judge&apos;s device and enter their code, or scan a judge&apos;s QR code to sign that device in directly. The device
          then shows a pairing code: approve the request below whose code the judge reads to you. Judges can sign in any time; their screen waits
          until you start the session.
        </p>
        <div className="mt-4 flex max-w-2xl items-center gap-2">
          <code className="tabular min-w-0 flex-1 truncate rounded-lg border border-line bg-white px-3 py-2.5 text-[15px]">{portalUrl}</code>
          <CopyButton value={portalUrl} />
        </div>

        <p role="status" className={`mt-6 font-semibold ${waiting ? "text-regal" : "sr-only"}`}>
          {waiting ? `${waiting} ${waiting === 1 ? "device is" : "devices are"} waiting for approval.` : "No devices are waiting for approval."}
        </p>
        <ul className="mt-3 divide-y divide-line border-y border-line">
          {judgeLinks.map(({ judge, code, url }, i) => (
            <li key={judge.id} className="py-4">
              <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
                <div className="flex min-w-48 flex-1 items-center gap-3">
                  <Avatar name={judge.name} src={judge.photoUrl} size={44} />
                  <div className="min-w-0">
                    <p className="flex min-w-0 items-center gap-2">
                      <span className="truncate font-semibold">{judge.name}</span>
                      {judge.canMoveEntries && <span className="shrink-0 rounded-full bg-wash px-2 py-0.5 text-xs font-semibold">Moves entries</span>}
                    </p>
                    <p className="hint tabular">
                      {scoredBy.get(judge.id) ?? 0} of {entryCount} scored
                    </p>
                  </div>
                </div>
                <p className="tabular text-2xl font-bold tracking-[0.2em] text-regal">
                  <span className="sr-only">Code </span>
                  {code}
                </p>
                <div className="flex gap-2">
                  <CopyButton value={code} label="Copy code" />
                  <CopyButton value={url} label="Copy link" />
                </div>
              </div>
              <DeviceApproval judge={judge} devices={devices.filter((d) => d.judgeId === judge.id)} />
              <details className="group mt-2 sm:pl-14">
                <summary className="cursor-pointer text-sm font-semibold text-regal select-none hover:underline">
                  <span className="group-open:hidden">Show QR code</span>
                  <span className="hidden group-open:inline">Hide QR code</span>
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

      <section>
        <h2 className="text-xl font-bold">Public live results</h2>
        <p className="hint mt-1 max-w-2xl">
          Anyone with this link sees each entry&apos;s scores from every judge and the average, updating as scores come in. Put it on the venue screen or share it with the audience.
        </p>
        <div className="mt-4 flex max-w-2xl items-center gap-2">
          <code className="tabular min-w-0 flex-1 truncate rounded-lg border border-line bg-white px-3 py-2.5 text-[15px]">{liveUrl}</code>
          <CopyButton value={liveUrl} />
        </div>
        <div className="mt-4">
          <Qr svg={liveQr} label="QR code for the live results page" />
        </div>
      </section>

      <section>
        <h2 className="text-xl font-bold">LED wall</h2>
        <p className="hint mt-1 max-w-2xl">
          One entry&apos;s scores, for the LED wall or video switcher. It follows the entry on the judges&apos; screens. You can also pick one in the LED
          wall tab.
        </p>
        <div className="mt-4 flex max-w-2xl items-center gap-2">
          <code className="tabular min-w-0 flex-1 truncate rounded-lg border border-line bg-white px-3 py-2.5 text-[15px]">{ledUrl}</code>
          <CopyButton value={ledUrl} />
        </div>
      </section>
    </div>
  );
}
