"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { Avatar } from "@/components/avatar";
import type { AssistanceRequest, WaitingDevice } from "@/lib/assistance";
import { reach } from "@/lib/reach";
import { browserClient } from "@/lib/supabase/browser";
import { answerAssistance, approveDevice, assistanceAlerts, revokeDevice } from "../actions";
import { toast } from "./toaster";

/** How often the alert checks for calls, whatever realtime says: the safety net, as on every live screen. */
const CHECK_MS = 15_000;
/** Every this many checks, the list of activities to listen to is read again (a new activity, an archived one). */
const IDS_EVERY = 4;
/** Notices of changes arriving together make one check. */
const NOTICE_GAP_MS = 800;
/** Where this browser remembers the organizer answered the offer to turn alerts on. */
const ASKED_KEY = "tabulous:assist-alerts-asked";

/** A raised hand. */
function HandIcon({ className = "size-6" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={`shrink-0 ${className}`} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M8 13V5.5a1.5 1.5 0 0 1 3 0V12M11 11.5v-8a1.5 1.5 0 0 1 3 0V12M14 12V5.5a1.5 1.5 0 0 1 3 0V14M17 9.5a1.5 1.5 0 0 1 3 0V15a7 7 0 0 1-7 7h-1a7 7 0 0 1-5.6-2.8L3.6 15.4a1.6 1.6 0 0 1 2.5-2l1.9 2" />
    </svg>
  );
}

/** A phone. */
function DeviceIcon({ className = "size-6" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={`shrink-0 ${className}`} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <rect x="6.5" y="2.5" width="11" height="19" rx="2.5" />
      <path d="M10.5 18.5h3" />
    </svg>
  );
}

/** A judge's call: a two-note chime, twice, falling. */
const CALL: [number, number][] = [
  [880, 0],
  [660, 0.18],
  [880, 0.8],
  [660, 0.98],
];
/** A device asking to be approved: one rising pair, gentler than a call for help. */
const KNOCK: [number, number][] = [
  [660, 0],
  [990, 0.16],
];

/** A chime made on the spot (no sound file). Only once the page has been tapped: browsers block sound before. */
function chime(audio: AudioContext | null, notes: [number, number][] = CALL) {
  if (!audio || audio.state !== "running") return;
  const start = audio.currentTime;
  for (const [frequency, at] of notes) {
    const tone = audio.createOscillator();
    const gain = audio.createGain();
    tone.type = "sine";
    tone.frequency.value = frequency;
    gain.gain.setValueAtTime(0.0001, start + at);
    gain.gain.exponentialRampToValueAtTime(0.3, start + at + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + at + 0.35);
    tone.connect(gain).connect(audio.destination);
    tone.start(start + at);
    tone.stop(start + at + 0.4);
  }
}

/** "just now", "3 min ago". */
function ago(at: string, now: number): string {
  const minutes = Math.floor((now - Date.parse(at)) / 60_000);
  return minutes < 1 ? "just now" : `${minutes} min ago`;
}

const notificationsOffered = () => typeof window !== "undefined" && "Notification" in window && Notification.permission === "default";

/**
 * The activity whose Judges tab (or desk) is open, if one is: its devices are approved in the list right there, so they
 * don't pop up over it. Unless another dialog is open over that list: then they come up on top, where the organizer is
 * looking.
 */
const judgesTabOpen = () => {
  const id = document.querySelector("[data-device-approvals]")?.getAttribute("data-device-approvals") ?? null;
  return id && !document.querySelector("dialog[open]:not([data-alerts])") ? id : null;
};
const watchPage = (onChange: () => void) => {
  const watcher = new MutationObserver(onChange);
  // A dialog opening or closing changes its open attribute; it isn't a new element.
  watcher.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["open", "data-device-approvals"] });
  return () => watcher.disconnect();
};

/**
 * Judges' calls for help, and their devices waiting for approval, on every page of the admin panel.
 *
 * A judge taps Assist me on their screen: here the page blurs behind a navy dialog listing every call still waiting
 * (several at once stack, oldest first), a chime plays, and the browser shows a notification, so the organizer knows even
 * from another tab. "On my way" answers a call: the judge's screen says so. The dialog stays until every call is answered
 * or taken back.
 *
 * A judge signs in on a device: a gentler chime, and a dialog asks the organizer to approve it wherever they are (on
 * that activity's Judges tab the list there does it, with the chime, unless a dialog is open over the list). It shows the
 * pairing code the judge reads out, so the right device is approved; Later puts it away until another device asks. It
 * stacks over any dialog already open, a call for help's too, as a call for help stacks over it.
 *
 * It hears of both the way live screens hear of changes: over realtime, from the organizer's activities (kept while the
 * tab is out of view, unlike a desk, so a call still reaches a background tab), and by checking every 15 seconds anyway.
 */
export function AssistanceAlerts() {
  const [requests, setRequests] = useState<AssistanceRequest[]>([]);
  const [devices, setDevices] = useState<WaitingDevice[]>([]);
  // Devices put off with Later: they wait on the Judges tab, and the dialog comes back only for a new one.
  const [later, setLater] = useState<ReadonlySet<string>>(new Set());
  const [deviceErrors, setDeviceErrors] = useState<Record<string, string>>({});
  const [activityIds, setActivityIds] = useState<string[]>([]);
  const [offer, setOffer] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const dialog = useRef<HTMLDialogElement>(null);
  const deviceDialog = useRef<HTMLDialogElement>(null);
  const audio = useRef<AudioContext | null>(null);
  // The calls and devices already alerted: null before the first check, when every waiting one alerts once.
  const alerted = useRef<Set<string> | null>(null);
  const knocked = useRef<Set<string> | null>(null);
  const here = useSyncExternalStore(watchPage, judgesTabOpen, () => null);

  // Only refs and state setters inside, so these never change: effects and buttons share them.
  const arrived = useCallback((list: AssistanceRequest[]) => {
    const fresh = list.filter((r) => !alerted.current?.has(r.id));
    alerted.current = new Set(list.map((r) => r.id));
    setRequests(list);
    setNow(Date.now());
    if (!fresh.length) return;
    chime(audio.current);
    if ("Notification" in window && Notification.permission === "granted") {
      for (const r of fresh) {
        const notice = new Notification(`${r.judgeName} needs help`, { body: `${r.activityName}: they've asked you to come over.`, tag: r.id });
        notice.onclick = () => window.focus();
      }
    }
  }, []);

  const signedIn = useCallback((list: WaitingDevice[]) => {
    const fresh = list.filter((d) => !knocked.current?.has(d.id));
    knocked.current = new Set(list.map((d) => d.id));
    setDevices(list);
    if (!fresh.length) return;
    // A new device brings the dialog back, with the ones put off before.
    setLater(new Set());
    // On its Judges tab too, where the list shows it: the organizer may be looking away from the screen.
    chime(audio.current, KNOCK);
    if ("Notification" in window && Notification.permission === "granted") {
      for (const d of fresh.filter((f) => f.activityId !== judgesTabOpen())) {
        const notice = new Notification(`${d.judgeName}'s device is waiting`, { body: `${d.activityName}: approve it when they read out its pairing code.`, tag: d.id });
        notice.onclick = () => window.focus();
      }
    }
  }, []);

  const check = useCallback(async (withIds: boolean) => {
    const result = await assistanceAlerts(withIds).catch(() => null);
    if (!result) return;
    if (result.activityIds) {
      const ids = result.activityIds;
      setActivityIds((current) => (current.join() === ids.join() ? current : ids));
      let asked = false;
      try {
        asked = localStorage.getItem(ASKED_KEY) !== null;
      } catch {}
      setOffer(ids.length > 0 && notificationsOffered() && !asked);
    }
    if (result.requests) arrived(result.requests);
    if (result.devices) signedIn(result.devices);
  }, [arrived, signedIn]);

  // Checks: at once, then every 15 seconds, and whenever the page comes back into view or online.
  useEffect(() => {
    let count = 0;
    let timer: ReturnType<typeof setTimeout>;
    const loop = (gap: number) => {
      timer = setTimeout(() => {
        void check(count % IDS_EVERY === 0);
        count++;
        loop(CHECK_MS);
      }, gap);
    };
    loop(0);
    const again = () => void check(false);
    window.addEventListener("focus", again);
    window.addEventListener("online", again);
    document.addEventListener("visibilitychange", again);
    return () => {
      clearTimeout(timer);
      window.removeEventListener("focus", again);
      window.removeEventListener("online", again);
      document.removeEventListener("visibilitychange", again);
    };
  }, [check]);

  // Realtime: any change to the organizer's activities (a call is one) makes a check.
  useEffect(() => {
    if (!activityIds.length) return;
    const supabase = browserClient();
    let wait: ReturnType<typeof setTimeout> | undefined;
    const heard = () => {
      clearTimeout(wait);
      wait = setTimeout(() => void check(false), NOTICE_GAP_MS);
    };
    const filter = `activity_id=in.(${activityIds.join(",")})`;
    const channel: RealtimeChannel = supabase
      .channel(`assistance:${Math.random().toString(36).slice(2, 10)}`)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "activity_changes", filter }, heard)
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "activity_changes", filter }, heard)
      .subscribe();
    return () => {
      clearTimeout(wait);
      void supabase.removeChannel(channel);
    };
  }, [activityIds, check]);

  // Browsers play sound only after the page has been tapped or typed in: the first one readies the chime.
  useEffect(() => {
    const ready = () => {
      const Context = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Context) return;
      audio.current ??= new Context();
      void audio.current.resume();
    };
    window.addEventListener("pointerdown", ready);
    window.addEventListener("keydown", ready);
    return () => {
      window.removeEventListener("pointerdown", ready);
      window.removeEventListener("keydown", ready);
    };
  }, []);

  // The dialog is open exactly while calls are waiting, and "2 min ago" keeps up.
  useEffect(() => {
    const open = requests.length > 0;
    const shown = dialog.current;
    if (!shown) return;
    if (open && !shown.open) shown.showModal();
    if (!open && shown.open) shown.close();
    if (!open) return;
    const tick = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(tick);
  }, [requests.length]);

  // Devices to approve here: not those of the Judges tab that's open, nor those put off with Later.
  const shownDevices = devices.filter((d) => d.activityId !== here);
  const devicesOpen = shownDevices.some((d) => !later.has(d.id));
  useEffect(() => {
    const shown = deviceDialog.current;
    if (!shown) return;
    if (devicesOpen && !shown.open) {
      shown.showModal();
      // Nothing chosen for the organizer: Approve waits until the judge has read out the code, so focus starts on the dialog.
      shown.focus();
    }
    if (!devicesOpen && shown.open) shown.close();
  }, [devicesOpen]);

  const decide = async (device: WaitingDevice, approve: boolean) => {
    const result = await reach(() => (approve ? approveDevice(device.id) : revokeDevice(device.id)));
    if (!result.ok) {
      setDeviceErrors((all) => ({ ...all, [device.id]: result.error }));
      return;
    }
    // Approving one signs out the judge's others, so their other requests go too.
    setDevices((list) => list.filter((d) => d.id !== device.id && !(approve && d.judgeId === device.judgeId)));
    toast(approve ? `${device.judgeName}'s device approved` : `${device.judgeName}'s request turned away`);
    void check(false);
  };

  const answer = async (id: string) => {
    setRequests((list) => list.filter((r) => r.id !== id));
    const result = await answerAssistance(id).catch(() => null);
    if (!result?.ok) void check(false);
  };

  const turnOn = async () => {
    try {
      localStorage.setItem(ASKED_KEY, "1");
    } catch {}
    setOffer(false);
    if ("Notification" in window) await Notification.requestPermission();
    chime(audio.current);
  };

  const count = requests.length;
  return (
    <>
      <dialog
        ref={dialog}
        data-alerts
        role="alertdialog"
        aria-labelledby="assist-title"
        // Escape doesn't dismiss it: each call is answered.
        onCancel={(e) => e.preventDefault()}
        className="keep-light m-auto w-[min(34rem,calc(100vw-2rem))] overflow-hidden rounded-[1.5rem] bg-prussian p-0 text-mint shadow-2xl ring-1 ring-oxford backdrop:bg-prussian/60 backdrop:backdrop-blur-md"
      >
        <div className="flex items-center gap-4 px-6 pt-7 sm:px-7">
          {/* The hand rings for attention, the way the call does (still, with reduced motion). */}
          <span className="relative flex size-14 shrink-0 items-center justify-center">
            <span aria-hidden className="assist-ring absolute inset-0 rounded-full bg-mint/30" />
            <span className="relative flex size-14 items-center justify-center rounded-full bg-mint text-prussian">
              <HandIcon className="wave size-7" />
            </span>
          </span>
          <div className="min-w-0">
            <h2 id="assist-title" className="text-[1.75rem] leading-tight font-light tracking-[-0.02em] text-balance wrap-anywhere">
              {count === 1 ? `${requests[0].judgeName} needs help` : `${count} judges need help`}
            </h2>
            <p className="mt-1 text-[15px] text-powder">{count === 1 ? "They've asked you to come over." : "They've asked you to come over, oldest first."}</p>
          </div>
        </div>
        <ul aria-label="Judges asking for help" className="mt-5 max-h-[55vh] space-y-2 overflow-y-auto px-4 pb-5 sm:px-5">
          {requests.map((r) => (
            <li key={r.id} className="flex items-center gap-3 rounded-2xl bg-oxford/70 px-3 py-3 sm:px-4">
              <Avatar name={r.judgeName} src={r.judgePhotoUrl} size={48} />
              <div className="min-w-0 flex-1">
                <p className="truncate text-[17px] font-semibold">{r.judgeName}</p>
                <p className="truncate text-sm text-powder">
                  {r.activityName} · {ago(r.askedAt, now)}
                </p>
              </div>
              <button type="button" onClick={() => answer(r.id)} className="btn shrink-0 bg-mint text-prussian hover:bg-white">
                On my way<span className="sr-only"> to {r.judgeName}</span>
              </button>
            </li>
          ))}
        </ul>
      </dialog>

      {/* Devices waiting for approval: the light dialog of the panel, quieter than a call for help. */}
      <dialog
        ref={deviceDialog}
        data-alerts
        tabIndex={-1}
        aria-labelledby="devices-title"
        onCancel={(e) => {
          e.preventDefault();
          setLater(new Set(shownDevices.map((d) => d.id)));
        }}
        className="m-auto w-[min(36rem,calc(100vw-2rem))] rounded-2xl bg-mint p-0 text-prussian shadow-2xl"
      >
        <div className="flex items-start gap-4 px-6 pt-6 sm:px-7 sm:pt-7">
          <span className="flex size-11 shrink-0 items-center justify-center rounded-full bg-prussian text-mint">
            <DeviceIcon className="size-5" />
          </span>
          <div className="min-w-0">
            <h2 id="devices-title" className="title-sm wrap-anywhere">
              {shownDevices.length === 1 ? `${shownDevices[0]?.judgeName}'s device is waiting` : `${shownDevices.length} devices are waiting`}
            </h2>
            <p className="mt-1 text-[15px] text-prussian/75">Approve a device when its judge reads out the same pairing code.</p>
          </div>
        </div>
        <ul aria-label="Devices waiting for approval" className="mt-4 max-h-[55vh] divide-y divide-line overflow-y-auto border-y border-line px-6 sm:px-7">
          {shownDevices.map((d) => (
            <li key={d.id} className="py-3.5">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-2.5">
                <Avatar name={d.judgeName} src={d.judgePhotoUrl} size={44} />
                <div className="min-w-0 flex-1 basis-40">
                  <p className="truncate font-semibold">{d.judgeName}</p>
                  <p className="truncate text-sm text-prussian/75">
                    {d.activityName} · {d.label}
                  </p>
                </div>
                <span className="flex items-center gap-2">
                  <span className="text-xs font-semibold text-prussian/70">Pairing code</span>
                  <span className="tabular rounded-md bg-prussian px-2.5 py-1 text-lg font-bold tracking-[0.2em] text-mint">{d.pairingCode}</span>
                </span>
              </div>
              <div className="mt-3 flex gap-2 sm:pl-14">
                <button type="button" onClick={() => decide(d, true)} className="btn btn-primary btn-sm" aria-label={`Approve ${d.judgeName}'s device ${d.pairingCode}`}>
                  Approve
                </button>
                <button type="button" onClick={() => decide(d, false)} className="btn btn-quiet btn-sm" aria-label={`Deny ${d.judgeName}'s device ${d.pairingCode}`}>
                  Deny
                </button>
              </div>
              {deviceErrors[d.id] && (
                <p role="alert" className="mt-2 text-sm font-semibold text-danger sm:pl-14">
                  {deviceErrors[d.id]}
                </p>
              )}
            </li>
          ))}
        </ul>
        <div className="flex justify-end px-6 py-4 sm:px-7">
          <button type="button" onClick={() => setLater(new Set(shownDevices.map((d) => d.id)))} className="btn btn-quiet">
            Later
          </button>
        </div>
      </dialog>
      {offer && (
        <div
          role="region"
          aria-label="Alerts for judges' calls"
          className="fixed right-4 bottom-4 z-40 flex max-w-sm flex-col gap-3 rounded-2xl bg-prussian p-4 text-mint shadow-2xl keep-light"
        >
          <p className="flex items-start gap-2.5 text-[15px]">
            <HandIcon className="mt-0.5 size-5" />
            Get a sound and a notification when a judge asks for help, even from another tab.
          </p>
          <div className="flex gap-2">
            <button type="button" onClick={turnOn} className="btn btn-sm bg-mint text-prussian hover:bg-white">
              Turn on
            </button>
            <button
              type="button"
              onClick={() => {
                try {
                  localStorage.setItem(ASKED_KEY, "0");
                } catch {}
                setOffer(false);
              }}
              className="btn btn-sm text-powder hover:bg-oxford hover:text-mint"
            >
              Not now
            </button>
          </div>
        </div>
      )}
    </>
  );
}
