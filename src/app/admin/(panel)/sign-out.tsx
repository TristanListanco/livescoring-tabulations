"use client";

import { ConfirmDialog } from "@/components/confirm-dialog";
import { logout } from "../actions";
import { SIDEBAR_IDLE, SIDEBAR_ROW } from "./sidebar-styles";

/** Signing out, from the sidebar: it asks first, so a stray tap mid-show doesn't drop the organizer out of the panel. */
export function SignOut() {
  return (
    <ConfirmDialog
      triggerLabel={
        <>
          <svg viewBox="0 0 20 20" className="size-5 shrink-0" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M8 4H5.5A1.5 1.5 0 004 5.5v9A1.5 1.5 0 005.5 16H8M12.5 7l3 3-3 3M15.5 10H8" />
          </svg>
          <span className="sidebar-label">Sign out</span>
        </>
      }
      triggerClassName={`${SIDEBAR_ROW} ${SIDEBAR_IDLE}`}
      title="Sign out?"
      confirmLabel="Sign out"
      onConfirm={() => logout()}
    >
      You&apos;ll need your email and password to sign in again. Judges and screens carry on as they are.
    </ConfirmDialog>
  );
}
