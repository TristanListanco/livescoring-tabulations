"use client";

import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { useMediaQuery } from "@/lib/use-media-query";
import { CopyButton } from "./copy-button";
import { Qr } from "./qr";

type OrientationPermission = { requestPermission?: () => Promise<"granted" | "denied"> };
/** iOS asks before a page can read the device's tilt, and only from a tap. Elsewhere there's nothing to ask. */
const askForTilt = () =>
  typeof DeviceOrientationEvent === "undefined" ? undefined : (DeviceOrientationEvent as unknown as OrientationPermission).requestPermission;

/** Tipped less than this from flat (front to back and side to side), a phone or tablet is lying down; more than LIFTED, held up. */
const FLAT = 20;
const LIFTED = 32;

/**
 * Whether a phone or tablet is lying flat while the QR code is up: then it's hidden, since anyone passing the table
 * could scan it, and it shows again as soon as the device is held up to a judge (a little further, so it doesn't
 * flicker at the edge). Laptops have no tilt to read: always shown. The tilt is read on the device only.
 */
function useLyingFlat(open: boolean): boolean {
  const touch = useMediaQuery("(any-pointer: coarse)");
  const [flat, setFlat] = useState(false);
  useEffect(() => {
    if (!open || !touch || typeof DeviceOrientationEvent === "undefined") return;
    const onTilt = (e: DeviceOrientationEvent) => {
      if (e.beta === null || e.gamma === null) return;
      const tipped = Math.max(Math.abs(e.beta), Math.abs(e.gamma));
      setFlat((was) => (was ? tipped < LIFTED : tipped < FLAT));
    };
    window.addEventListener("deviceorientation", onTilt);
    return () => {
      window.removeEventListener("deviceorientation", onTilt);
      setFlat(false);
    };
  }, [open, touch]);
  return open && touch && flat;
}

/**
 * A QR code behind a button: it opens in a dialog, large enough for a phone's camera from across the desk, with what
 * scanning it does under it. Closed with Close, Escape or the backdrop. On a phone or tablet it hides while the device
 * lies flat (see useLyingFlat).
 */
export function QrDialog({
  trigger,
  triggerClassName,
  title,
  svg,
  label,
  link,
  children,
}: {
  /** The address the QR code opens, shown under it with Copy link: to send it rather than show it. */
  link?: string;
  /** The button's text; with the QR glyph before it. */
  trigger: ReactNode;
  triggerClassName: string;
  title: ReactNode;
  svg: string;
  /** What the QR code is, for screen readers. */
  label: string;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const [open, setOpen] = useState(false);
  const flat = useLyingFlat(open);
  const close = () => ref.current?.close();
  const show = () => {
    // On iOS, reading the tilt is asked for here, from the tap; refused, the code simply stays shown.
    askForTilt()?.().catch(() => {});
    ref.current?.showModal();
    setOpen(true);
  };
  return (
    <>
      <button type="button" aria-haspopup="dialog" className={triggerClassName} onClick={show}>
        <svg viewBox="0 0 16 16" className="size-3.5 shrink-0" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden>
          <rect x="2" y="2" width="4.5" height="4.5" rx="1" />
          <rect x="9.5" y="2" width="4.5" height="4.5" rx="1" />
          <rect x="2" y="9.5" width="4.5" height="4.5" rx="1" />
          <path d="M9.5 9.5h2v2M14 9.5v.5M11.5 14H14v-2M9.5 14h.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        {trigger}
      </button>
      <dialog
        ref={ref}
        aria-labelledby={titleId}
        onClose={() => setOpen(false)}
        onClick={(e) => e.target === e.currentTarget && close()}
        className="m-auto w-[min(23rem,calc(100vw-2rem))] rounded-2xl bg-mint p-0 text-center text-[15px] text-prussian shadow-2xl"
      >
        <div className="px-6 pt-6 pb-6 sm:px-7">
          <h2 id={titleId} className="title-sm wrap-anywhere">
            {title}
          </h2>
          <div className="relative mx-auto mt-5 size-64 max-w-full">
            <div className={`transition-[filter,opacity] duration-200 ${flat ? "opacity-40 blur-xl" : ""}`} aria-hidden={flat || undefined}>
              <Qr svg={svg} label={label} className="size-64 max-w-full" />
            </div>
            {flat && (
              <p role="status" className="absolute inset-0 flex flex-col items-center justify-center gap-2 px-6 font-semibold text-balance">
                <svg viewBox="0 0 24 24" className="size-7" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                  <rect x="6.5" y="2.5" width="11" height="19" rx="2.5" />
                  <path d="M10.5 18.5h3" />
                </svg>
                Hidden while it lies flat. Hold it up to show the code.
              </p>
            )}
          </div>
          <div className="mt-4 leading-relaxed text-balance text-prussian/75">{children}</div>
          {link && (
            <div className="mt-4 flex items-center gap-2 text-left">
              <code className="tabular min-w-0 flex-1 truncate rounded-full border border-line bg-white px-3.5 py-2 text-sm" title={link}>
                {link.replace(/^https?:\/\//, "")}
              </code>
              <CopyButton value={link} label="Copy link" ariaLabel={`Copy link: ${link}`} className="btn btn-quiet btn-sm shrink-0" />
            </div>
          )}
          <button type="button" className="btn btn-quiet mt-6 w-full" onClick={close}>
            Close
          </button>
        </div>
      </dialog>
    </>
  );
}
