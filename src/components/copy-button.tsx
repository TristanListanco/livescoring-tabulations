"use client";

import { useState } from "react";

export function CopyButton({ value, label = "Copy" }: { value: string; label?: string }) {
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
    <button type="button" onClick={copy} className="btn btn-quiet btn-sm min-w-20" aria-live="polite">
      {copied ? "Copied" : label}
    </button>
  );
}
