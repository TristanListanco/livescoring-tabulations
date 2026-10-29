"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { Avatar } from "@/components/avatar";
import type { AssistanceRequest } from "@/lib/assistance";
import { browserClient } from "@/lib/supabase/browser";
import { answerAssistance, assistanceAlerts } from "../actions";

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

/** A two-note chime, twice, made on the spot (no sound file). Only once the page has been tapped: browsers block sound before. */
function chime(audio: AudioContext | null) {
  if (!audio || audio.state !== "running") return;
  const start = audio.currentTime;
  for (const [frequency, at] of [
    [880, 0],
    [660, 0.18],
    [880, 0.8],
    [660, 0.98],
  ]) {
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
 * Judges' calls for help, on every page of the admin panel. A judge taps Assist me on their screen: here the page blurs
 * behind a dialog listing every call still waiting (several at once stack, oldest first), a chime plays, and the browser
 * shows a notification, so the organizer knows even from another tab. "On my way" answers a call: the judge's screen
 * says so. The dialog stays until every call is answered or taken back.
 *
 * It hears of calls the way live screens hear of changes: over realtime, from the organizer's activities (kept while the
 * tab is out of view, unlike a desk, so a call still reaches a background tab), and by checking every 15 seconds anyway.
 */
export function AssistanceAlerts() {
  const [requests, setRequests] = useState<AssistanceRequest[]>([]);
  const [activityIds, setActivityIds] = useState<string[]>([]);
  const [offer, setOffer] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const dialog = useRef<HTMLDialogElement>(null);
  const audio = useRef<AudioContext | null>(null);
  // The calls already alerted: null before the first check, when every waiting call alerts once.
  const alerted = useRef<Set<string> | null>(null);

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
  }, [arrived]);

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
        role="alertdialog"
        aria-labelledby="assist-title"
        aria-describedby="assist-hint"
        // Escape doesn't dismiss it: each call is answered.
        onCancel={(e) => e.preventDefault()}
        className="m-auto w-[min(32rem,calc(100vw-2rem))] rounded-2xl bg-mint p-0 text-prussian shadow-2xl backdrop:bg-prussian/50 backdrop:backdrop-blur-md"
      >
        <div className="px-6 pt-6">
          <h2 id="assist-title" className="flex items-center gap-2.5 text-xl font-bold">
            <span className="flex size-10 items-center justify-center rounded-full bg-regal text-mint">
              <HandIcon className="size-5" />
            </span>
            {count === 1 ? "A judge needs help" : `${count} judges need help`}
          </h2>
          <p id="assist-hint" className="mt-2 text-[15px] text-prussian/75">
            Tap On my way so they know you&apos;re coming, then go to them.
          </p>
        </div>
        <ul aria-label="Judges asking for help" className="mt-3 max-h-[55vh] divide-y divide-line overflow-y-auto border-t border-line px-6">
          {requests.map((r) => (
            <li key={r.id} className="flex items-center gap-3 py-3.5">
              <Avatar name={r.judgeName} src={r.judgePhotoUrl} size={44} />
              <div className="min-w-0 flex-1">
                <p className="truncate font-semibold">{r.judgeName}</p>
                <p className="truncate text-sm text-prussian/75">
                  {r.activityName} · {ago(r.askedAt, now)}
                </p>
              </div>
              <button type="button" onClick={() => answer(r.id)} className="btn btn-primary btn-sm shrink-0">
                On my way<span className="sr-only"> to {r.judgeName}</span>
              </button>
            </li>
          ))}
        </ul>
        <div className="h-3" />
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
