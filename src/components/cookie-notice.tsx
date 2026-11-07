"use client";

import Link from "next/link";
import { useState, useSyncExternalStore } from "react";

/** Kept in the browser's storage once the notice is acknowledged (listed in the cookie policy). */
const NOTED = "tabulous:cookies-noted";

const subscribe = (onChange: () => void) => {
  window.addEventListener("storage", onChange);
  return () => window.removeEventListener("storage", onChange);
};
const noted = () => {
  try {
    return localStorage.getItem(NOTED) !== null;
  } catch {
    return false;
  }
};

/**
 * Where people first arrive (the start page, the judges' and organizers' sign-in), once per browser: Tabulous sets only
 * essential cookies, which need no consent, so this says so and links to the cookie policy rather than offering a choice
 * with nothing behind it. In the page's flow at the top, so it never covers a button. Not on the live results or the LED
 * wall, which are on screens in front of an audience and set no cookies. The server renders it as already seen, so a
 * returning visitor never sees it flash.
 */
/** `linked`: false where the page already links the cookie policy close by (the judges' sign-in), so it isn't there twice. */
export function CookieNotice({ dark = false, linked = true, className = "" }: { dark?: boolean; linked?: boolean; className?: string }) {
  const seen = useSyncExternalStore(subscribe, noted, () => true);
  const [dismissed, setDismissed] = useState(false);
  if (seen || dismissed) return null;

  const ok = () => {
    setDismissed(true);
    try {
      localStorage.setItem(NOTED, "1");
    } catch {
      // Without storage it comes back next visit; that's all.
    }
  };
  return (
    <div
      role="region"
      aria-label="Cookies"
      className={`cookie-notice flex flex-wrap items-center gap-x-4 gap-y-2 rounded-xl border px-4 py-3 text-sm ${
        dark ? "border-oxford bg-oxford/50 text-powder" : "border-line bg-white text-prussian/80"
      } ${className}`}
    >
      <p className="min-w-0 flex-1 basis-60">
        Tabulous uses only essential cookies, to keep you signed in and remember your settings.{" "}
        {linked ? (
          <Link href="/cookies" className={`font-semibold underline underline-offset-2 ${dark ? "text-mint" : "text-regal"}`}>
            Cookie policy
          </Link>
        ) : (
          "The cookie policy below says which."
        )}
      </p>
      <button type="button" onClick={ok} className={`btn btn-sm shrink-0 ${dark ? "bg-mint text-prussian hover:bg-white" : "btn-quiet"}`}>
        OK
      </button>
    </div>
  );
}
