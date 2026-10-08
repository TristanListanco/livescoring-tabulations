import { describe, expect, it } from "vitest";
import { basisChoices, blankScoring, checkPageant, defaultBasis, hasCut, type PageantDraft, type RoundDraft } from "./pageant-setup";
import { PRELIMINARY } from "./types";

const round = (key: string, segment: RoundDraft["segment"], weight: string, extra: Partial<RoundDraft> = {}): RoundDraft => ({
  key,
  segment,
  name: key,
  weight,
  scoring: blankScoring(),
  timer: "",
  cut: false,
  cutSize: "",
  cutBasis: null,
  ...extra,
});

const draft = (rounds: RoundDraft[], preliminaryWeight = "30"): PageantDraft => ({ preliminaryWeight, rounds });
const ids = () => "new";

const program = [
  round("Interview", "preliminary", "60"),
  round("Costume", "preliminary", "40"),
  round("Swimsuit", "proper", "30", { cut: true, cutSize: "10" }),
  round("Q&A", "proper", "40", { cut: true, cutSize: "5" }),
  round("Final Q&A", "proper", "30", { cutSize: "3" }),
];

describe("pageant setup", () => {
  it("accepts a full program and fills in what each cut counts", () => {
    const result = checkPageant(draft(program), 20, ids);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.preliminaryWeight).toBe(30);
    expect(result.rounds.map((r) => [r.name, r.position, r.cutSize, r.cutBasis])).toEqual([
      ["Interview", 0, null, []],
      ["Costume", 1, null, []],
      ["Swimsuit", 2, 10, [PRELIMINARY, "Swimsuit"]],
      ["Q&A", 3, 5, ["Q&A"]],
      ["Final Q&A", 4, 3, ["Final Q&A"]],
    ]);
  });

  it("always ends pageant proper with the final cut", () => {
    expect(hasCut(program, program[4])).toBe(true);
    expect(hasCut(program, program[0])).toBe(false);
    const missing = checkPageant(draft(program.map((r) => (r.key === "Final Q&A" ? { ...r, cutSize: "" } : r))), 20, ids);
    expect(missing).toEqual({ ok: false, error: "Final Q&A: enter how many candidates make the final cut, e.g. Top 3.", segment: "proper" });
  });

  it("counts everything so far for the first cut, and only what came since for later ones", () => {
    expect(defaultBasis(program, program[2])).toEqual([PRELIMINARY, "Swimsuit"]);
    expect(defaultBasis(program, program[3])).toEqual(["Q&A"]);
    expect(basisChoices(program, program[3]).map((c) => c.key)).toEqual([PRELIMINARY, "Swimsuit", "Q&A"]);
  });

  it("keeps the organizer's choice of what a cut counts", () => {
    const chosen = program.map((r) => (r.key === "Q&A" ? { ...r, cutBasis: [PRELIMINARY, "Swimsuit", "Q&A"] } : r));
    const result = checkPageant(draft(chosen), 20, ids);
    expect(result.ok && result.rounds[3].cutBasis).toEqual([PRELIMINARY, "Swimsuit", "Q&A"]);
  });

  it("needs each segment's sub-activities to add up to 100%", () => {
    const off = program.map((r) => (r.key === "Costume" ? { ...r, weight: "30" } : r));
    expect(checkPageant(draft(off), 20, ids)).toEqual({
      ok: false,
      error: "The preliminary sub-activities add up to 90%. They must add up to 100%.",
      segment: "preliminary",
    });
  });

  it("needs a preliminary share between 1 and 99 percent", () => {
    expect(checkPageant(draft(program, "100"), 20, ids)).toMatchObject({ ok: false, segment: "preliminary" });
    expect(checkPageant(draft(program, ""), 20, ids)).toMatchObject({ ok: false, segment: "preliminary" });
  });

  it("needs each cut to leave fewer candidates than the one before", () => {
    const tooBig = program.map((r) => (r.key === "Q&A" ? { ...r, cutSize: "10" } : r));
    expect(checkPageant(draft(tooBig), 20, ids)).toEqual({
      ok: false,
      error: "Q&A: the cut has to leave fewer than the 10 candidates before it.",
      segment: "proper",
    });
    expect(checkPageant(draft(program), 8, ids)).toMatchObject({ ok: false, error: "Swimsuit: the cut has to leave fewer than the 8 candidates before it." });
  });

  it("checks each sub-activity's scoring and timer", () => {
    const badRange = program.map((r) => (r.key === "Interview" ? { ...r, scoring: { ...r.scoring, min: "10", max: "5" } } : r));
    expect(checkPageant(draft(badRange), 20, ids)).toMatchObject({ ok: false, error: "Interview: Max score must be higher than min score." });
    const badTimer = program.map((r) => (r.key === "Swimsuit" ? { ...r, timer: "2" } : r));
    expect(checkPageant(draft(badTimer), 20, ids)).toMatchObject({ ok: false, error: "Swimsuit: set the timer from 5 to 3600 seconds, or turn it off." });
    const timed = program.map((r) => (r.key === "Swimsuit" ? { ...r, timer: "45" } : r));
    const result = checkPageant(draft(timed), 20, ids);
    expect(result.ok && result.rounds[2].timerSeconds).toBe(45);
  });

  it("needs both segments, with named, distinct sub-activities", () => {
    expect(checkPageant(draft(program.filter((r) => r.segment === "proper")), 20, ids)).toMatchObject({
      ok: false,
      error: "Add at least one sub-activity to the preliminary.",
    });
    const unnamed = program.map((r) => (r.key === "Costume" ? { ...r, name: " " } : r));
    expect(checkPageant(draft(unnamed), 20, ids)).toMatchObject({ ok: false, segment: "preliminary" });
    const twice = program.map((r) => (r.key === "Costume" ? { ...r, name: "interview" } : r));
    expect(checkPageant(draft(twice), 20, ids)).toMatchObject({ ok: false, error: '"interview" is listed twice. Give each sub-activity its own name.' });
  });
});
