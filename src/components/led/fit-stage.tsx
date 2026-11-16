"use client";

import { useLayoutEffect, useRef } from "react";
import { STAGE_H, STAGE_W } from "@/lib/led";

/**
 * A fixed 1920×1080 canvas scaled to fit its container, so the graphic lays out identically
 * on any LED processor resolution and in the admin preview. It sits on the container's bottom edge, centred across:
 * on a screen of another shape (4:3, an ultrawide wall, a portrait panel) the lower third still meets the bottom of
 * the frame, with the key colour filling the rest, never floating in the middle with green under it.
 */
export function FitStage({ children, className = "", background }: { children: React.ReactNode; className?: string; background: string }) {
  const outer = useRef<HTMLDivElement>(null);
  const inner = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const o = outer.current;
    const i = inner.current;
    if (!o || !i) return;
    const fit = () => {
      const scale = Math.min(o.clientWidth / STAGE_W, o.clientHeight / STAGE_H);
      i.style.transform = `translateX(-50%) scale(${scale})`;
    };
    fit();
    const observer = new ResizeObserver(fit);
    observer.observe(o);
    return () => observer.disconnect();
  }, []);

  return (
    <div ref={outer} className={`relative overflow-hidden ${className}`} style={{ backgroundColor: background }}>
      <div
        ref={inner}
        className="absolute bottom-0 left-1/2 origin-bottom"
        style={{ width: STAGE_W, height: STAGE_H, transform: "translateX(-50%) scale(0)" }}
      >
        {children}
      </div>
    </div>
  );
}
