"use client";

import { useEffect, useId, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { cropToJpeg } from "@/lib/resize-image";

/** The crop frame's side on screen, in CSS pixels. Small enough for a phone's dialog. */
const FRAME = 280;
const MAX_ZOOM = 4;

type Spot = { x: number; y: number };

/**
 * Crop and resize a photo before it's saved: drag it (or use the arrow keys) to place it in the square, and zoom to
 * make it bigger or smaller. Zooming out below the frame fits the whole photo, on white. `round` shows the circle
 * an avatar is drawn in; the saved photo is the square either way, `pixels` wide.
 */
export function PhotoCropDialog({
  image,
  src,
  pixels,
  round,
  name,
  onDone,
  onCancel,
}: {
  image: ImageBitmap;
  /** The same photo for showing on screen. */
  src: string;
  pixels: number;
  round: boolean;
  /** Whose photo, for the title. */
  name: string;
  onDone: (photo: Blob) => void;
  onCancel: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const useButton = useRef<HTMLButtonElement>(null);
  const titleId = useId();
  const hintId = useId();
  const zoomId = useId();
  const drag = useRef<{ pointer: number; from: Spot; start: Spot } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const { width, height } = image;
  // At zoom 1 the photo just covers the frame; the smallest zoom fits all of it inside.
  const cover = FRAME / Math.min(width, height);
  const minZoom = Math.min(width, height) / Math.max(width, height);
  const [zoom, setZoom] = useState(1);
  const scale = cover * zoom;
  const shown = { w: width * scale, h: height * scale };

  /** Keep the photo over the frame when it's bigger than it, and inside it when it's smaller. */
  const clamp = (spot: Spot, w = shown.w, h = shown.h): Spot => {
    const axis = (v: number, size: number) => (size >= FRAME ? Math.min(0, Math.max(FRAME - size, v)) : Math.max(0, Math.min(FRAME - size, v)));
    return { x: axis(spot.x, w), y: axis(spot.y, h) };
  };
  const [spot, setSpot] = useState<Spot>(() => ({ x: (FRAME - width * cover) / 2, y: (FRAME - height * cover) / 2 }));

  // Opens straight away, on keeping the photo as it starts: centred, filling the square.
  useEffect(() => {
    ref.current?.showModal();
    useButton.current?.focus();
    // A drag ends if the window loses focus mid-way, so the next one starts clean.
    const stop = () => {
      drag.current = null;
    };
    window.addEventListener("blur", stop);
    return () => window.removeEventListener("blur", stop);
  }, []);

  /** A new zoom, keeping the middle of the frame where it is. */
  const zoomTo = (next: number) => {
    const z = Math.min(MAX_ZOOM, Math.max(minZoom, next));
    const ratio = z / zoom;
    const w = width * cover * z;
    const h = height * cover * z;
    setZoom(z);
    setSpot(clamp({ x: FRAME / 2 - (FRAME / 2 - spot.x) * ratio, y: FRAME / 2 - (FRAME / 2 - spot.y) * ratio }, w, h));
  };

  const down = (e: PointerEvent<HTMLDivElement>) => {
    // A second finger mid-drag doesn't take over: the first drag keeps going.
    if (drag.current) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { pointer: e.pointerId, from: { x: e.clientX, y: e.clientY }, start: spot };
  };
  const move = (e: PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d || d.pointer !== e.pointerId) return;
    setSpot(clamp({ x: d.start.x + e.clientX - d.from.x, y: d.start.y + e.clientY - d.from.y }));
  };
  const up = () => {
    drag.current = null;
  };
  // Arrow keys move the photo (Shift for bigger steps); + and - zoom.
  const key = (e: KeyboardEvent<HTMLDivElement>) => {
    const step = e.shiftKey ? 32 : 8;
    const moves: Record<string, Spot> = { ArrowLeft: { x: -step, y: 0 }, ArrowRight: { x: step, y: 0 }, ArrowUp: { x: 0, y: -step }, ArrowDown: { x: 0, y: step } };
    if (moves[e.key]) {
      e.preventDefault();
      setSpot(clamp({ x: spot.x + moves[e.key].x, y: spot.y + moves[e.key].y }));
    } else if (e.key === "+" || e.key === "=") {
      e.preventDefault();
      zoomTo(zoom + 0.1);
    } else if (e.key === "-") {
      e.preventDefault();
      zoomTo(zoom - 0.1);
    }
  };

  const save = async () => {
    setSaving(true);
    try {
      onDone(await cropToJpeg(image, { x: spot.x, y: spot.y, width: shown.w, height: shown.h, frame: FRAME }, pixels));
    } catch {
      setError("That photo couldn't be saved. Try another one.");
      setSaving(false);
    }
  };

  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      aria-describedby={hintId}
      onCancel={(e) => {
        e.preventDefault();
        onCancel();
      }}
      // Enter keeps the photo, rather than submitting a form around the picker.
      onKeyDown={(e) => {
        if (e.key === "Enter" && !(e.target instanceof HTMLButtonElement)) {
          e.preventDefault();
          void save();
        }
      }}
      className="m-auto w-[min(26rem,calc(100vw-2rem))] rounded-2xl bg-mint p-0 text-prussian shadow-2xl"
    >
      <div className="p-6">
        <h2 id={titleId} className="text-xl font-bold">
          Crop the photo{name ? ` of ${name}` : ""}
        </h2>
        <p id={hintId} className="mt-1 text-sm text-prussian/80">
          Drag the photo, or use the arrow keys, to choose what shows. Zoom to make it bigger or smaller.
        </p>
        <div
          role="group"
          aria-label="Photo position. Use the arrow keys to move it, and plus and minus to zoom."
          tabIndex={0}
          onPointerDown={down}
          onPointerMove={move}
          onPointerUp={up}
          onPointerCancel={up}
          onLostPointerCapture={up}
          onKeyDown={key}
          className="relative mx-auto mt-4 cursor-grab touch-none overflow-hidden rounded-lg bg-white ring-1 ring-line select-none active:cursor-grabbing focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-regal"
          style={{ width: FRAME, height: FRAME }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element -- a local photo being cropped, not a page image */}
          <img
            src={src}
            alt=""
            draggable={false}
            className="pointer-events-none absolute top-0 left-0 max-w-none"
            style={{ width: shown.w, height: shown.h, transform: `translate(${spot.x}px, ${spot.y}px)` }}
          />
          {/* How it shows: in a circle for people, square for entries on the LED wall. */}
          <span
            aria-hidden
            className={`pointer-events-none absolute inset-0 ${round ? "rounded-full" : "rounded-lg"} shadow-[0_0_0_999px_rgb(11_37_69/0.45)] ring-2 ring-white/80`}
          />
        </div>
        <div className="mt-4 flex items-center gap-3">
          <button type="button" className="btn btn-quiet btn-sm px-3" onClick={() => zoomTo(zoom - 0.25)} disabled={zoom <= minZoom} aria-label="Zoom out">
            −
          </button>
          <label htmlFor={zoomId} className="sr-only">
            Zoom
          </label>
          {/* In whole percents, so every step is a round size: 56% (the whole photo) up to 400%. */}
          <input
            id={zoomId}
            type="range"
            min={Math.ceil(minZoom * 100)}
            max={MAX_ZOOM * 100}
            step={1}
            value={Math.round(zoom * 100)}
            onChange={(e) => zoomTo(Number(e.target.value) / 100)}
            aria-valuetext={`${Math.round(zoom * 100)}%`}
            className="min-w-0 flex-1 accent-regal"
          />
          <button type="button" className="btn btn-quiet btn-sm px-3" onClick={() => zoomTo(zoom + 0.25)} disabled={zoom >= MAX_ZOOM} aria-label="Zoom in">
            +
          </button>
        </div>
        {error && (
          <p role="alert" className="mt-3 text-sm font-semibold text-danger">
            {error}
          </p>
        )}
      </div>
      <div className="flex flex-wrap justify-end gap-2 border-t border-line bg-wash/60 px-6 py-4">
        <button type="button" className="btn btn-quiet mr-auto" onClick={onCancel} disabled={saving}>
          Cancel
        </button>
        <button ref={useButton} type="button" className="btn btn-primary" onClick={() => void save()} disabled={saving}>
          {saving ? "Saving…" : "Use photo"}
        </button>
      </div>
    </dialog>
  );
}
