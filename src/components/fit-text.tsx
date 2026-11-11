"use client";

import { useEffect, useLayoutEffect, useRef, type CSSProperties, type ReactNode } from "react";

/**
 * Shrink the text until it fits its box. One line: compare the text's natural width with the box. Both
 * are measured on screen, so a scaled stage (the green screen overlay) doesn't change the ratio.
 * Wrapped: the largest size whose lines fit the box's height, found by halving.
 */
function fit(box: HTMLElement, text: HTMLElement, wrap: boolean, minScale: number) {
  text.style.fontSize = "";
  if (!wrap) {
    text.style.maxWidth = "none";
    const available = box.getBoundingClientRect().width;
    let natural = text.getBoundingClientRect().width;
    // Measured again after each shrink: letter spacing set on the box (the LED wall's tracked capitals) is fixed in
    // pixels by the time the text inherits it, so it doesn't shrink with the letters, and one guess can fall a pixel short.
    for (let scale = 1, i = 0; i < 3 && natural > available && natural > 0 && scale > minScale; i++) {
      scale = Math.max(minScale, scale * (available / natural) * 0.98);
      text.style.fontSize = `${scale}em`;
      natural = text.getBoundingClientRect().width;
    }
    text.style.maxWidth = "";
    return;
  }
  const fits = () => text.scrollHeight <= box.clientHeight + 1 && text.scrollWidth <= text.clientWidth + 1;
  if (fits()) return;
  let lo = minScale;
  let hi = 1;
  for (let i = 0; i < 7; i++) {
    const mid = (lo + hi) / 2;
    text.style.fontSize = `${mid}em`;
    if (fits()) lo = mid;
    else hi = mid;
  }
  text.style.fontSize = `${lo}em`;
}

const ALIGN = { start: "mr-auto", center: "mx-auto", end: "ml-auto" } as const;

/**
 * Text that gets smaller instead of overflowing: scores, percentages and long names on the LED wall.
 * The box's font size is the largest the text gets. Below `minScale` of it, one line ends in an ellipsis.
 * The box must not have padding, which would change what fits.
 */
export function FitText({
  children,
  className = "",
  style,
  align = "start",
  wrap = false,
  minScale = 0.25,
}: {
  children: ReactNode;
  className?: string;
  style?: CSSProperties;
  align?: keyof typeof ALIGN;
  /** Wrap onto several lines and fit the box's height (which must be set), rather than one line fitting its width. */
  wrap?: boolean;
  minScale?: number;
}) {
  const box = useRef<HTMLSpanElement>(null);
  const text = useRef<HTMLSpanElement>(null);

  // After every render, so new text is fitted before it's painted.
  useLayoutEffect(() => {
    if (box.current && text.current) fit(box.current, text.current, wrap, minScale);
  });

  // The screen or stage resizing, and a font arriving after the first fit. Any font, whenever it arrives: the LED wall's
  // own starts loading only once text uses it, after `ready` may have settled, and text fitted to the fallback's
  // narrower letters is cut off once the real ones are in (until something else redraws it, such as a score coming in).
  useEffect(() => {
    const outer = box.current;
    const inner = text.current;
    if (!outer || !inner) return;
    const refit = () => fit(outer, inner, wrap, minScale);
    const observer = new ResizeObserver(refit);
    observer.observe(outer);
    let active = true;
    const fonts = document.fonts;
    void fonts?.ready.then(() => active && refit());
    fonts?.addEventListener("loadingdone", refit);
    return () => {
      active = false;
      observer.disconnect();
      fonts?.removeEventListener("loadingdone", refit);
    };
  }, [wrap, minScale]);

  return (
    <span
      ref={box}
      style={style}
      className={`min-w-0 ${wrap ? "flex flex-col justify-center" : "block overflow-hidden whitespace-nowrap"} ${className}`}
    >
      <span ref={text} className={wrap ? "block" : `block w-max max-w-full overflow-hidden text-ellipsis ${ALIGN[align]}`}>
        {children}
      </span>
    </span>
  );
}
