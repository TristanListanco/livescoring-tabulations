"use client";

import { useCallback, useSyncExternalStore } from "react";

const CHANGED = "livescoring:device-setting";
/** Where settings live when the browser won't store them (private browsing, storage off): until the page reloads. */
const memory = new Map<string, string>();

function read(key: string): string | null {
  try {
    return localStorage.getItem(key) ?? memory.get(key) ?? null;
  } catch {
    return memory.get(key) ?? null;
  }
}

/**
 * A small preference remembered on this device, such as whether a judge keeps the criterion guide open. The server
 * render uses the fallback; without browser storage, a change lasts until the page reloads.
 */
export function useDeviceSetting<T>(key: string, fallback: T): [T, (value: T) => void] {
  const subscribe = useCallback(
    (onChange: () => void) => {
      const listener = (e: Event) => {
        if (!(e instanceof StorageEvent) || e.key === key) onChange();
      };
      window.addEventListener("storage", listener);
      window.addEventListener(CHANGED, listener);
      return () => {
        window.removeEventListener("storage", listener);
        window.removeEventListener(CHANGED, listener);
      };
    },
    [key],
  );
  const raw = useSyncExternalStore(subscribe, () => read(key), () => null);
  let value = fallback;
  if (raw !== null) {
    try {
      value = JSON.parse(raw) as T;
    } catch {
      value = fallback;
    }
  }
  const set = useCallback(
    (next: T) => {
      const text = JSON.stringify(next);
      memory.set(key, text);
      try {
        localStorage.setItem(key, text);
      } catch {
        // Kept in memory instead.
      }
      window.dispatchEvent(new Event(CHANGED));
    },
    [key],
  );
  return [value, set];
}
