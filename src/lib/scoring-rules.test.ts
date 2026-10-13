import { describe, expect, it } from "vitest";
import { checkScoring } from "./scoring-rules";

const criteria = (rows: { name: string; max: number; min?: number }[]) =>
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
});
