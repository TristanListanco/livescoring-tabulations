import { describe, expect, it } from "vitest";
import { detailsFor, detailsLine, parseEntryLine, toEntryDetails, toEntryFields } from "./entry-details";

const fields = [
  { id: "f1", name: "School" },
  { id: "f2", name: "Division" },
];

describe("entry details", () => {
  it("read a line as the name, then each field's value, split by | or a tab", () => {
    expect(parseEntryLine("Agila | Xavier University | Division 2", 2)).toEqual({ name: "Agila ", values: [" Xavier University ", " Division 2"] });
    expect(parseEntryLine("Agila\tXavier University", 2)).toEqual({ name: "Agila", values: ["Xavier University"] });
    // More values than fields: the extra ones are left out.
    expect(parseEntryLine("Agila | A | B | C", 2).values).toHaveLength(2);
    // Without fields, the line is the name, | and all.
    expect(parseEntryLine("Agila | Bagwis", 0)).toEqual({ name: "Agila | Bagwis", values: [] });
  });

  it("keep values by field id, trimmed, leaving empty ones out", () => {
    expect(detailsFor(fields, [" Xavier  University ", ""])).toEqual({ f1: "Xavier University" });
    expect(detailsLine(fields, { f1: "Xavier University", f2: "Division 2" })).toBe("Xavier University · Division 2");
    expect(detailsLine(fields, { f2: "Division 2" })).toBe("Division 2");
    expect(detailsLine(fields, undefined)).toBe("");
  });

  it("read stored fields and values, dropping anything else", () => {
    expect(toEntryFields([{ id: "f1", name: " School " }, { id: "", name: "No id" }, "junk", { id: "f2", name: "" }])).toEqual([{ id: "f1", name: "School" }]);
    expect(toEntryFields(null)).toEqual([]);
    expect(toEntryDetails({ f1: "Xavier", f2: 3, f3: "" })).toEqual({ f1: "Xavier" });
    expect(toEntryDetails(["x"])).toEqual({});
  });
});
