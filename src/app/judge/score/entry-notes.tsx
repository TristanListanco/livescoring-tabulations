"use client";

import { useCallback, useEffect, useId, useRef, useState, useSyncExternalStore } from "react";
import { MAX_NOTE } from "@/lib/notes";
import type { Entry } from "@/lib/types";
import { useDeviceSetting } from "@/lib/use-device-setting";
import { saveNote } from "../actions";

/**
 * A judge's notes on the entry on screen. Only that judge and the organizer read them. Phones and narrow tablets get
 * a collapsible section under the entry's name; from 1280px wide, a column beside the keypad that can pop out into a
 * window the judge drags anywhere (both remembered on the device). Narrower, a column would squeeze the keypad.
 */

/** Saved notes this screen knows about, by entry id, and how to record one just saved. */
export type NoteStore = { get: (entryId: string) => string; stored: (entryId: string, body: string) => void };

/** Whether the screen matches a media query, following it as it changes. The server render uses `fallback`. */
export function useMediaQuery(query: string, fallback = false): boolean {
  return useSyncExternalStore(
    (onChange) => {
      const list = window.matchMedia(query);
      list.addEventListener("change", onChange);
      return () => list.removeEventListener("change", onChange);
    },
    () => window.matchMedia(query).matches,
    () => fallback,
  );
}

/** Whether notes go beside the keypad (1280px and up) rather than under the entry's name. */
export function useWideScreen(): boolean {
  return useMediaQuery("(min-width: 1280px)");
}

type Status = "saved" | "editing" | "saving" | "error";
const SAVE_AFTER_MS = 800;

/**
 * The note being written for one entry: saved a moment after typing stops, when the field loses focus, and when
 * another entry comes on screen.
 */
function useNoteDraft(entryId: string, notes: NoteStore) {
  const [text, setText] = useState(() => notes.get(entryId));
  const [status, setStatus] = useState<Status>("saved");
  const latest = useRef({ text, stored: text });
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const store = useRef(notes.stored);
  useEffect(() => {
    store.current = notes.stored;
  });

  const save = useCallback(async () => {
    clearTimeout(timer.current);
    const body = latest.current.text;
    if (body === latest.current.stored) return;
    setStatus("saving");
    const result = await saveNote(entryId, body).catch(() => ({ ok: false as const, error: "" }));
    if (!result.ok) {
      setStatus("error");
      return;
    }
    latest.current.stored = body;
    store.current(entryId, body);
    setStatus(latest.current.text === body ? "saved" : "editing");
  }, [entryId]);
  // Leaving this entry (or the page) sends whatever wasn't saved yet.
  useEffect(() => () => void save(), [save]);

  const change = (value: string) => {
    setText(value);
    latest.current.text = value;
    setStatus("editing");
    clearTimeout(timer.current);
    timer.current = setTimeout(() => void save(), SAVE_AFTER_MS);
  };
  return { text, status, change, flush: () => void save() };
}

/** The note's text box and whether it's saved. `fill`: grow to the height of its column. */
function NoteEditor({ entry, notes, rows, fill = false }: { entry: Entry; notes: NoteStore; rows: number; fill?: boolean }) {
  const id = useId();
  const { text, status, change, flush } = useNoteDraft(entry.id, notes);
  return (
    <div className={fill ? "flex min-h-0 flex-1 flex-col" : ""}>
      <label htmlFor={id} className="sr-only">
        Your notes on {entry.name}
      </label>
      <textarea
        id={id}
        value={text}
        onChange={(e) => change(e.target.value)}
        onBlur={flush}
        maxLength={MAX_NOTE}
        rows={rows}
        placeholder="What stood out. Only you and the organizer see it."
        className={`w-full resize-none rounded-xl border border-regal bg-prussian px-3 py-2.5 text-base leading-relaxed text-mint placeholder:text-powder/85 focus-visible:border-powder ${fill ? "min-h-32 flex-1" : ""}`}
      />
      {status === "error" ? (
        <p role="alert" className="mt-1.5 text-sm font-semibold text-danger-soft">
          Your note didn&apos;t save. Check your connection; it saves again as you type.
        </p>
      ) : (
        <p aria-hidden className="mt-1.5 h-5 text-sm text-powder">
          {status === "saving" ? "Saving…" : status === "saved" && text ? "Saved" : ""}
        </p>
      )}
    </div>
  );
}

const noteIcon = (
  <svg viewBox="0 0 20 20" className="size-4 shrink-0" aria-hidden>
    <path d="M4 3.5h8.5L16 7v9.5H4z" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
    <path d="M7 9.5h6M7 12.5h4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
  </svg>
);

/** Phones and narrow tablets: a button under the entry's name that opens the note, open or shut as the judge last left it. */
export function NotesInline({ entry, notes }: { entry: Entry; notes: NoteStore }) {
  const [open, setOpen] = useDeviceSetting("livescoring:notes-open", false);
  const id = useId();
  const saved = notes.get(entry.id);
  return (
    <div className="mt-3">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen(!open)}
        className="flex min-h-11 w-full items-center gap-2 rounded-xl border border-oxford px-4 py-2 text-left text-sm font-semibold text-powder hover:text-mint"
      >
        {noteIcon}
        <span className="shrink-0">{saved ? "Your notes" : "Add notes"}</span>
        {!open && saved && <span className="min-w-0 flex-1 truncate font-normal text-powder/80">{saved.split("\n")[0]}</span>}
        <svg viewBox="0 0 16 16" className={`ml-auto size-4 shrink-0 transition-transform ${open ? "rotate-180" : ""}`} aria-hidden>
          <path d="M4 6l4 4 4-4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      {open && (
        <div id={id} className="mt-2">
          <NoteEditor key={entry.id} entry={entry} notes={notes} rows={4} />
        </div>
      )}
    </div>
  );
}

type Mode = "docked" | "floating";
type Point = { x: number; y: number };

/** The window's size, as "width x height", so a resize re-renders and the floating notes stay on screen. */
function useViewport(): { width: number; height: number } {
  const size = useSyncExternalStore(
    (onChange) => {
      window.addEventListener("resize", onChange);
      return () => window.removeEventListener("resize", onChange);
    },
    () => `${window.innerWidth}x${window.innerHeight}`,
    () => "1280x800",
  );
  const [width, height] = size.split("x").map(Number);
  return { width, height };
}

/**
 * 1280px and up: the notes beside the keypad. Docked as a column by default, using the room a wide screen has; popped
 * out, a window the judge drags by its title bar (or moves with the arrow keys on its handle) to wherever suits them.
 * `entry`: the entry on screen, or null between entries.
 */
export function NotesBeside({ entry, notes }: { entry: Entry | null; notes: NoteStore }) {
  const [mode, setMode] = useDeviceSetting<Mode>("livescoring:notes-mode", "docked");
  const body = entry ? (
    <NoteEditor key={entry.id} entry={entry} notes={notes} rows={8} fill />
  ) : (
    <p className="text-sm text-powder">Notes on each entry open here while it&apos;s on screen.</p>
  );
  const title = (
    <h2 className="min-w-0 flex-1 truncate text-sm font-semibold">
      <span className="text-powder">Notes</span>
      {entry && <span className="text-mint"> · {entry.name}</span>}
    </h2>
  );

  if (mode === "floating") return <FloatingNotes title={title} onDock={() => setMode("docked")} body={body} />;
  return (
    <aside aria-label="Your notes" className="flex w-80 shrink-0 flex-col border-l border-oxford px-5 py-5 xl:w-96">
      <div className="mb-3 flex items-center gap-2">
        {noteIcon}
        {title}
        <button type="button" onClick={() => setMode("floating")} className="btn btn-sm text-powder hover:bg-oxford hover:text-mint">
          Pop out
        </button>
      </div>
      {body}
    </aside>
  );
}

const STEP = 24;

function FloatingNotes({ title, body, onDock }: { title: React.ReactNode; body: React.ReactNode; onDock: () => void }) {
  const [saved, setSaved] = useDeviceSetting<Point | null>("livescoring:notes-position", null);
  const [minimized, setMinimized] = useDeviceSetting("livescoring:notes-minimized", false);
  const viewport = useViewport();
  const width = viewport.width >= 1536 ? 384 : 320;
  // Where it is while being dragged; saved on release.
  const [dragging, setDragging] = useState<Point | null>(null);
  const start = useRef<{ pointer: Point; at: Point } | null>(null);

  // Kept on screen, below the header, whatever the window's size.
  const keep = (p: Point): Point => ({
    x: Math.min(Math.max(8, p.x), viewport.width - width - 8),
    y: Math.min(Math.max(80, p.y), viewport.height - 64),
  });
  // It first opens at the bottom left, over the list of scores rather than the criteria or the keypad.
  const at = keep(dragging ?? saved ?? { x: 16, y: viewport.height - 400 });

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0 || (e.target instanceof HTMLElement && e.target.closest("button:not([data-grip])"))) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    start.current = { pointer: { x: e.clientX, y: e.clientY }, at };
  };
  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!start.current) return;
    setDragging(keep({ x: start.current.at.x + e.clientX - start.current.pointer.x, y: start.current.at.y + e.clientY - start.current.pointer.y }));
  };
  const onPointerUp = () => {
    if (!start.current) return;
    start.current = null;
    if (dragging) setSaved(dragging);
    setDragging(null);
  };
  const onKeyDown = (e: React.KeyboardEvent) => {
    const step = e.shiftKey ? STEP * 4 : STEP;
    const move = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[e.key];
    if (!move) return;
    e.preventDefault();
    setSaved(keep({ x: at.x + move[0], y: at.y + move[1] }));
  };

  return (
    <section
      aria-label="Your notes"
      style={{ left: at.x, top: at.y, width }}
      className={`fixed z-10 flex flex-col rounded-2xl border border-regal bg-oxford shadow-xl shadow-prussian/60 ${dragging ? "select-none" : ""}`}
    >
      <div
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        className={`flex touch-none items-center gap-2 px-3 py-2 ${dragging ? "cursor-grabbing" : "cursor-grab"}`}
      >
        <button
          type="button"
          data-grip
          onKeyDown={onKeyDown}
          aria-label="Move notes"
          aria-describedby="notes-move-hint"
          className="btn btn-sm cursor-[inherit] px-1.5 text-powder hover:text-mint"
        >
          <svg viewBox="0 0 16 16" className="size-4" aria-hidden>
            {[4, 8, 12].flatMap((y) => [6, 10].map((x) => <circle key={`${x}-${y}`} cx={x} cy={y} r="1.2" fill="currentColor" />))}
          </svg>
        </button>
        <span id="notes-move-hint" className="sr-only">
          Use the arrow keys to move the notes; hold Shift to move further.
        </span>
        {title}
        <button type="button" onClick={onDock} className="btn btn-sm text-powder hover:bg-regal hover:text-mint">
          Dock
        </button>
        <button
          type="button"
          aria-expanded={!minimized}
          onClick={() => setMinimized(!minimized)}
          className="btn btn-sm text-powder hover:bg-regal hover:text-mint"
        >
          {minimized ? "Show" : "Hide"}
        </button>
      </div>
      {!minimized && <div className="flex max-h-[min(28rem,60dvh)] flex-col px-3 pb-3">{body}</div>}
    </section>
  );
}
