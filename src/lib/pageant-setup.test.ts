import { describe, expect, it } from "vitest";
import {
  basisChoices,
  blankScoring,
  chairGap,
  aloneAfterCut,
  checkPageant,
  checkViolations,
  criteriaForCheck,
  parsePageantDraft,
  fitShares,
  properStages,
  shareScope,
  stageOf,
  defaultBasis,
  draftFromRounds,
  evenShares,
  hasCut,
  panelGap,
  rescaleShares,
  roundShare,
  segmentShare,
  sharesWithOneMore,
  typedLowest,
  type PageantDraft,
  type PartDraft,
  type RoundDraft,
} from "./pageant-setup";
import { roundFixture } from "./test-fixtures";
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
  parts: null,
  ...extra,
});

const draft = (rounds: RoundDraft[], preliminaryWeight = "30"): PageantDraft => ({ preliminaryWeight, rounds });
const ids = () => "new";

// Shares are percentages of the overall score: the preliminary (30%) is 18 + 12, and pageant proper (70%) is the
// swimsuit up to the Top 10 cut. Scores start over after each cut, so the Q&A and the final Q&A are 100% each.
const program = [
  round("Interview", "preliminary", "18"),
  round("Costume", "preliminary", "12"),
  round("Swimsuit", "proper", "70", { cut: true, cutSize: "10" }),
  round("Q&A", "proper", "100", { cut: true, cutSize: "5" }),
  round("Final Q&A", "proper", "100", { cutSize: "3" }),
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
    expect(missing).toEqual({
      ok: false,
      error: "Final Q&A: enter how many candidates make the final cut, e.g. Top 3.",
      segment: "proper",
      target: { input: "cut", round: "Final Q&A" },
    });
  });

  it("counts everything so far for the first cut, and only what came since for later ones", () => {
    expect(defaultBasis(program, program[2])).toEqual([PRELIMINARY, "Swimsuit"]);
    expect(defaultBasis(program, program[3])).toEqual(["Q&A"]);
    // Scores start over after a cut: a later cut can only count its own stage.
    expect(basisChoices(program, program[2]).map((c) => c.key)).toEqual([PRELIMINARY, "Swimsuit"]);
    expect(basisChoices(program, program[3]).map((c) => c.key)).toEqual(["Q&A"]);
  });

  it("keeps the organizer's choice of what a cut counts, within its stage", () => {
    const chosen = program.map((r) =>
      r.key === "Swimsuit" ? { ...r, cutBasis: ["Swimsuit"] } : r.key === "Q&A" ? { ...r, cutBasis: [PRELIMINARY, "Swimsuit", "Q&A"] } : r,
    );
    const result = checkPageant(draft(chosen), 20, ids);
    expect(result.ok && result.rounds.map((r) => r.cutBasis)).toEqual([[], [], ["Swimsuit"], ["Q&A"], ["Final Q&A"]]);
  });

  it("needs each segment's sub-activities to add up to its share of the overall score", () => {
    const off = program.map((r) => (r.key === "Costume" ? { ...r, weight: "10" } : r));
    expect(checkPageant(draft(off), 20, ids)).toEqual({
      ok: false,
      error: "The preliminary sub-activities add up to 28%. They must add up to 30%, the preliminary's share of the overall score.",
      segment: "preliminary",
      // The setup points at the group's first share.
      target: { input: "share", round: "Interview" },
    });
    const result = checkPageant(draft(program), 20, ids);
    expect(result.ok && result.rounds.map((r) => r.weight)).toEqual([18, 12, 70, 100, 100]);
  });

  it("starts the shares over after each cut", () => {
    expect(properStages(program).map((stage) => stage.map((r) => r.key))).toEqual([["Swimsuit"], ["Q&A"], ["Final Q&A"]]);
    expect(stageOf(program, program[0])).toBeNull();
    expect(stageOf(program, program[3])).toBe(1);
    expect(shareScope(program, program[2])).toBe("of the overall score");
    expect(shareScope(program, program[4])).toBe("of the score after the Top 5 cut");

    // Up to the first cut, pageant proper's sub-activities add up to its 70%.
    const firstOff = program.map((r) => (r.key === "Swimsuit" ? { ...r, weight: "60" } : r));
    expect(checkPageant(draft(firstOff), 20, ids)).toEqual({
      ok: false,
      error: "The pageant proper sub-activities up to the first cut add up to 60%. They must add up to 70%, the pageant proper's share of the overall score.",
      segment: "proper",
      target: { input: "share", round: "Swimsuit" },
    });
    // After a cut, to 100%: the scores before it don't carry over.
    const laterOff = [...program.slice(0, 4), round("Gown", "proper", "60"), { ...program[4], weight: "30" }];
    expect(checkPageant(draft(laterOff), 20, ids)).toEqual({
      ok: false,
      error: "The sub-activities after the Top 5 cut add up to 90%. Scores start over after a cut, so they must add up to 100%.",
      segment: "proper",
      target: { input: "share", round: "Gown" },
    });
    // Alone after a cut, a sub-activity is 100% whatever its share field held.
    const lone = program.map((r) => (r.key === "Q&A" ? { ...r, weight: "" } : r));
    expect(aloneAfterCut(program, program[3])).toBe(true);
    expect(aloneAfterCut(program, program[2])).toBe(false);
    const checked = checkPageant(draft(lone), 20, ids);
    expect(checked.ok && checked.rounds[3].weight).toBe(100);
    expect(fitShares(draft(lone)).rounds[3].weight).toBe("100");
    // Two sub-activities between cuts share the 100%.
    const shared = [...program.slice(0, 4), round("Gown", "proper", "60"), { ...program[4], weight: "40" }];
    expect(checkPageant(draft(shared), 20, ids).ok).toBe(true);
  });

  it("fits the shares to the stages when cuts come and go", () => {
    // Taking the Top 5 cut away joins the Q&A and the final Q&A in one stage: 50% each.
    const merged = fitShares(draft(program.map((r) => (r.key === "Q&A" ? { ...r, cut: false } : r))));
    expect(merged.rounds.map((r) => r.weight)).toEqual(["18", "12", "70", "50", "50"]);
    // Adding a cut after the first of two sub-activities in pageant proper's first stage gives each stage its own total.
    const before = draft([program[0], program[1], round("Gown", "proper", "35"), round("Talent", "proper", "35", { cutSize: "3" })]);
    const split = fitShares({ ...before, rounds: before.rounds.map((r) => (r.key === "Gown" ? { ...r, cut: true, cutSize: "5" } : r)) });
    expect(split.rounds.map((r) => r.weight)).toEqual(["18", "12", "70", "100"]);
    // Shares still blank are left for the organizer to type.
    const blank = draft([...program.slice(0, 4), round("New", "proper", ""), program[4]]);
    expect(fitShares(blank).rounds.map((r) => r.weight)).toEqual(blank.rounds.map((r) => r.weight));
  });

  it("takes shares to the hundredth", () => {
    const thirds = program.map((r) => (r.key === "Interview" ? { ...r, weight: "17.67" } : r.key === "Costume" ? { ...r, weight: "12.33" } : r));
    expect(checkPageant(draft(thirds), 20, ids).ok).toBe(true);
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
      target: { input: "cut", round: "Q&A" },
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

describe("shares", () => {
  it("splits a segment's share as evenly as whole numbers allow, or to the hundredth", () => {
    expect(evenShares(40, 2)).toEqual(["20", "20"]);
    expect(evenShares(40, 3)).toEqual(["14", "13", "13"]);
    expect(evenShares(100, 3)).toEqual(["34", "33", "33"]);
    expect(evenShares(2, 3)).toEqual(["0.67", "0.67", "0.66"]);
  });

  it("gives a new sub-activity what's left of its segment's share, or splits it evenly once it's used", () => {
    expect(sharesWithOneMore(["20"], 40)).toEqual({ shares: ["20", "20"], evened: false });
    expect(sharesWithOneMore(["20", "20"], 40)).toEqual({ shares: ["14", "13", "13"], evened: true });
    expect(sharesWithOneMore(["60"], 60)).toEqual({ shares: ["30", "30"], evened: true });
  });

  it("rescales shares to a new total, keeping their proportions and adding up exactly", () => {
    expect(rescaleShares(["20", "10", "10"], 30)).toEqual(["15", "7.5", "7.5"]);
    expect(rescaleShares(["10", "20"], 40)).toEqual(["13.33", "26.67"]);
    expect(rescaleShares(["30"], 40)).toEqual(["40"]);
  });

  it("knows a segment's share, and a sub-activity's from its parts", () => {
    expect(segmentShare(draft(program, "40"), "preliminary")).toBe(40);
    expect(segmentShare(draft(program, "40"), "proper")).toBe(60);
    expect(segmentShare(draft(program, ""), "proper")).toBeNull();
    expect(roundShare({ weight: "", parts: [{ key: "a", name: "", weight: "20", scoring: blankScoring(), timer: "" }, { key: "b", name: "", weight: "10.5", scoring: blankScoring(), timer: "" }] })).toBe(30.5);
  });
});

describe("sub-activities with parts", () => {
  const part = (key: string, weight: string, extra: Partial<PartDraft> = {}): PartDraft => ({ key, name: key, weight, scoring: blankScoring(), timer: "", ...extra });
  const withParts = (parts: PartDraft[]) =>
    program.map((r) => (r.key === "Interview" ? { ...r, parts, scoring: { ...r.scoring, min: "", max: "" } } : r));

  it("checks each part and keeps them in order, the sub-activity counting for their total", () => {
    // The interview's 18% of the overall score, in parts: 9 + 6 + 3.
    const result = checkPageant(draft(withParts([part("Q&A", "9"), part("Advocacy", "6"), part("Video", "3", { timer: "45" })])), 20, ids);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.rounds[0].weight).toBe(18);
    expect(result.rounds[0].parts.map((p) => [p.name, p.position, p.weight, p.timerSeconds])).toEqual([
      ["Q&A", 0, 9, null],
      ["Advocacy", 1, 6, null],
      ["Video", 2, 3, 45],
    ]);
    // The sub-activity's own (blank) scoring doesn't matter once it has parts.
    expect(result.rounds[0].scoring.rules).toEqual({ min: 0, max: 100, decimals: 0 });
  });

  it("needs the parts to fill the segment's share with the other sub-activities, and names", () => {
    expect(checkPageant(draft(withParts([part("Q&A", "9"), part("Advocacy", "6")])), 20, ids)).toMatchObject({
      ok: false,
      error: "The preliminary sub-activities and their parts add up to 27%. They must add up to 30%, the preliminary's share of the overall score.",
      segment: "preliminary",
    });
    expect(checkPageant(draft(withParts([part("Q&A", "18")])), 20, ids)).toMatchObject({ ok: false, error: "Interview: add at least two parts, or score it as a whole." });
    expect(checkPageant(draft(withParts([part("Q&A", "9"), part(" ", "9")])), 20, ids)).toMatchObject({ ok: false, error: "Give every part of Interview a name." });
    const badRange = [part("Q&A", "9", { scoring: { ...blankScoring(), min: "10", max: "5" } }), part("Advocacy", "9")];
    expect(checkPageant(draft(withParts(badRange)), 20, ids)).toMatchObject({
      ok: false,
      error: "Interview · Q&A: Max score must be higher than min score.",
      target: { input: "scoring", round: "Interview", part: "Q&A" },
    });
  });

  it("comes back from the saved sub-activities with its parts", () => {
    const interview = roundFixture({ id: "i", name: "Interview", segment: "preliminary", weight: 100 });
    const qna = roundFixture({ id: "q", name: "Q&A", segment: "preliminary", weight: 60, parentId: "i", min: 0, max: 100, decimals: 0 });
    const advocacy = roundFixture({ id: "a", name: "Advocacy", segment: "preliminary", position: 1, weight: 40, parentId: "i", timerSeconds: 30 });
    const night = roundFixture({ id: "n", name: "Night", segment: "proper", cutSize: 3, cutBasis: ["n"] });
    // Saved before shares were of the overall score: each level added up to 100, and comes back as overall percentages.
    const back = draftFromRounds(30, [advocacy, night, qna, interview]);
    expect(back.rounds.map((r) => [r.key, r.weight])).toEqual([
      ["i", "30"],
      ["n", "70"],
    ]);
    expect(back.rounds[0].parts?.map((p) => [p.key, p.name, p.weight, p.timer, p.scoring.max])).toEqual([
      ["q", "Q&A", "18", "", "100"],
      ["a", "Advocacy", "12", "30", "10"],
    ]);
    expect(back.rounds[1].parts).toBeNull();

    // Saved as overall percentages: they come back as they are.
    const now = draftFromRounds(40, [
      { ...interview, weight: 40 },
      { ...qna, weight: 20 },
      { ...advocacy, weight: 20 },
      { ...night, weight: 60 },
    ]);
    expect(now.rounds[0].parts?.map((p) => p.weight)).toEqual(["20", "20"]);
    expect(now.rounds.map((r) => r.weight)).toEqual(["40", "60"]);

    // Saved when pageant proper's shares added up to its share across its cuts: each stage now has its own total.
    const gown = roundFixture({ id: "g", name: "Gown", segment: "proper", position: 0, weight: 36, cutSize: 2, cutBasis: [PRELIMINARY, "g"] });
    const final = roundFixture({ id: "f", name: "Final Q&A", segment: "proper", position: 1, weight: 24, cutSize: 1, cutBasis: ["f"] });
    const staged = draftFromRounds(40, [{ ...interview, weight: 40 }, { ...qna, weight: 20 }, { ...advocacy, weight: 20 }, gown, final]);
    expect(staged.rounds.map((r) => [r.key, r.weight])).toEqual([
      ["i", "40"],
      ["g", "60"],
      ["f", "100"],
    ]);
  });
});

describe("lowest scores, in points", () => {
  // The closed-door interview from a real score sheet: Content 40 (lowest 28), Delivery 35 (24.5), Grace and Confidence 25 (17.5).
  const interviewCriteria = [
    { key: 0, id: "", name: "Content", max: "40", min: "28" },
    { key: 1, id: "", name: "Delivery", max: "35", min: "24.5" },
    { key: 2, id: "", name: "Grace and Confidence", max: "25", min: "17.5" },
  ];

  it("reads each criterion's lowest score, blank for none", () => {
    expect(criteriaForCheck(interviewCriteria).map((c) => c.min)).toEqual([28, 24.5, 17.5]);
    expect(criteriaForCheck([{ key: 0, id: "", name: "Content", max: "40", min: "" }]).map((c) => c.min)).toEqual([0]);
    expect(criteriaForCheck([{ key: 0, id: "", name: "Content", max: "40", min: "2.8.1" }])[0].min).toBeNaN();
  });

  it("keeps what's typed to a number with at most two decimal places", () => {
    expect(typedLowest("24.5")).toBe("24.5");
    expect(typedLowest("17.555")).toBe("17.55");
    expect(typedLowest("2a8")).toBe("28");
    expect(typedLowest("1.2.3")).toBe("1.23");
  });

  it("checks the lowest scores with the rest of a sub-activity's scoring", () => {
    const scoring = { ...blankScoring(), mode: "criteria" as const, criteria: interviewCriteria };
    const result = checkPageant(draft(program.map((r) => (r.key === "Interview" ? { ...r, scoring } : r))), 20, ids);
    expect(result.ok && result.rounds[0].scoring.criteria.map((c) => [c.name, c.min])).toEqual([
      ["Content", 28],
      ["Delivery", 24.5],
      ["Grace and Confidence", 17.5],
    ]);
    const tooHigh = { ...scoring, criteria: [{ ...interviewCriteria[0], min: "40" }, ...interviewCriteria.slice(1)] };
    expect(checkPageant(draft(program.map((r) => (r.key === "Interview" ? { ...r, scoring: tooHigh } : r))), 20, ids)).toMatchObject({
      ok: false,
      error: "Interview: Give Content a lowest score below its 40 points.",
    });
  });

  it("comes back from saved criteria", () => {
    const saved = roundFixture({
      id: "i",
      segment: "preliminary",
      scoringMode: "criteria",
      criteria: [
        { id: "c", name: "Content", max: 40, min: 28 },
        { id: "d", name: "Delivery", max: 60 },
      ],
    });
    expect(draftFromRounds(40, [saved]).rounds[0].scoring.criteria.map((c) => [c.name, c.max, c.min])).toEqual([
      ["Content", "40", "28"],
      ["Delivery", "60", ""],
    ]);
  });
});

describe("boards of judges", () => {
  it("needs a judge for the preliminary and three for pageant proper", () => {
    expect(panelGap(["all", "all", "all"])).toBeNull();
    expect(panelGap(["all", "all"])).toMatch(/^Pageant proper needs at least three judges/);
    expect(panelGap(["preliminary", "proper", "proper", "proper"])).toBeNull();
    expect(panelGap(["preliminary", "proper", "proper"])).toMatch(/^Pageant proper needs at least three judges/);
    expect(panelGap(["proper", "proper", "proper"])).toMatch(/^The preliminary needs at least one judge/);
    // Judges of both segments count for both.
    expect(panelGap(["all", "preliminary", "proper", "proper"])).toBeNull();
  });

  it("gives one board one chair, and separate boards one each", () => {
    const judge = (panel: "all" | "preliminary" | "proper", isChair = false) => ({ panel, isChair });
    expect(chairGap([judge("all", true), judge("all"), judge("all")])).toBeNull();
    expect(chairGap([judge("all"), judge("all")])).toBe("Choose the chair of the board of judges.");
    expect(chairGap([judge("all", true), judge("all", true)])).toBe("Choose one chair for the board of judges.");
    expect(chairGap([judge("preliminary", true), judge("proper", true), judge("proper")])).toBeNull();
    expect(chairGap([judge("preliminary"), judge("proper", true)])).toBe("Choose the chair of the preliminary board of judges.");
    expect(chairGap([judge("preliminary", true), judge("proper")])).toBe("Choose the chair of the pageant proper board of judges.");
    // A chair of both segments already chairs the preliminary.
    expect(chairGap([judge("all", true), judge("preliminary", true)])).toBe("Choose one chair for the preliminary board of judges.");
  });
});

describe("deductions for violations", () => {
  const newIds = () => {
    let n = 0;
    return () => `new-${n++}`;
  };
  const v = (key: string, reason: string, points: string, id = "") => ({ key, id, reason, points });

  it("are off unless turned on", () => {
    expect(checkViolations(null, newIds())).toEqual({ ok: true, violations: null });
    expect(checkViolations(undefined, newIds())).toEqual({ ok: true, violations: null });
    // On with none listed: every deduction's reason is typed at the desk.
    expect(checkViolations([v("a", "", "")], newIds())).toEqual({ ok: true, violations: [] });
  });

  it("list each violation once, with its points", () => {
    const checked = checkViolations([v("a", "  Late for  call time ", "1", "saved"), v("b", "Improper attire", "2.5")], newIds());
    expect(checked).toEqual({
      ok: true,
      violations: [
        { id: "saved", reason: "Late for call time", points: 1 },
        { id: "new-0", reason: "Improper attire", points: 2.5 },
      ],
    });
  });

  it("point at the field to fix", () => {
    expect(checkViolations([v("a", "", "1")], newIds())).toMatchObject({ ok: false, target: { input: "violation", key: "a", field: "reason" } });
    expect(checkViolations([v("a", "Late", "0")], newIds())).toMatchObject({ ok: false, target: { input: "violation", key: "a", field: "points" } });
    expect(checkViolations([v("a", "Late", "1.234")], newIds())).toMatchObject({ ok: false, target: { field: "points" } });
    expect(checkViolations([v("a", "Late", "101")], newIds())).toMatchObject({ ok: false, target: { field: "points" } });
    expect(checkViolations([v("a", "Late", "1"), v("b", "late", "2")], newIds())).toMatchObject({
      ok: false,
      error: '"late" is listed twice. List each violation once.',
      target: { key: "b", field: "reason" },
    });
  });

  it("travel with the program, and stop it on the preliminary's step", () => {
    const program = { ...draft([round("Interview", "preliminary", "30"), round("Gown", "proper", "70", { cutSize: "1" })]), violations: [v("a", "Late", "1")] };
    const parsed = parsePageantDraft(JSON.stringify(program));
    expect(parsed?.violations).toEqual([v("a", "Late", "1")]);
    const checked = checkPageant(program, 3, newIds());
    expect(checked.ok && checked.violations).toEqual([{ id: "new-0", reason: "Late", points: 1 }]);
    expect(checkPageant({ ...program, violations: [v("a", "Late", "")] }, 3, newIds())).toMatchObject({ ok: false, segment: "preliminary" });
    // Saved ones come back for editing on the Segments tab.
    expect(draftFromRounds(30, [], [{ id: "v1", reason: "Late", points: 1.5 }]).violations).toEqual([v("v1", "Late", "1.5", "v1")]);
  });
});
