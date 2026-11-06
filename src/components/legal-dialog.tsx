"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef } from "react";
import { Wordmark } from "./brand";

/**
 * The privacy policy or the terms of service, opened from a link in the app: a dialog over the page, its text in the
 * reading styles of the full page (.legal), and one way out, Close (or Escape, or the backdrop), back to where it was
 * opened. Its own address still opens as a full page (see the (legal) layout).
 */
export function LegalDialog({ label, children }: { label: string; children: React.ReactNode }) {
  const router = useRouter();
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    if (ref.current && !ref.current.open) ref.current.showModal();
  }, []);
  const close = () => router.back();

  return (
    <dialog
      ref={ref}
      aria-label={label}
      onCancel={(e) => {
        e.preventDefault();
        close();
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) close();
      }}
      className="legal-dialog m-auto w-[min(46rem,calc(100vw-2rem))] max-w-none overflow-hidden rounded-2xl bg-mint p-0 text-[17px] text-prussian shadow-2xl"
    >
      <div className="flex max-h-[min(85dvh,56rem)] flex-col">
        <div className="flex items-center justify-between gap-4 border-b border-line px-6 py-3 sm:px-10">
          <span className="text-regal">
            <Wordmark />
          </span>
          <button type="button" onClick={close} className="btn btn-quiet btn-sm">
            Close
          </button>
        </div>
        <div className="legal overflow-y-auto px-6 pt-6 pb-10 sm:px-10">{children}</div>
      </div>
    </dialog>
  );
}
