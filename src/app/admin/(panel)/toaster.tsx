"use client";

import { unstable_rethrow } from "next/navigation";
import { useEffect, useState } from "react";

type Toast = { id: number; text: string; leaving: boolean };

/** The panel's toaster, once it's on the page (see Toaster): one per panel, kept across its pages. */
let show: ((text: string) => void) | null = null;
let ids = 0;

/** Confirms something done (archived, deleted, saved), at the top of the panel, wherever the organizer goes next. */
export function toast(text: string) {
  show?.(text);
}

/**
 * For an action that, when it works, goes on to another page (deleting an activity, creating one): its redirect is how
 * it says so, and that's when `text` shows. An error or a lost request goes on as before, with no toast.
 */
export async function toastOnRedirect<T>(action: Promise<T>, text: string): Promise<T> {
  try {
    return await action;
  } catch (error) {
    try {
      unstable_rethrow(error);
    } catch {
      toast(text);
    }
    throw error;
  }
}

const SHOWN_MS = 3200;
const LEAVING_MS = 200;

/**
 * Toasts drop in at the top of the page, over its title rather than the buttons at the foot of a form, stay a few
 * seconds and lift away (see .toast in globals.css), the newest last, three at most. Centred on the page beside the
 * sidebar. Read out politely, not as a status the page's own messages compete with.
 */
export function Toaster() {
  const [toasts, setToasts] = useState<Toast[]>([]);
  useEffect(() => {
    show = (text) => {
      const id = ++ids;
      setToasts((list) => [...list.slice(-2), { id, text, leaving: false }]);
      setTimeout(() => setToasts((list) => list.map((t) => (t.id === id ? { ...t, leaving: true } : t))), SHOWN_MS);
      setTimeout(() => setToasts((list) => list.filter((t) => t.id !== id)), SHOWN_MS + LEAVING_MS);
    };
    return () => {
      show = null;
    };
  }, []);

  return (
    <div aria-live="polite" className="toaster pointer-events-none fixed inset-x-0 top-4 z-50 flex flex-col items-center gap-2 px-4 lg:top-6">
      {toasts.map((t) => (
        <p
          key={t.id}
          className={`toast flex max-w-full items-center gap-2.5 rounded-full bg-prussian py-2.5 pr-5 pl-2.5 text-[15px] font-semibold text-mint shadow-[0_12px_32px_rgb(11_37_69/0.28)] ${t.leaving ? "toast-leaving" : ""}`}
        >
          <span aria-hidden className="grid size-7 shrink-0 place-items-center rounded-full bg-mint/15">
            <svg viewBox="0 0 16 16" className="toast-tick size-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path pathLength={1} d="M3.5 8.5l3 3 6-7" />
            </svg>
          </span>
          <span className="min-w-0 truncate">{t.text}</span>
        </p>
      ))}
    </div>
  );
}
