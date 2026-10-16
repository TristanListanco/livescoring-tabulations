"use client";

import { useId, useRef, useState, useTransition, type ReactNode } from "react";
import type { ActionResult } from "@/lib/types";

type Props = {
  /** Text and style of the button that opens the dialog. */
  triggerLabel: ReactNode;
  triggerClassName: string;
  triggerDisabled?: boolean;
  /** Keys that also press the trigger (aria-keyshortcuts), e.g. "ArrowRight Space". */
  triggerKeyShortcuts?: string;
  title: string;
  children: ReactNode;
  confirmLabel: string;
  tone?: "primary" | "danger";
  /** When set, the confirm button stays disabled until this exact text is typed. */
  requireText?: string;
  /** When set, asks for a password (with this label) and passes it to onConfirm, which checks it. */
  passwordLabel?: string;
  onConfirm: (password: string) => Promise<ActionResult | void>;
};

export function ConfirmDialog({
  triggerLabel,
  triggerClassName,
  triggerDisabled,
  triggerKeyShortcuts,
  title,
  children,
  confirmLabel,
  tone = "primary",
  requireText,
  passwordLabel,
  onConfirm,
}: Props) {
  const ref = useRef<HTMLDialogElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const titleId = useId();
  const bodyId = useId();
  const [typed, setTyped] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const open = () => {
    setTyped("");
    setError(null);
    ref.current?.showModal();
  };

  const confirm = () =>
    startTransition(async () => {
      const result = await onConfirm(typed);
      if (result && !result.ok) {
        setError(result.error);
        return;
      }
      ref.current?.close();
    });

  const blocked = (requireText !== undefined && typed.trim() !== requireText) || (passwordLabel !== undefined && typed === "");

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={open}
        className={triggerClassName}
        disabled={triggerDisabled}
        aria-keyshortcuts={triggerKeyShortcuts}
      >
        {triggerLabel}
      </button>
      <dialog
        ref={ref}
        // Opened from a keyboard shortcut, nothing had focus to return to, so the browser would leave it on the
        // hidden Cancel button. Hand it back to the button that opened the dialog.
        onClose={() => {
          if (ref.current?.contains(document.activeElement)) triggerRef.current?.focus();
        }}
        aria-labelledby={titleId}
        aria-describedby={bodyId}
        // It sits beside its trigger, which can be in a right-aligned table cell or a dark panel: it sets its own text.
        className="m-auto w-[min(30rem,calc(100vw-2rem))] rounded-2xl bg-mint p-0 text-left text-[15px] font-normal tracking-normal whitespace-normal text-prussian normal-case shadow-2xl"
      >
        <div className="px-6 pt-6 sm:px-7 sm:pt-7">
          <div className="flex items-start gap-4">
            {/* Something that can't be undone is marked, so it reads as a warning before a word of it. */}
            {tone === "danger" && (
              <span aria-hidden className="flex size-10 shrink-0 items-center justify-center rounded-full bg-danger/10 text-danger">
                <svg viewBox="0 0 20 20" className="size-5">
                  <path d="M10 3l7.5 13h-15L10 3z" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" />
                  <path d="M10 8.2v3.6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
                  <circle cx="10" cy="14.3" r="1" fill="currentColor" />
                </svg>
              </span>
            )}
            <div className="min-w-0 flex-1">
              <h2 id={titleId} className="text-xl leading-snug font-bold text-balance wrap-anywhere">
                {title}
              </h2>
              <div id={bodyId} className="mt-2 leading-relaxed text-prussian/75 wrap-anywhere [&_strong]:font-semibold [&_strong]:text-prussian">
                {children}
              </div>
            </div>
          </div>
          {requireText !== undefined && (
            <label className="mt-5 block">
              <span className="label">
                Type <span className="rounded bg-wash px-1.5 py-0.5 font-bold">{requireText}</span> to confirm
              </span>
              <input
                className="field"
                value={typed}
                onChange={(e) => setTyped(e.target.value)}
                autoComplete="off"
                autoCapitalize="off"
                spellCheck={false}
              />
            </label>
          )}
          {passwordLabel !== undefined && (
            <label className="mt-5 block">
              <span className="label">{passwordLabel}</span>
              <input
                type="password"
                className="field"
                value={typed}
                onChange={(e) => setTyped(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && !blocked && !pending && confirm()}
                autoComplete="current-password"
              />
            </label>
          )}
          {error && (
            <p role="alert" className="mt-3 text-sm font-semibold text-danger">
              {error}
            </p>
          )}
        </div>
        {/* The answer last, on the right; on a phone the two share the width, in the same order. */}
        <div className="mt-6 grid grid-cols-2 gap-2 px-6 pb-6 sm:flex sm:justify-end sm:gap-3 sm:px-7 sm:pb-7">
          <button type="button" className="btn btn-quiet max-sm:h-12" onClick={() => ref.current?.close()} disabled={pending}>
            Cancel
          </button>
          <button
            type="button"
            className={`btn max-sm:h-12 ${tone === "danger" ? "btn-danger" : "btn-primary"}`}
            onClick={confirm}
            disabled={blocked || pending}
          >
            {pending ? "Working…" : confirmLabel}
          </button>
        </div>
      </dialog>
    </>
  );
}
