import { CopyButton } from "@/components/copy-button";

/**
 * A link that gets shared or opened at the venue (the judge portal, live results, the LED wall): the address,
 * shown in full where it fits so it can be read out, with Copy and, when `openLabel` is given, Open in a new tab.
 * `openLabel` finishes the Open button's name for screen readers, e.g. "live results".
 */
export function LinkField({ url, openLabel, className = "" }: { url: string; openLabel?: string; className?: string }) {
  return (
    <div className={`flex max-w-2xl items-center gap-2 ${className}`}>
      <code className="tabular min-w-0 flex-1 truncate rounded-lg border border-line bg-white px-3 py-2.5 text-[15px]">{url}</code>
      <CopyButton value={url} />
      {openLabel && (
        <a href={url} target="_blank" rel="noreferrer" className="btn btn-quiet btn-sm">
          Open<span className="sr-only"> {openLabel}</span>
        </a>
      )}
    </div>
  );
}
