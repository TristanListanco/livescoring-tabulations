"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type RefObject } from "react";

/**
 * Asks before unsaved changes are lost. Reloading or closing the tab gets the browser's own "Leave site?" prompt;
 * links and forms elsewhere in the admin (the header, Sign out) get a dialog that can save a draft first. `form` is
 * the form being protected: submitting it is never stopped.
 */
export function useLeaveGuard({ dirty, form, save }: { dirty: boolean; form: RefObject<HTMLFormElement | null>; save: () => Promise<boolean> }) {
  const router = useRouter();
  // What to do if the organizer leaves anyway: follow the link, submit the form, or switch the form shown.
  const [leave, setLeave] = useState<(() => void) | null>(null);
  const released = useRef(false);

  useEffect(() => {
    if (!dirty) return;
    released.current = false;
    const beforeUnload = (e: BeforeUnloadEvent) => {
      if (released.current) return;
      e.preventDefault();
      // Older browsers show the prompt only when returnValue is set.
      e.returnValue = "";
    };
    // Capture phase on the document runs before React and Next.js see the click or submit.
    const click = (e: MouseEvent) => {
      if (released.current || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const link = e.target instanceof Element ? e.target.closest<HTMLAnchorElement>("a[href]") : null;
      if (!link || (link.target && link.target !== "_self") || link.hasAttribute("download")) return;
      const url = new URL(link.href, window.location.href);
      // Another site: the browser's own prompt covers it. The same page (a #fragment): nothing is lost.
      if (url.origin !== window.location.origin || (url.pathname === window.location.pathname && url.search === window.location.search)) return;
      e.preventDefault();
      e.stopPropagation();
      setLeave(() => () => router.push(`${url.pathname}${url.search}${url.hash}`));
    };
    const submit = (e: SubmitEvent) => {
      const target = e.target;
      if (released.current || !(target instanceof HTMLFormElement) || target === form.current || target.closest("dialog")) return;
      e.preventDefault();
      e.stopPropagation();
      const submitter = e.submitter;
      setLeave(() => () => target.requestSubmit(submitter instanceof HTMLButtonElement ? submitter : undefined));
    };
    window.addEventListener("beforeunload", beforeUnload);
    document.addEventListener("click", click, true);
    document.addEventListener("submit", submit, true);
    return () => {
      window.removeEventListener("beforeunload", beforeUnload);
      document.removeEventListener("click", click, true);
      document.removeEventListener("submit", submit, true);
    };
  }, [dirty, form, router]);

  const go = (then: (() => void) | null) => {
    released.current = true;
    setLeave(null);
    then?.();
  };

  return {
    /** Run `then` now if nothing is unsaved, or once the organizer chooses to leave. */
    confirm: (then: () => void) => (dirty ? setLeave(() => then) : then()),
    dialog: <LeaveDialog open={leave !== null} onStay={() => setLeave(null)} onLeave={() => go(leave)} onSave={async () => (await save()) && go(leave)} />,
  };
}

function LeaveDialog({ open, onStay, onLeave, onSave }: { open: boolean; onStay: () => void; onLeave: () => void; onSave: () => Promise<unknown> }) {
  const ref = useRef<HTMLDialogElement>(null);
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    const dialog = ref.current;
    if (open && dialog && !dialog.open) dialog.showModal();
    if (!open && dialog?.open) dialog.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      onCancel={onStay}
      aria-labelledby="leave-title"
      className="m-auto w-[min(35rem,calc(100vw-2rem))] rounded-2xl bg-mint p-0 text-prussian shadow-2xl"
    >
      <div className="p-6">
        <h2 id="leave-title" className="text-xl font-bold">
          Leave without saving?
        </h2>
        <p className="mt-2 text-[15px] leading-relaxed text-prussian/80">
          Your changes since the last saved draft will be lost. Save a draft to pick up where you left off, from the Activities page.
        </p>
      </div>
      <div className="flex flex-wrap justify-end gap-2 border-t border-line bg-wash/60 px-6 py-4">
        <button type="button" className="btn btn-quiet mr-auto" onClick={onStay} disabled={saving} autoFocus>
          Stay
        </button>
        <button type="button" className="btn btn-danger-quiet" onClick={onLeave} disabled={saving}>
          Leave without saving
        </button>
        <button
          type="button"
          className="btn btn-primary"
          disabled={saving}
          onClick={async () => {
            setSaving(true);
            await onSave();
            setSaving(false);
          }}
        >
          {saving ? "Saving…" : "Save draft and leave"}
        </button>
      </div>
    </dialog>
  );
}
