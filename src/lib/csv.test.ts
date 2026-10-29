import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { BOM, csvBlock, csvCell, FINGERPRINT, LINE, parseCsvLine, readExport } from "./csv";

const sha256 = (text: string) => createHash("sha256").update(text, "utf8").digest("hex");

describe("CSV cells", () => {
  it("quote commas, quotes and line breaks", () => {
    expect(csvCell("Agila")).toBe("Agila");
    expect(csvCell("Cruz, Ana")).toBe('"Cruz, Ana"');
    expect(csvCell('The "Eagle"')).toBe('"The ""Eagle"""');
    expect(csvCell("two\nlines")).toBe('"two\nlines"');
    expect(csvCell(null)).toBe("");
    expect(csvCell(8.5)).toBe("8.5");
  });

  it("turn what a spreadsheet would run as a formula into text, but leave numbers alone", () => {
    expect(csvCell("=HYPERLINK(\"http://x\")")).toBe(`"'=HYPERLINK(""http://x"")"`);
    expect(csvCell("+1")).toBe("'+1");
    expect(csvCell("@cmd")).toBe("'@cmd");
    expect(csvCell("-cmd")).toBe("'-cmd");
    expect(csvCell("-0.80")).toBe("-0.80");
    expect(csvCell("87.50%")).toBe("87.50%");
  });

  it("read back the way they were written", () => {
    const cells = ["Cruz, Ana", 'The "Eagle"', "", "8.50"];
    expect(parseCsvLine(cells.map(csvCell).join(","))).toEqual(cells);
  });
});

describe("an exported CSV, read back", () => {
  const rows = csvBlock(["Rank", "No.", "Entry"], [[1, 2, "Bagwis"], [2, 1, "Agila, the first"]]);
  const file = (data: string) =>
    BOM + [`Activity,"Finals, day 2"`, "Report ID,AB12-CD34", `${FINGERPRINT},${sha256(rows)}`].join(LINE) + LINE + LINE + data + LINE;

  it("gives its header and exactly the rows its fingerprint covers", () => {
    const read = readExport(file(rows))!;
    expect(read.header.get("Activity")).toBe("Finals, day 2");
    expect(read.header.get("Report ID")).toBe("AB12-CD34");
    expect(read.rows).toBe(rows);
    expect(sha256(read.rows)).toBe(read.header.get(FINGERPRINT));
  });

  it("no longer matches its fingerprint once a cell changes", () => {
    const read = readExport(file(rows.replace("Bagwis", "Kidlat")))!;
    expect(sha256(read.rows)).not.toBe(read.header.get(FINGERPRINT));
  });

  it("isn't one without its header", () => {
    expect(readExport(rows)).toBeNull();
  });
});
