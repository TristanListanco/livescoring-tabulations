import { describe, expect, it } from "vitest";
import { MAX_PHOTO_BYTES, photoFile, photoType } from "./photo-file";

const bytes = (...parts: (number[] | string)[]) =>
  new Uint8Array(parts.flatMap((p) => (typeof p === "string" ? [...p].map((c) => c.charCodeAt(0)) : p)));

const JPEG = bytes([0xff, 0xd8, 0xff, 0xe0, 0, 0x10], "JFIF", [0]);
const SVG = bytes('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');

describe("photoType", () => {
  it("reads JPEG, PNG and WebP from their first bytes", () => {
    expect(photoType(JPEG)).toBe("image/jpeg");
    expect(photoType(bytes([0x89], "PNG", [0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0x0d]))).toBe("image/png");
    expect(photoType(bytes("RIFF", [0x24, 0, 0, 0], "WEBP"))).toBe("image/webp");
  });

  it("refuses anything else, whatever it claims to be", () => {
    expect(photoType(SVG)).toBeNull();
    expect(photoType(bytes("GIF89a"))).toBeNull();
    expect(photoType(bytes("RIFF", [0x24, 0, 0, 0], "WAVE"))).toBeNull();
    expect(photoType(new Uint8Array())).toBeNull();
  });
});

describe("photoFile", () => {
  it("keeps the type the bytes show, not the one declared", async () => {
    expect(await photoFile(new File([JPEG], "photo.png", { type: "image/png" }))).toMatchObject({ type: "image/jpeg" });
  });

  it("refuses an SVG sent as a JPEG, and anything over 2 MB", async () => {
    expect(await photoFile(new File([SVG], "photo.jpg", { type: "image/jpeg" }))).toBe("invalid");
    expect(await photoFile(new File([JPEG, new Uint8Array(MAX_PHOTO_BYTES)], "photo.jpg", { type: "image/jpeg" }))).toBe("invalid");
  });

  it("treats an empty field as no photo", async () => {
    expect(await photoFile(null)).toBeNull();
    expect(await photoFile(new File([], "photo.jpg"))).toBeNull();
    expect(await photoFile("text")).toBeNull();
  });
});
