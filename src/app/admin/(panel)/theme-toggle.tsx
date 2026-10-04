"use client";

import { useState } from "react";
import { THEME_COOKIE, type AdminTheme } from "@/lib/theme";

/** Light or dark admin panel. Remembered in this browser; the server reads it so pages render in the right theme. */
export function ThemeToggle({ initial }: { initial: AdminTheme }) {
  const [theme, setTheme] = useState(initial);
  const toggle = () => {
    const next: AdminTheme = theme === "dark" ? "light" : "dark";
    setTheme(next);
    document.cookie = `${THEME_COOKIE}=${next}; path=/admin; max-age=31536000; samesite=lax`;
    document.querySelector("[data-admin-theme]")?.setAttribute("data-theme", next);
  };

  return (
    <button type="button" onClick={toggle} aria-pressed={theme === "dark"} className="btn btn-sm text-powder hover:bg-oxford hover:text-mint">
      {theme === "dark" ? (
        <svg viewBox="0 0 20 20" className="size-4" aria-hidden>
          <path d="M16.5 12.2A7 7 0 017.8 3.5a7 7 0 108.7 8.7z" fill="currentColor" />
        </svg>
      ) : (
        <svg viewBox="0 0 20 20" className="size-4" aria-hidden>
          <circle cx="10" cy="10" r="3.6" fill="none" stroke="currentColor" strokeWidth="1.8" />
          <path
            d="M10 1.8v2.2M10 16v2.2M1.8 10H4M16 10h2.2M4.2 4.2l1.6 1.6M14.2 14.2l1.6 1.6M4.2 15.8l1.6-1.6M14.2 5.8l1.6-1.6"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
          />
        </svg>
      )}
      <span className="sr-only sm:not-sr-only">Dark mode</span>
    </button>
  );
}
