"use client";

import { createContext, useContext, useEffect, useId, useRef, useState, useTransition } from "react";
import { reach } from "@/lib/reach";
import type { ActionResult } from "@/lib/types";
import { checkExport } from "../../actions";
import { FormMessage } from "../form-message";

/**
 * Why results downloads are held back, or null: while a score correction is being voted on, a score may still change,
 * so every results link shows disabled with the reason.
 */
export const PdfHold = createContext<string | null>(null);

/** A results link held back (see PdfHold): the same look, disabled, with why. */
export function HeldLink({ reason, className, children }: { reason: string; className: string; children: React.ReactNode }) {
  return (
    <span role="link" aria-disabled="true" title={reason} className={`${className} cursor-not-allowed opacity-50`}>
      {children}
      <span className="sr-only">: {reason}</span>
    </span>
  );
}

/** One download in an export menu: "Results (PDF)", and its query for the export route. */
export type ExportOption = {
  label: string;
  query: string;
  /** Held back while a correction is being voted on (see PdfHold), as results are. The judges' notes aren't. */
  held?: boolean;
};

/**
 * An activity's downloads in one menu: each sheet as a PDF and, where it has one, as CSV (see exports.ts). `context`
 * names what they're of for screen readers, where a page has several menus ("Q&A"). The time zone goes along, so a
 * sheet's printed time matches the venue's clock.
 *
 * The menu is a popover, so a desk that clips its contents (rounded corners, a scrolling program) can't cut it off. It
 * opens below the button, or above it when there's no room below, and closes on a click elsewhere, Escape, or scrolling.
 */
export function ExportMenu({
  activityId,
  options,
  className,
  context,
  align = "left",
}: {
  activityId: string;
  options: ExportOption[];
  className: string;
  context?: string;
  align?: "left" | "right";
}) {
  const hold = useContext(PdfHold);
  const id = `export-${useId().replace(/[^\w-]/g, "")}`;
  const button = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const menu = panel.current;
    if (!menu) return;
    const close = () => menu.hidePopover?.();
    const onToggle = (e: Event) => {
      const opening = (e as ToggleEvent).newState === "open";
      setOpen(opening);
      // Hidden until it's in place, so it never shows for a moment where the browser first puts it.
      menu.style.visibility = "";
      if (!opening) return;
      // Beside its button, on screen: below it, or above when there's no room below.
      const at = button.current?.getBoundingClientRect();
      if (!at) return;
      const height = menu.offsetHeight;
      const width = menu.offsetWidth;
      const below = window.innerHeight - at.bottom >= height + 12;
      menu.style.top = `${Math.max(8, below ? at.bottom + 6 : at.top - height - 6)}px`;
      const left = align === "right" ? at.right - width : at.left;
      menu.style.left = `${Math.min(Math.max(8, left), window.innerWidth - width - 8)}px`;
      menu.style.visibility = "visible";
      window.addEventListener("scroll", close, { capture: true, once: true });
    };
    menu.addEventListener("toggle", onToggle);
    return () => {
      menu.removeEventListener("toggle", onToggle);
      window.removeEventListener("scroll", close, { capture: true });
    };
  }, [align]);

  return (
    <>
      <button ref={button} type="button" popoverTarget={id} aria-expanded={open} className={className}>
        Export
        {context && <span className="sr-only"> {context}</span>}
        <svg viewBox="0 0 16 16" className={`ml-1.5 inline size-3.5 transition-transform ${open ? "rotate-180" : ""}`} aria-hidden>
          <path d="M4 6l4 4 4-4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      <div
        ref={panel}
        id={id}
        popover="auto"
        className="invisible fixed inset-auto m-0 min-w-60 rounded-xl border border-line bg-mint p-1.5 text-left text-sm font-semibold text-prussian shadow-2xl"
      >
        <ul>
          {options.map((option) => {
            const href = `/admin/${activityId}/export${option.query ? `?${option.query}` : ""}`;
            const name = (
              <>
                {option.label}
                {context && <span className="sr-only"> for {context}</span>}
              </>
            );
            const itemClass = "block rounded-lg px-3 py-2.5 hover:bg-wash";
            return (
              <li key={option.query}>
                {hold && option.held !== false ? (
                  <HeldLink reason={hold} className={itemClass}>
                    {name}
                  </HeldLink>
                ) : (
                  <a
                    href={href}
                    onClick={(e) => {
                      e.currentTarget.href = `${href}${option.query ? "&" : "?"}tz=${encodeURIComponent(Intl.DateTimeFormat().resolvedOptions().timeZone)}`;
                      panel.current?.hidePopover?.();
                    }}
                    className={itemClass}
                    download
                  >
                    {name}
                  </a>
                )}
              </li>
            );
          })}
        </ul>
      </div>
    </>
  );
}

/** A sheet's results as PDF and CSV, and (with `judges`) its judges' score sheets and scores too. */
export function sheetOptions(query: string, { judges = false, noun = "Results" }: { judges?: boolean; noun?: string } = {}): ExportOption[] {
  const and = query ? `${query}&` : "";
  return [
    { label: `${noun} (PDF)`, query },
    { label: `${noun} (CSV)`, query: `${and}format=csv` },
    ...(judges
      ? [
          { label: "Judges' score sheets (PDF)", query: `${and}sheet=judges` },
          { label: "Judges' scores (CSV)", query: `${and}sheet=judges&format=csv` },
        ]
      : []),
  ];
}

/**
 * Checks a CSV someone has against this activity's scores: that its rows still match its own fingerprint (nothing was
 * changed after it was exported), and that the fingerprint is one of the sheets the scores give now. The file goes to
 * the server to be checked, so this works on the venue laptop's plain http too.
 */
export function CsvCheck({ activityId, className, onDark = false }: { activityId: string; className: string; onDark?: boolean }) {
  const id = useId();
  const [result, setResult] = useState<ActionResult | null>(null);
  const [pending, start] = useTransition();
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
      <input
        id={id}
        type="file"
        accept=".csv,text/csv"
        className="peer sr-only"
        disabled={pending}
        onChange={(e) => {
          const file = e.currentTarget.files?.[0];
          e.currentTarget.value = "";
          if (!file) return;
          start(async () => {
            setResult(null);
            const text = await file.text();
            setResult(await reach(() => checkExport(activityId, text)));
          });
        }}
      />
      <label htmlFor={id} className={`${className} cursor-pointer peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2`}>
        {pending ? "Checking…" : "Check a CSV"}
      </label>
      <FormMessage state={result} small onDark={onDark} />
    </div>
  );
}
