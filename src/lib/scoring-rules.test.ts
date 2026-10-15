import { describe, expect, it } from "vitest";
import { checkScoring, cleanGuide, MAX_GUIDE } from "./scoring-rules";

const criteria = (rows: { name: string; max: number; min?: number; guide?: string }[]) =>
  checkScoring({ mode: "criteria", min: "", max: "", decimals: 1, criteria: rows, display: "percent" }, () => "new");

describe("criteria scoring", () => {
  it("keeps each criterion's lowest score", () => {
    const result = criteria([
      { name: "Content", max: 40, min: 28 },
      { name: "Delivery", max: 60 },
    ]);
    expect("scoring" in result && result.scoring.criteria).toEqual([
      { id: "new", name: "Content", max: 40, min: 28 },
      { id: "new", name: "Delivery", max: 60 },
    ]);
  });

  it("needs a lowest score below the criterion's points, to the hundredth", () => {
    expect(criteria([{ name: "Content", max: 40, min: 40 }, { name: "Delivery", max: 60 }])).toEqual({ error: "Give Content a lowest score below its 40 points." });
    expect(criteria([{ name: "Content", max: 40, min: 28.125 }, { name: "Delivery", max: 60 }])).toEqual({ error: "Give Content a lowest score below its 40 points." });
    expect(criteria([{ name: "Content", max: 40, min: -1 }, { name: "Delivery", max: 60 }])).toEqual({ error: "Give Content a lowest score below its 40 points." });
  });

  it("keeps a guide for judges, and leaves it out when blank", () => {
    const result = criteria([
      { name: "Content", max: 40, guide: "  Is the answer on topic?\r\n\n\n\nDoes it   answer the question?  " },
      { name: "Delivery", max: 60, guide: "   " },
    ]);
    expect("scoring" in result && result.scoring.criteria).toEqual([
      { id: "new", name: "Content", max: 40, guide: "Is the answer on topic?\n\nDoes it answer the question?" },
      { id: "new", name: "Delivery", max: 60 },
    ]);
  });
});

describe("cleanGuide", () => {
  it("drops control characters and cuts long guides", () => {
    expect(cleanGuide("Poise\u0000 and\tbearing")).toBe("Poise and bearing");
    expect(cleanGuide("x".repeat(MAX_GUIDE + 50))).toHaveLength(MAX_GUIDE);
    expect(cleanGuide(undefined)).toBe("");
  });
});
