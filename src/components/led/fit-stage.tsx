"use client";

import { useLayoutEffect, useRef } from "react";
import { STAGE_H, STAGE_W } from "@/lib/led";

/**
 * A fixed 1920×1080 canvas scaled to fit its container, so the graphic lays out identically
 * on any LED processor resolution and in the admin preview.
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
      i.style.transform = `translate(-50%, -50%) scale(${scale})`;
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
        className="absolute top-1/2 left-1/2 origin-center"
        style={{ width: STAGE_W, height: STAGE_H, transform: "translate(-50%, -50%) scale(0)" }}
      >
        {children}
      </div>
    </div>
  );
}
