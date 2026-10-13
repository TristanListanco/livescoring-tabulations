/**
 * The part of a photo inside a square crop frame, as a small square JPEG, so uploads stay small and avatars line
 * up. `crop` is where the photo sat in the frame (its top-left corner and the size it was shown at, all in the
 * frame's pixels); anything of the frame the photo didn't cover comes out white.
 */
export async function cropToJpeg(
  image: ImageBitmap,
  crop: { x: number; y: number; width: number; height: number; frame: number },
  size = 320,
): Promise<Blob> {
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas is not available");
  const r = size / crop.frame;
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, size, size);
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(image, crop.x * r, crop.y * r, crop.width * r, crop.height * r);
  return new Promise((resolve, reject) =>
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("Could not encode photo"))), "image/jpeg", 0.85),
  );
}
