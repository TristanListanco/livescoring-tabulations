"use client";

import { useState } from "react";
import { flushSync } from "react-dom";
import { THEME_COOKIE, type AdminTheme } from "@/lib/theme";
import { SIDEBAR_IDLE, SIDEBAR_ROW } from "./sidebar-styles";

/**
 * Light or dark admin panel. Remembered in this browser; the server reads it so pages render in the right theme.
 *
 * The switch spreads from the toggle: the new theme opens out in a circle over the old (a view transition, see
 * ::view-transition in globals.css), while the sun turns into the moon. Where view transitions aren't supported, or with
 * reduced motion, it changes at once.
 */
export function ThemeToggle({ initial }: { initial: AdminTheme }) {
  const [theme, setTheme] = useState(initial);
  const toggle = (e: React.MouseEvent<HTMLButtonElement>) => {
    const next: AdminTheme = theme === "dark" ? "light" : "dark";
    document.cookie = `${THEME_COOKIE}=${next}; path=/admin; max-age=31536000; samesite=lax`;
    const apply = () => {
      flushSync(() => setTheme(next));
      document.querySelector("[data-admin-theme]")?.setAttribute("data-theme", next);
    };
    if (!document.startViewTransition || matchMedia("(prefers-reduced-motion: reduce)").matches) return apply();

    const { left, top, width, height } = e.currentTarget.getBoundingClientRect();
    const x = left + width / 2;
    const y = top + height / 2;
    // Far enough to reach the farthest corner of the window.
    const r = Math.hypot(Math.max(x, innerWidth - x), Math.max(y, innerHeight - y));
    document.startViewTransition(apply).ready.then(() =>
      document.documentElement.animate(
        { clipPath: [`circle(0 at ${x}px ${y}px)`, `circle(${r}px at ${x}px ${y}px)`] },
        { duration: 520, easing: "cubic-bezier(0.16, 1, 0.3, 1)", pseudoElement: "::view-transition-new(root)" },
      ),
    );
  };

  return (
    <button type="button" onClick={toggle} aria-pressed={theme === "dark"} title="Dark mode" className={`${SIDEBAR_ROW} ${SIDEBAR_IDLE}`}>
      <span data-dark={theme === "dark" || undefined} className="theme-icon relative size-5 shrink-0">
        <svg viewBox="0 0 20 20" className="theme-sun absolute inset-0" aria-hidden>
          <circle cx="10" cy="10" r="3.6" fill="none" stroke="currentColor" strokeWidth="1.6" />
          <path
            d="M10 1.8v2.2M10 16v2.2M1.8 10H4M16 10h2.2M4.2 4.2l1.6 1.6M14.2 14.2l1.6 1.6M4.2 15.8l1.6-1.6M14.2 5.8l1.6-1.6"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
          />
        </svg>
        <svg viewBox="0 0 20 20" className="theme-moon absolute inset-0" aria-hidden>
          <path d="M16.5 12.2A7 7 0 017.8 3.5a7 7 0 108.7 8.7z" fill="currentColor" />
        </svg>
      </span>
      <span className="sidebar-label">Dark mode</span>
    </button>
  );
}
