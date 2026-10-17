/**
 * Photo uploads. The browser sends a cropped JPEG (see resize-image), but the server doesn't take its word for the
 * type: it reads the file's first bytes, and refuses anything that isn't a JPEG, PNG or WebP (an SVG, say, which
 * can carry script). The photo is stored with the type its bytes show, never the one the browser declared.
 */
export const MAX_PHOTO_BYTES = 2 * 1024 * 1024;

export type PhotoType = "image/jpeg" | "image/png" | "image/webp";
export type Photo = { file: File; type: PhotoType };

const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const ascii = (bytes: Uint8Array, from: number, to: number) => String.fromCharCode(...bytes.subarray(from, to));

/** The image type a file's first 12 bytes show, or null when they aren't a photo we accept. */
export function photoType(head: Uint8Array): PhotoType | null {
  if (head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff) return "image/jpeg";
  if (PNG.every((b, i) => head[i] === b)) return "image/png";
  if (head.length >= 12 && ascii(head, 0, 4) === "RIFF" && ascii(head, 8, 12) === "WEBP") return "image/webp";
  return null;
}

/** The file extension for a stored photo of this type. */
export const photoExtension = (type: PhotoType) => ({ "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" })[type];

/** A photo from a form field: null when none was chosen, "invalid" when it's too big or not a photo we accept. */
export async function photoFile(value: FormDataEntryValue | null): Promise<Photo | null | "invalid"> {
  if (!(value instanceof File) || value.size === 0) return null;
  if (value.size > MAX_PHOTO_BYTES) return "invalid";
  const type = photoType(new Uint8Array(await value.slice(0, 12).arrayBuffer()));
  return type ? { file: value, type } : "invalid";
}

/** How many photos the pageant setup sends in one request, just after the pageant is created. */
export const PHOTOS_PER_REQUEST = 10;
/** Well under the 8 MB a request may carry (next.config.ts), whatever size the photos are. */
const BYTES_PER_REQUEST = 4 * 1024 * 1024;

/** Photos grouped into requests: up to PHOTOS_PER_REQUEST each, and no request too big to send. */
export function photoBatches<T extends { photo: Blob }>(items: T[]): T[][] {
  const batches: T[][] = [];
  let bytes = 0;
  for (const item of items) {
    const last = batches.at(-1);
    if (last && last.length < PHOTOS_PER_REQUEST && bytes + item.photo.size <= BYTES_PER_REQUEST) {
      last.push(item);
      bytes += item.photo.size;
    } else {
      batches.push([item]);
      bytes = item.photo.size;
    }
  }
  return batches;
}
