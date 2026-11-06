import { describe, expect, it } from "vitest";
import { cleanSignatories, MAX_SIGNATORIES } from "./signatories";

describe("cleanSignatories", () => {
  it("tidies spaces, caps each part and drops empty rows", () => {
    expect(
      cleanSignatories([
        { name: "  Maria   Santos ", designation: " Chair,  Board of Tabulators" },
        { name: "", designation: "  " },
        { name: "x".repeat(200), designation: "" },
      ]),
    ).toEqual([
      { name: "Maria Santos", designation: "Chair, Board of Tabulators" },
      { name: "x".repeat(120), designation: "" },
    ]);
  });

  it("refuses a designation without a name, and more rows than fit", () => {
    expect(cleanSignatories([{ name: " ", designation: "Tabulator" }])).toEqual({ error: "Every signatory needs a name." });
    const many = Array.from({ length: MAX_SIGNATORIES + 1 }, (_, i) => ({ name: `Signatory ${i}`, designation: "" }));
    expect(cleanSignatories(many)).toEqual({ error: `Up to ${MAX_SIGNATORIES} signatories fit on the sheet.` });
  });

  it("reads anything that isn't a list as none", () => {
    expect(cleanSignatories(null)).toEqual([]);
    expect(cleanSignatories("Maria")).toEqual([]);
  });
});
