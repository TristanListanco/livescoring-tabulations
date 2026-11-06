"use client";

import Link from "next/link";
import { createContext, useContext, useEffect, useRef, useState } from "react";
import { archivedActivities } from "../actions";
import { useSidebar } from "./sidebar-shell";
import { SIDEBAR_IDLE, SIDEBAR_OPEN, SIDEBAR_ROW } from "./sidebar-styles";

/** The archived activity open in the panel, if any: its tabs (`tree`) go under it in the Archived list. */
export type OpenArchived = { id: string; name: string; tree: React.ReactNode };

export const OpenArchivedContext = createContext<{ open: OpenArchived | null; setOpen: (open: OpenArchived | null) => void }>({
  open: null,
  setOpen: () => {},
});

/**
 * Rendered by an archived activity's tree in the sidebar's slot (see ActivityTree) in place of the tree itself: it hands
 * its tabs to the Archived list, which shows them under the activity, where it was opened from.
 */
export function ArchivedHere({ id, name, children }: { id: string; name: string; children: React.ReactNode }) {
  const { setOpen } = useContext(OpenArchivedContext);
  useEffect(() => {
    setOpen({ id, name, tree: children });
    return () => setOpen(null);
  }, [id, name, children, setOpen]);
  return null;
}

/**
 * Archived activities, in the sidebar: closed until opened, and read then (fading in as they arrive), so the
 * panel's other pages never wait on them. With an archived activity open, it opens by itself, and that activity's tabs
 * hang under it. With the sidebar down to its icons, opening it opens the sidebar too.
 */
export function ArchivedNav() {
  const { collapsed, setCollapsed } = useSidebar();
  const { open: here } = useContext(OpenArchivedContext);
  // Opened or closed by hand; until then, open while an archived activity is.
  const [chosen, setChosen] = useState<boolean | null>(null);
  const expanded = chosen ?? here !== null;
  const [list, setList] = useState<{ id: string; name: string }[] | null>(null);
  const [failed, setFailed] = useState(false);
  const requested = useRef(false);

  // Read the first time it opens, and again each time it's opened by hand.
  useEffect(() => {
    if (!expanded || requested.current) return;
    requested.current = true;
    archivedActivities().then(setList, () => setFailed(true));
  }, [expanded]);

  const toggle = () => {
    const next = collapsed || !expanded;
    if (collapsed) setCollapsed(false);
    if (next) {
      requested.current = false;
      setFailed(false);
    }
    setChosen(next);
  };

  // The open one shows at once, even before the list arrives (or if it was archived since the list was read).
  const items = list ? (here && !list.some((a) => a.id === here.id) ? [here, ...list] : list) : here ? [here] : null;

  return (
    <div>
      <button
        type="button"
        onClick={toggle}
        aria-expanded={expanded && !collapsed}
        title="Archived"
        className={`${SIDEBAR_ROW} ${here ? SIDEBAR_OPEN : SIDEBAR_IDLE}`}
      >
        <svg viewBox="0 0 20 20" className="size-5 shrink-0" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path d="M3 4.5h14v3H3zM4 7.5v7a1 1 0 001 1h10a1 1 0 001-1v-7M8 10.5h4" />
        </svg>
        <span className="sidebar-label flex flex-1 items-center justify-between">
          Archived
          <svg viewBox="0 0 16 16" className={`size-4 transition-transform ${expanded ? "rotate-90" : ""}`} aria-hidden>
            <path d="M6 3.5l4.5 4.5L6 12.5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </span>
      </button>
      {expanded && (
        <div className="sidebar-expanded-only mt-1 mb-2 ml-[1.375rem] border-l border-line pl-3">
          {failed ? (
            <p role="alert" className="py-1.5 pl-3 text-sm text-danger">
              Couldn&apos;t load them.
            </p>
          ) : items === null ? (
            // Nothing to show until they arrive, then they fade in (no placeholder rows for a short list).
            <p role="status" className="sr-only">
              Loading archived activities
            </p>
          ) : items.length === 0 ? (
            <p className="archived-list py-1.5 pl-3 text-sm text-prussian/70">None yet</p>
          ) : (
            <ul className="archived-list">
              {items.map((a) => {
                const open = here?.id === a.id;
                return (
                  <li key={a.id}>
                    <Link
                      href={`/admin/${a.id}`}
                      // With tabs under it, the open tab is the page and the activity the way to it; without, it's the page.
                      aria-current={open ? (here.tree ? "true" : "page") : undefined}
                      title={a.name}
                      className={`block truncate rounded-lg px-3 py-2 text-sm ${
                        open ? `font-semibold text-prussian ${here.tree ? "" : SIDEBAR_OPEN}` : "text-prussian/70 hover:bg-white/60 hover:text-prussian"
                      }`}
                    >
                      {a.name}
                    </Link>
                    {open && here.tree}
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
