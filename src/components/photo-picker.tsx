"use client";

import { useId, useState } from "react";
import { squareJpeg } from "@/lib/resize-image";
import { Avatar } from "./avatar";

/** Round photo button. Picks an image, crops it to a square and hands back a small JPEG. */
export function PhotoPicker({
  name,
  currentUrl,
  onPick,
  size = 64,
}: {
  name: string;
  currentUrl: string | null;
  onPick: (photo: Blob, previewUrl: string) => void;
  size?: number;
}) {
  const id = useId();
  const [error, setError] = useState<string | null>(null);

  const handle = async (file: File | undefined) => {
    if (!file) return;
    setError(null);
    try {
      const blob = await squareJpeg(file);
      onPick(blob, URL.createObjectURL(blob));
    } catch {
      setError("That file isn't an image we can read.");
    }
  };

  return (
    <div className="flex flex-col items-center gap-1">
      <label
        htmlFor={id}
        className="group relative cursor-pointer rounded-full focus-within:outline-3 focus-within:outline-offset-2 focus-within:outline-powder"
        title="Choose photo"
      >
        {currentUrl ? (
          <>
            <Avatar name={name} src={currentUrl} size={size} />
            <span className="absolute inset-0 flex items-center justify-center rounded-full bg-prussian/60 text-xs font-semibold text-mint opacity-0 transition-opacity group-hover:opacity-100">
              Change
            </span>
          </>
        ) : (
          <span
            style={{ width: size, height: size }}
            className="flex flex-col items-center justify-center rounded-full border-2 border-dashed border-powder bg-white/70 text-regal transition-colors group-hover:border-regal"
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
            {size >= 56 && <span className="mt-0.5 text-[10px] font-semibold">Photo</span>}
          </span>
        )}
        <input
          id={id}
          type="file"
          accept="image/*"
          className="sr-only"
          aria-label={`Photo for ${name || "judge"}`}
          onChange={(e) => {
            void handle(e.target.files?.[0]);
            e.target.value = "";
          }}
        />
      </label>
      {error && <span className="max-w-32 text-center text-xs text-danger">{error}</span>}
    </div>
  );
}
