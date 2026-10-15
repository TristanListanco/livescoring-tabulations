import { describe, expect, it } from "vitest";
import { cleanNote, MAX_NOTE } from "./notes";

describe("cleanNote", () => {
  it("keeps the judge's lines and spacing, trimmed", () => {
    expect(cleanNote("  Strong opening.\r\n\r\n  Weak close, missed the beat  ")).toBe("Strong opening.\n\n  Weak close, missed the beat");
  });

  it("treats a blank note as no note", () => {
    expect(cleanNote(" \n\t ")).toBe("");
    expect(cleanNote(null)).toBe("");
  });

  it("drops control characters and cuts long notes", () => {
    expect(cleanNote("Poise\u0000 and\u0007 bearing")).toBe("Poise and bearing");
    expect(cleanNote("x".repeat(MAX_NOTE + 10))).toHaveLength(MAX_NOTE);
  });
});
