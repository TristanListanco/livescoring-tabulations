"use client";

import { useId, useRef, useState } from "react";
import { Avatar } from "./avatar";
import { PhotoCropDialog } from "./photo-crop-dialog";

/**
 * Round photo button. Picks an image, lets the organizer crop and resize it (see PhotoCropDialog), and hands back a
 * small square JPEG. Every photo in the app (judges, entries and candidates, organizers) is chosen here. Without a
 * photo, a click chooses one. With one, a click opens it large (hover says so), with Change photo, Remove photo (with
 * `onRemove`) and Close: a photo is looked at before it's replaced or taken away.
 */
export function PhotoPicker({
  name,
  currentUrl,
  onPick,
  size = 64,
  square = false,
  pixels,
  label,
  onRemove,
}: {
  /** Takes the photo away, from the photo's dialog. Left out, the dialog offers only Change photo. */
  onRemove?: () => void;
  name: string;
  currentUrl: string | null;
  onPick: (photo: Blob, previewUrl: string) => void;
  size?: number;
  /** A rounded square instead of a circle. */
  square?: boolean;
  /** Width and height of the saved JPEG. Bigger for photos shown large on the LED wall. */
  pixels?: number;
  /** What the file input is called for screen readers. */
  label?: string;
}) {
  const id = useId();
  const titleId = useId();
  const input = useRef<HTMLInputElement>(null);
  const viewer = useRef<HTMLDialogElement>(null);
  const shape = square ? "rounded-lg" : "rounded-full";
  const [error, setError] = useState<string | null>(null);
  // The photo being cropped, decoded, with an address for showing it; null when none is.
  const [cropping, setCropping] = useState<{ image: ImageBitmap; src: string } | null>(null);
  // The photo dialog's large copy is drawn only while it's open: not a second image for every photo on the page.
  const [viewing, setViewing] = useState(false);
  const view = () => {
    setViewing(true);
    viewer.current?.showModal();
  };
  const subject = name || "judge";

  const handle = async (file: File | undefined) => {
    if (!file) return;
    setError(null);
    try {
      setCropping({ image: await createImageBitmap(file), src: URL.createObjectURL(file) });
    } catch {
      setError("That file isn't an image we can read.");
    }
  };
  const finish = (photo: Blob | null) => {
    if (photo) onPick(photo, URL.createObjectURL(photo));
    cropping?.image.close();
    if (cropping) URL.revokeObjectURL(cropping.src);
    setCropping(null);
  };
  const focusRing =
    "has-[:focus-visible]:shadow-[0_0_0_2px_var(--color-mint)] has-[:focus-visible]:outline-3 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-regal";
  // One file input, whichever way the photo is reached: in the empty button's label, or chosen from the dialog.
  const fileInput = (
    <input
      ref={input}
      id={id}
      type="file"
      accept="image/*"
      className="sr-only"
      tabIndex={currentUrl ? -1 : undefined}
      aria-label={label ?? `Photo for ${subject}`}
      onChange={(e) => {
        void handle(e.target.files?.[0]);
        e.target.value = "";
      }}
    />
  );

  return (
    <div className="flex flex-col items-center gap-1">
      {currentUrl ? (
        <>
          <button
            type="button"
            onClick={view}
            aria-haspopup="dialog"
            // A hairline around it, so a photo with a white background still reads as a photo on a white card.
            className={`group relative cursor-pointer overflow-hidden ${shape} ring-1 ring-prussian/15 focus-visible:shadow-[0_0_0_2px_var(--color-mint)] focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-regal`}
            title="View photo"
          >
            <span className="sr-only">View photo of {subject}</span>
            <Avatar name={name} src={currentUrl} size={size} square={square} />
            <span
              aria-hidden
              // Hover says what a click does; keyboard focus does too, and a touchscreen (no hover) always shows it as a band.
              className={`absolute inset-0 flex items-center justify-center ${shape} bg-prussian/60 text-xs font-semibold text-mint opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100 pointer-coarse:top-auto pointer-coarse:h-2/5 pointer-coarse:rounded-none pointer-coarse:opacity-100`}
            >
              View
            </span>
          </button>
          {fileInput}
          <dialog
            ref={viewer}
            aria-labelledby={titleId}
            onClose={() => setViewing(false)}
            onClick={(e) => e.target === e.currentTarget && viewer.current?.close()}
            className="m-auto w-[min(24rem,calc(100vw-2rem))] rounded-2xl bg-mint p-0 text-center text-[15px] text-prussian shadow-2xl"
          >
            <div className="px-6 pt-6 pb-6">
              <h2 id={titleId} className="title-sm wrap-anywhere">
                {name ? `${name}'s photo` : "Photo"}
              </h2>
              <div className="mt-5 flex min-h-56 justify-center">
                {viewing && <Avatar name={name} src={currentUrl} size={224} square={square} className="ring-1 ring-line" />}
              </div>
              <div className="mt-6 flex flex-wrap items-center justify-center gap-2">
                {onRemove && (
                  <button
                    type="button"
                    className="btn btn-danger-quiet btn-sm"
                    onClick={() => {
                      viewer.current?.close();
                      onRemove();
                    }}
                  >
                    Remove photo<span className="sr-only"> of {subject}</span>
                  </button>
                )}
                <button
                  type="button"
                  className="btn btn-quiet btn-sm"
                  onClick={() => {
                    viewer.current?.close();
                    input.current?.click();
                  }}
                >
                  Change photo<span className="sr-only"> of {subject}</span>
                </button>
                <button type="button" className="btn btn-primary btn-sm" onClick={() => viewer.current?.close()}>
                  Close
                </button>
              </div>
            </div>
          </dialog>
        </>
      ) : (
        <label htmlFor={id} className={`group relative cursor-pointer overflow-hidden ${shape} ${focusRing}`} title="Choose photo">
          <span
            style={{ width: size, height: size }}
            className={`flex flex-col items-center justify-center ${shape} border-2 border-dashed border-powder bg-white/70 text-regal transition-colors group-hover:border-regal`}
          >
            <svg viewBox="0 0 24 24" className="size-5" aria-hidden>
              <path
                d="M4 8.5A1.5 1.5 0 015.5 7h2l1.5-2h6L16.5 7h2A1.5 1.5 0 0120 8.5v9a1.5 1.5 0 01-1.5 1.5h-13A1.5 1.5 0 014 17.5v-9z"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.6"
                strokeLinejoin="round"
              />
              <circle cx="12" cy="13" r="3.2" fill="none" stroke="currentColor" strokeWidth="1.6" />
            </svg>
            {size >= 56 && <span className="mt-0.5 text-xs font-semibold">Photo</span>}
          </span>
          {fileInput}
        </label>
      )}
      {error && <span className="max-w-32 text-center text-xs text-danger">{error}</span>}
      {/* Beside the button, not in it: a click inside the dialog mustn't open the file chooser again. */}
      {cropping && (
        <PhotoCropDialog
          image={cropping.image}
          src={cropping.src}
          pixels={pixels ?? 320}
          round={!square}
          name={name}
          onDone={(photo) => finish(photo)}
          onCancel={() => finish(null)}
        />
      )}
    </div>
  );
}
