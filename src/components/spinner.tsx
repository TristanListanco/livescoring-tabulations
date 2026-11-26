/**
 * A small turning ring for something on its way to the server (a name or photo being saved). Decorative: the words
 * beside it say what's happening. Under reduced motion it holds still.
 */
export function Spinner({ className = "size-4" }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" className={`shrink-0 animate-spin motion-reduce:animate-none ${className}`} aria-hidden>
      <circle cx="8" cy="8" r="6.25" fill="none" stroke="currentColor" strokeOpacity="0.3" strokeWidth="2" />
      <path d="M8 1.75A6.25 6.25 0 0 1 14.25 8" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}
