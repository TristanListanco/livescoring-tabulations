"use client";

import { useId, useRef } from "react";
import { MAX_SIGNATURE_LENGTH, SIGNATURE_BOX } from "@/lib/deliberation";
import type { JudgeSignature } from "@/lib/types";

/**
 * Where someone draws their signature with a finger or stylus: strokes kept as SVG path data in a 600 × 200 box, as
 * whole-number points. The page doesn't scroll while drawing in it. `onDark`: on a navy screen (the judges'); the
 * organizer's admin draws on its light theme.
 */
export function SignaturePad({ value, onChange, onDark = true }: { value: string; onChange: (update: (path: string) => string) => void; onDark?: boolean }) {
  const ref = useRef<SVGSVGElement>(null);
  const down = useRef(false);
  const last = useRef("");
  const hintId = useId();
  const at = (e: React.PointerEvent<SVGSVGElement>) => {
    const box = ref.current!.getBoundingClientRect();
    const clamp = (n: number) => Math.min(Math.max(n, 0), 1);
    return `${Math.round(clamp((e.clientX - box.left) / box.width) * SIGNATURE_BOX.width)} ${Math.round(clamp((e.clientY - box.top) / box.height) * SIGNATURE_BOX.height)}`;
  };
  const add = (part: string) => onChange((path) => (path.length + part.length > MAX_SIGNATURE_LENGTH ? path : path + part));
  return (
    <div className="mt-3">
      <p id={hintId} className={`text-sm ${onDark ? "text-powder" : "text-prussian/70"}`}>
        Draw your signature in the box.
      </p>
      <svg
        ref={ref}
        viewBox={`0 0 ${SIGNATURE_BOX.width} ${SIGNATURE_BOX.height}`}
        role="img"
        aria-label="Signature box"
        aria-describedby={hintId}
        className={`mt-2 block aspect-[3/1] w-full cursor-crosshair touch-none rounded-xl bg-white select-none ${onDark ? "" : "ring-1 ring-line"}`}
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId);
          down.current = true;
          last.current = at(e);
          add(`M${last.current}`);
        }}
        onPointerMove={(e) => {
          if (!down.current) return;
          const point = at(e);
          if (point === last.current) return;
          last.current = point;
          add(`L${point}`);
        }}
        onPointerUp={() => (down.current = false)}
        onPointerCancel={() => (down.current = false)}
      >
        {/* The line to sign on. */}
        <line x1="30" y1="160" x2="570" y2="160" className="stroke-powder" strokeWidth="2" strokeDasharray="8 10" />
        {value && <path d={value} fill="none" className="stroke-prussian" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" />}
      </svg>
      <button
        type="button"
        onClick={() => onChange(() => "")}
        disabled={!value}
        className={`btn btn-sm mt-2 ${onDark ? "text-powder hover:bg-prussian hover:text-mint" : "text-regal hover:bg-wash"}`}
      >
        Clear
      </button>
    </div>
  );
}

/** A signature once given: the drawing, or "(Sgd.)". */
export function SignatureMark({ signature, label = "Your signature" }: { signature: Pick<JudgeSignature, "method" | "drawing">; label?: string }) {
  if (signature.method === "drawn" && signature.drawing) {
    return (
      <svg viewBox={`0 0 ${SIGNATURE_BOX.width} ${SIGNATURE_BOX.height}`} role="img" aria-label={label} className="mt-3 block aspect-[3/1] w-full rounded-xl bg-white">
        <path d={signature.drawing} fill="none" className="stroke-prussian" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    );
  }
  return <p className="mt-2 text-2xl font-bold">(Sgd.)</p>;
}
