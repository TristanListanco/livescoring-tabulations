"use client";

import { createContext, useContext, useState } from "react";
import { SIDEBAR_COOKIE, type AdminTheme } from "@/lib/theme";

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

/**
 * Collapses the sidebar to its icons, or opens it again: a small round button on the sidebar's edge, beside the logo,
 * whose chevron turns as the sidebar narrows. Wide screens only.
 */
export function CollapseToggle() {
  const { collapsed, setCollapsed } = useSidebar();
  const label = collapsed ? "Expand sidebar" : "Collapse sidebar";
  return (
    <button
      type="button"
      onClick={() => setCollapsed(!collapsed)}
      aria-expanded={!collapsed}
      aria-label={label}
      title={label}
      className="absolute top-6 -right-3.5 z-10 grid size-7 place-items-center rounded-full border border-line bg-white text-prussian/70 shadow-[0_1px_3px_rgb(11_37_69/0.1)] transition-colors after:absolute after:-inset-2 hover:border-field hover:text-prussian max-lg:hidden"
    >
      <svg viewBox="0 0 16 16" className="sidebar-chevron size-3.5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <path d="M9.75 4.5L6.25 8l3.5 3.5" />
      </svg>
    </button>
  );
}
