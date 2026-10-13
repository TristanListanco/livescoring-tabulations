import type { KeyboardEvent } from "react";

/** Marks a text field as a line of a list that Enter steps through (see enterToNext). */
export const NEXT_LINE = { "data-next-line": "" } as const;

/**
 * Enter in a list's field goes to its next line, the way a score sheet is filled in, rather than submitting the
 * form. At the last line `atEnd` runs (e.g. to add one). Enter with Shift or a modifier key, or while an input
 * method is still composing, is left alone.
 */
export function enterToNext(e: KeyboardEvent<HTMLInputElement>, list: HTMLElement | null, atEnd?: () => void) {
  if (e.key !== "Enter" || e.shiftKey || e.altKey || e.ctrlKey || e.metaKey || e.nativeEvent.isComposing) return;
  e.preventDefault();
  const fields = [...(list?.querySelectorAll<HTMLInputElement>("[data-next-line]") ?? [])];
  const next = fields[fields.indexOf(e.currentTarget) + 1];
  if (next) next.focus();
  else atEnd?.();
}

/**
 * A row's buttons as one stop in the Tab order, a toolbar: Left and Right move between them, Home and End go to
 * the ends. For the toolbar's onKeyDown; its first enabled button takes tabIndex 0 and the others -1.
 */
export function roveToolbar(e: KeyboardEvent<HTMLElement>) {
  if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(e.key)) return;
  const buttons = [...e.currentTarget.querySelectorAll<HTMLButtonElement>("button:not(:disabled)")];
  const at = buttons.indexOf(document.activeElement as HTMLButtonElement);
  if (at < 0) return;
  e.preventDefault();
  const last = buttons.length - 1;
  const next = e.key === "Home" ? 0 : e.key === "End" ? last : e.key === "ArrowLeft" ? (at === 0 ? last : at - 1) : at === last ? 0 : at + 1;
  buttons[next].focus();
}
