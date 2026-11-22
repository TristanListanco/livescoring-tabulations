import { describe, expect, it } from "vitest";
import { isPersonName } from "./names";
import { checkPageant, parsePageantDraft } from "./pageant-setup";
import { sampleForm } from "./sample-activity";
import { checkScoring } from "./scoring-rules";

const ids = () => "x";

describe("sample activities", () => {
  it("fills in a pageant whose program, candidates and judges would all be accepted", () => {
    const form = sampleForm("pageant");
    const candidates = String(form.get("entries")).split("\n");
    const checked = checkPageant(parsePageantDraft(String(form.get("pageant")))!, candidates.length, ids);
    expect(checked.ok && checked.rounds.map((r) => r.name)).toEqual(["Closed-door interview", "Production number", "Swimsuit", "Evening gown", "Question and answer"]);
    // Pageant proper needs three judges or more.
    expect(Number(form.get("judgeCount"))).toBeGreaterThanOrEqual(3);
    for (let i = 0; i < Number(form.get("judgeCount")); i++) {
      expect(isPersonName(String(form.get(`judge-${i}-first_name`))) && isPersonName(String(form.get(`judge-${i}-last_name`)))).toBe(true);
    }
  });

  it("fills in an event scored live by criteria", () => {
    const form = sampleForm("event");
    expect(form.get("live_scoring")).toBe("on");
    const scoring = checkScoring(
      { mode: "criteria", min: "", max: "", decimals: Number(form.get("decimals")), criteria: JSON.parse(String(form.get("criteria"))), display: "percent" },
      ids,
      { maxDecimals: 3 },
    );
    expect("scoring" in scoring && scoring.scoring.criteria.map((c) => c.max)).toEqual([40, 30, 30]);
  });
});
