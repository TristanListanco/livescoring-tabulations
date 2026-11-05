"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { archivedActivities } from "../actions";
import { useSidebar } from "./sidebar-shell";
import { SIDEBAR_IDLE, SIDEBAR_ROW } from "./sidebar-styles";

/**
 * Archived activities, in the sidebar: closed until opened, and read then (skeleton rows while they arrive), so the
 * panel's other pages never wait on them. With the sidebar down to its icons, opening it opens the sidebar too.
 */
export function ArchivedNav() {
  const { collapsed, setCollapsed } = useSidebar();
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [list, setList] = useState<{ id: string; name: string }[] | null>(null);
  const [failed, setFailed] = useState(false);

  const toggle = () => {
    const next = collapsed || !open;
    if (collapsed) setCollapsed(false);
    setOpen(next);
    if (next) {
      setFailed(false);
      archivedActivities().then(setList, () => setFailed(true));
    }
  };

  return (
    <div>
      <button type="button" onClick={toggle} aria-expanded={open && !collapsed} title="Archived" className={`${SIDEBAR_ROW} ${SIDEBAR_IDLE}`}>
        <svg viewBox="0 0 20 20" className="size-5 shrink-0" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path d="M3 4.5h14v3H3zM4 7.5v7a1 1 0 001 1h10a1 1 0 001-1v-7M8 10.5h4" />
        </svg>
        <span className="sidebar-label flex flex-1 items-center justify-between">
          Archived
          <svg viewBox="0 0 16 16" className={`size-4 transition-transform ${open ? "rotate-90" : ""}`} aria-hidden>
            <path d="M6 3.5l4.5 4.5L6 12.5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </span>
      </button>
      {open && (
        <div className="sidebar-expanded-only mt-1 mb-2 ml-[1.375rem] border-l border-line pl-3">
          {failed ? (
            <p role="alert" className="py-1.5 pl-3 text-sm text-danger">
              Couldn&apos;t load them.
            </p>
          ) : list === null ? (
            <ul aria-busy="true" aria-label="Loading archived activities" className="space-y-1 py-1">
              {[0, 1, 2].map((i) => (
                <li key={i} className="skeleton mx-3 my-2.5 h-4" style={{ width: `${[72, 56, 64][i]}%` }} />
              ))}
            </ul>
          ) : list.length === 0 ? (
            <p className="py-1.5 pl-3 text-sm text-prussian/70">None yet</p>
          ) : (
            <ul>
              {list.map((a) => {
                const here = pathname === `/admin/${a.id}`;
                return (
                  <li key={a.id}>
                    <Link
                      href={`/admin/${a.id}`}
                      aria-current={here ? "page" : undefined}
                      title={a.name}
                      className={`block truncate rounded-lg px-3 py-2 text-sm ${here ? "bg-white font-medium text-prussian" : "text-prussian/70 hover:bg-white/60 hover:text-prussian"}`}
                    >
                      {a.name}
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
