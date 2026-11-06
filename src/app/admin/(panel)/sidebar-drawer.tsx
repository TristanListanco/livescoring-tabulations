"use client";

import { useRef, useState } from "react";

/** How long the drawer takes to slide away (see .sidebar-drawer): its contents stay until it has. */
const CLOSING_MS = 220;

/**
 * The sidebar on phones and tablets, where there's no room to keep it open: a Menu button that opens it as a drawer
 * from the left (.sidebar-drawer). Following any link in it closes it, as does Escape or a tap outside it. Its contents
 * are only there while it's open, so the page never has the sidebar twice.
 */
export function SidebarDrawer({ children }: { children: React.ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  const [open, setOpen] = useState(false);
  const close = () => ref.current?.close();

  return (
    <>
      <button
        type="button"
        onClick={() => {
          setOpen(true);
          ref.current?.showModal();
        }}
        aria-haspopup="dialog"
        className="btn btn-sm btn-quiet lg:hidden"
      >
        <svg viewBox="0 0 20 20" className="size-5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" aria-hidden>
          <path d="M3.5 6h13M3.5 10h13M3.5 14h13" />
        </svg>
        Menu
      </button>
      <dialog
        ref={ref}
        aria-label="Menu"
        onClose={() => setTimeout(() => setOpen(ref.current?.open ?? false), CLOSING_MS)}
        onClick={(e) => {
          // A tap on the backdrop lands on the dialog itself; a tap on a link closes it as the page changes.
          if (e.target === ref.current || (e.target as Element).closest("a")) close();
        }}
        className="sidebar-drawer fixed inset-y-0 left-0 m-0 h-dvh max-h-none w-[min(20rem,calc(100vw-3rem))] bg-mint p-0 text-prussian shadow-2xl lg:hidden"
      >
        <div className="flex min-h-full flex-col px-4 pt-3 pb-6">
          <button type="button" onClick={close} className="btn btn-sm self-end text-prussian/70 hover:bg-white/60" aria-label="Close menu">
            <svg viewBox="0 0 20 20" className="size-5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" aria-hidden>
              <path d="M5 5l10 10M15 5L5 15" />
            </svg>
          </button>
          {open && children}
        </div>
      </dialog>
    </>
  );
}
