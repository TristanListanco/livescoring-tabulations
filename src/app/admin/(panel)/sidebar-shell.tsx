"use client";

import { createContext, useContext, useState } from "react";
import { SIDEBAR_COOKIE, type AdminTheme } from "@/lib/theme";
import { SIDEBAR_IDLE, SIDEBAR_ROW } from "./sidebar-styles";

const Collapse = createContext<{ collapsed: boolean; setCollapsed: (collapsed: boolean) => void }>({ collapsed: false, setCollapsed: () => {} });

/** Whether the sidebar is down to its icons (wide screens only; the phones' drawer is always open), and the way to change it. */
export const useSidebar = () => useContext(Collapse);

/**
 * The panel's outermost element: its theme (see ThemeToggle) and whether the sidebar is collapsed, which the sidebar's
 * styles follow (`[data-sidebar]` in globals.css). Collapsing is remembered in this browser, and the server reads it
 * so the page arrives that way.
 */
export function SidebarShell({ theme, initialCollapsed, children }: { theme: AdminTheme; initialCollapsed: boolean; children: React.ReactNode }) {
  const [collapsed, setState] = useState(initialCollapsed);
  const setCollapsed = (next: boolean) => {
    setState(next);
    document.cookie = `${SIDEBAR_COOKIE}=${next ? "collapsed" : "open"}; path=/admin; max-age=31536000; samesite=lax`;
  };
  return (
    <Collapse value={{ collapsed, setCollapsed }}>
      <div data-admin-theme data-theme={theme} data-sidebar={collapsed ? "collapsed" : "open"} className="min-h-dvh bg-mint text-prussian lg:flex">
        {children}
      </div>
    </Collapse>
  );
}

/** Collapses the sidebar to its icons, or opens it again. Wide screens only. */
export function CollapseToggle() {
  const { collapsed, setCollapsed } = useSidebar();
  return (
    <button
      type="button"
      onClick={() => setCollapsed(!collapsed)}
      aria-expanded={!collapsed}
      title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
      className={`${SIDEBAR_ROW} ${SIDEBAR_IDLE} max-lg:hidden`}
    >
      <svg viewBox="0 0 20 20" className="size-5 shrink-0" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <rect x="3" y="3.5" width="14" height="13" rx="3" />
        <path d="M8 3.5v13" />
        <path d={collapsed ? "M11 8.5l1.75 1.5L11 11.5" : "M13 8.5L11.25 10 13 11.5"} />
      </svg>
      <span className="sidebar-label">{collapsed ? "Expand sidebar" : "Collapse sidebar"}</span>
    </button>
  );
}
