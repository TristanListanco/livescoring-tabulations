"use client";

import { useState } from "react";

/** `ariaLabel`: a fuller name for screen readers when the visible label alone doesn't say what's copied; it starts with the label. */
export function CopyButton({
  value,
  label = "Copy",
  ariaLabel,
  className = "btn btn-quiet btn-sm min-w-20",
}: {
  value: string;
  label?: string;
  ariaLabel?: string;
  className?: string;
}) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard is blocked on plain-http LAN addresses; the value stays visible to copy by hand.
    }
  };

  return (
    <button type="button" onClick={copy} className={className} aria-live="polite" aria-label={copied ? undefined : ariaLabel}>
      {copied ? "Copied" : label}
    </button>
  );
}
