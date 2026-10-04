import { describe, expect, it } from "vitest";
import { averageText, parseBreakdown, rulesSummary, scoreText } from "./scoring";

const simple = { scoringMode: "simple" as const, criteriaDisplay: "percent" as const, decimals: 2 as const, resultDecimals: 2 as const };
const percent = { scoringMode: "criteria" as const, criteriaDisplay: "percent" as const, decimals: 1 as const, resultDecimals: 2 as const };
const ten = { ...percent, criteriaDisplay: "ten" as const };
const criteria = [
  { id: "c1", name: "Innovativeness", max: 30 },
  { id: "c2", name: "Design", max: 70 },
];

describe("score display", () => {
  it("shows simple scores as the judge entered them", () => {
    expect(scoreText(9.5, simple)).toBe("9.50");
    expect(scoreText(9.5, { ...simple, resultDecimals: 4 })).toBe("9.50");
    expect(averageText(9.25, simple)).toBe("9.25");
    expect(averageText(9.25, { ...simple, resultDecimals: 3 })).toBe("9.250");
  });

  it("shows criteria totals as a percentage with the results' decimal places", () => {
    expect(scoreText(87.5, percent)).toBe("87.50%");
    expect(scoreText(87.5, { ...percent, resultDecimals: 0 })).toBe("88%");
    expect(scoreText(87.5, { ...percent, resultDecimals: 4 })).toBe("87.5000%");
    expect(averageText(87.33, percent)).toBe("87.33%");
    expect(averageText(null, percent)).toBe("—");
  });

  it("shows criteria totals scaled to 10", () => {
    expect(scoreText(87.5, ten)).toBe("8.75");
    expect(scoreText(87.25, { ...ten, resultDecimals: 2 })).toBe("8.73");
    expect(scoreText(87.25, { ...ten, resultDecimals: 3 })).toBe("8.725");
    expect(averageText(8.75, ten)).toBe("8.75");
  });

  it("describes the rules", () => {
    expect(rulesSummary({ ...simple, criteria: [], min: 1, max: 10 })).toBe("Scores from 1 to 10, 2 decimal places.");
    expect(rulesSummary({ ...ten, criteria, min: 0, max: 100 })).toBe(
      "Criteria: Innovativeness 30, Design 70. Totals out of 100, shown scaled to 10.",
    );
  });
});

describe("parseBreakdown", () => {
  it("totals valid criterion scores", () => {
    expect(parseBreakdown({ c1: "25.5", c2: "62" }, criteria, 1)).toEqual({ ok: true, total: 87.5, breakdown: { c1: 25.5, c2: 62 } });
  });

  it("rejects a score above its criterion's max, naming the criterion", () => {
    const result = parseBreakdown({ c1: "31", c2: "60" }, criteria, 1);
    expect(result.ok).toBe(false);
    expect(!result.ok && result.error).toMatch(/^Innovativeness:/);
  });

  it("needs every criterion", () => {
    expect(parseBreakdown({ c1: "20" }, criteria, 1).ok).toBe(false);
  });
});
