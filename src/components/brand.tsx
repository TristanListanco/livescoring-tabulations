/**
 * Tabulous's mark: a tally gate, the four strokes and the slash that count a fifth, the way scores were counted by hand
 * before. One colour (the text's), so it sits on the navy header, the light login and the app icon alike.
 */
export function TallyMark({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 48 48" fill="none" stroke="currentColor" strokeWidth={5} strokeLinecap="round" aria-hidden className={className}>
      <path d="M12 11v26M20 11v26M28 11v26M36 11v26" />
      <path d="M5.5 33.5 42.5 14.5" />
    </svg>
  );
}

/**
 * The mark drawn large, drawing itself: the four strokes one after another, then the slash that counts the fifth (see
 * .tally-draw in globals.css). Colours from `strokes` and `slash`; sized by `className`.
 */
export function TallyGate({ className = "", strokes, slash }: { className?: string; strokes: string; slash: string }) {
  return (
    <svg viewBox="0 0 48 48" fill="none" stroke="currentColor" strokeWidth={3.5} strokeLinecap="round" aria-hidden className={`tally-draw ${className}`}>
      {["M12 11v26", "M20 11v26", "M28 11v26", "M36 11v26"].map((d) => (
        <path key={d} pathLength={1} className={strokes} d={d} />
      ))}
      <path pathLength={1} className={slash} d="M5.5 33.5 42.5 14.5" />
    </svg>
  );
}

/** The mark and the name together, sized by the text around it. */
export function Wordmark({ className = "" }: { className?: string }) {
  return (
    <span className={`inline-flex items-center gap-[0.35em] font-bold tracking-tight ${className}`}>
      <TallyMark className="size-[1.25em] shrink-0" />
      Tabulous
    </span>
  );
}
