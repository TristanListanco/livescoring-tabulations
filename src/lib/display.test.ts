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

describe("lowest scores", () => {
  const sheet = [
    { id: "c1", name: "Content", max: 40, min: 28 },
    { id: "c2", name: "Delivery", max: 35, min: 24.5 },
    { id: "c3", name: "Grace", max: 25, min: 17.5 },
  ];

  it("refuses a criterion score under its lowest, naming the range", () => {
    expect(parseBreakdown({ c1: "20", c2: "30", c3: "20" }, sheet, 1)).toEqual({ ok: false, error: "Content: Enter a score from 28 to 40." });
    expect(parseBreakdown({ c1: "28", c2: "24.5", c3: "17.5" }, sheet, 1)).toEqual({ ok: true, total: 70, breakdown: { c1: 28, c2: 24.5, c3: 17.5 } });
  });

  it("describes the range in the rules", () => {
    expect(rulesSummary({ ...percent, criteria: sheet, min: 0, max: 100 })).toBe(
      "Criteria: Content 28 to 40, Delivery 24.5 to 35, Grace 17.5 to 25. Totals out of 100, shown as a percentage.",
    );
  });
});
