"use client";

import { useId, useRef, useState, useTransition, type ReactNode } from "react";
import type { ActionResult } from "@/lib/types";

type Props = {
  /** Text and style of the button that opens the dialog. */
  triggerLabel: ReactNode;
  triggerClassName: string;
  triggerDisabled?: boolean;
  title: string;
  children: ReactNode;
  confirmLabel: string;
  tone?: "primary" | "danger";
  /** When set, the confirm button stays disabled until this exact text is typed. */
  requireText?: string;
  onConfirm: () => Promise<ActionResult | void>;
};

export function ConfirmDialog({ triggerLabel, triggerClassName, triggerDisabled, title, children, confirmLabel, tone = "primary", requireText, onConfirm }: Props) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
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
      const result = await onConfirm();
      if (result && !result.ok) {
        setError(result.error);
        return;
      }
      ref.current?.close();
    });

  const blocked = requireText !== undefined && typed.trim() !== requireText;

  return (
    <>
      <button type="button" onClick={open} className={triggerClassName} disabled={triggerDisabled}>
        {triggerLabel}
      </button>
      <dialog
        ref={ref}
        aria-labelledby={titleId}
        className="m-auto w-[min(28rem,calc(100vw-2rem))] rounded-2xl bg-mint p-0 text-prussian shadow-2xl"
      >
        <div className="p-6">
          <h2 id={titleId} className="text-xl font-bold">
            {title}
          </h2>
          <div className="mt-2 text-[15px] leading-relaxed text-prussian/80">{children}</div>
          {requireText !== undefined && (
            <label className="mt-4 block">
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
          {error && (
            <p role="alert" className="mt-3 text-sm font-semibold text-danger">
              {error}
            </p>
          )}
        </div>
        <div className="flex justify-end gap-2 border-t border-line bg-wash/60 px-6 py-4">
          <button type="button" className="btn btn-quiet" onClick={() => ref.current?.close()} disabled={pending}>
            Cancel
          </button>
          <button
            type="button"
            className={`btn ${tone === "danger" ? "btn-danger" : "btn-primary"}`}
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
