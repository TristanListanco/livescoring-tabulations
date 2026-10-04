import { describe, expect, it } from "vitest";
import { activityFixture } from "./test-fixtures";
import { applyKey, formatAverage, parseScore, rankEntries, scoreProgress, type Key, type ScoreRules } from "./scoring";

const press = (keys: Key[], rules: ScoreRules) => keys.reduce((buf, k) => applyKey(buf, k, rules), "");

describe("applyKey", () => {
  const twoDp: ScoreRules = { min: 1, max: 10, decimals: 2 };
  const whole: ScoreRules = { min: 0, max: 100, decimals: 0 };

  it("builds a decimal score", () => {
    expect(press(["9", ".", "7", "5"], twoDp)).toBe("9.75");
  });

  it("caps fraction digits at the configured decimals", () => {
    expect(press(["9", ".", "7", "5", "1"], twoDp)).toBe("9.75");
    expect(press(["9", ".", "5", "5"], { ...twoDp, decimals: 1 })).toBe("9.5");
  });

  it("ignores the decimal point for whole-number activities", () => {
    expect(press(["8", ".", "5"], whole)).toBe("85");
  });

  it("starts with 0. when the point is pressed first", () => {
    expect(press([".", "5"], twoDp)).toBe("0.5");
  });

  it("limits integer digits to the length of max", () => {
    expect(press(["1", "0", "0", "5"], whole)).toBe("100");
    expect(press(["9", "9"], twoDp)).toBe("99");
  });

  it("replaces a lone leading zero", () => {
    expect(press(["0", "7"], twoDp)).toBe("7");
  });

  it("supports backspace and clear", () => {
    expect(press(["9", ".", "5", "back"], twoDp)).toBe("9.");
    expect(press(["9", "clear"], twoDp)).toBe("");
  });
});

describe("parseScore", () => {
  const rules: ScoreRules = { min: 1, max: 10, decimals: 2 };

  it("accepts values inside the range", () => {
    expect(parseScore("1", rules)).toEqual({ ok: true, value: 1 });
    expect(parseScore("9.75", rules)).toEqual({ ok: true, value: 9.75 });
    expect(parseScore("10", rules)).toEqual({ ok: true, value: 10 });
  });

  it("rejects values outside the range", () => {
    expect(parseScore("0.99", rules).ok).toBe(false);
    expect(parseScore("10.01", rules).ok).toBe(false);
  });

  it("rejects too many decimal places", () => {
    expect(parseScore("9.755", rules).ok).toBe(false);
    expect(parseScore("9.5", { ...rules, decimals: 0 })).toEqual({ ok: false, error: "Use a whole number." });
  });

  it("rejects empty or malformed input", () => {
    expect(parseScore("", rules).ok).toBe(false);
    expect(parseScore("-5", rules).ok).toBe(false);
    expect(parseScore("1e1", rules).ok).toBe(false);
  });
});

describe("rankEntries", () => {
  const judges = [
    { id: "j1", name: "A", photoUrl: null, position: 0 },
    { id: "j2", name: "B", photoUrl: null, position: 1 },
  ];
  const entries = [
    { id: "e1", name: "One", position: 0 },
    { id: "e2", name: "Two", position: 1 },
    { id: "e3", name: "Three", position: 2 },
    { id: "e4", name: "Four", position: 3 },
  ];

  it("ranks by average with shared ranks for ties and unscored entries last", () => {
    const rows = rankEntries(entries, judges, [
      { entryId: "e1", judgeId: "j1", value: 8 },
      { entryId: "e1", judgeId: "j2", value: 9 },
      { entryId: "e2", judgeId: "j1", value: 9.5 },
      { entryId: "e3", judgeId: "j1", value: 8.5 },
    ]);
    expect(rows.map((r) => [r.entry.id, r.rank, formatAverage(r.averageHundredths)])).toEqual([
      ["e2", 1, "9.50"],
      ["e1", 2, "8.50"],
      ["e3", 2, "8.50"],
      ["e4", null, "—"],
    ]);
    expect(rows[1].count).toBe(2);
  });

  it("ignores scores from judges that no longer exist", () => {
    const rows = rankEntries(entries.slice(0, 1), judges, [{ entryId: "e1", judgeId: "gone", value: 10 }]);
    expect(rows[0].averageHundredths).toBeNull();
  });

  it("rounds averages to hundredths", () => {
    const rows = rankEntries(entries.slice(0, 1), [...judges, { id: "j3", name: "C", photoUrl: null, position: 2 }], [
      { entryId: "e1", judgeId: "j1", value: 8 },
      { entryId: "e1", judgeId: "j2", value: 9 },
      { entryId: "e1", judgeId: "j3", value: 9 },
    ]);
    expect(formatAverage(rows[0].averageHundredths)).toBe("8.67");
  });
});

describe("scoreProgress", () => {
  const activity = activityFixture();
  const judges = [{ id: "j1", name: "A", photoUrl: null, position: 0 }, { id: "j2", name: "B", photoUrl: null, position: 1 }];
  const entries = [{ id: "e1", name: "One", position: 0 }];

  it("is complete only when every judge scored every entry", () => {
    const one = [{ entryId: "e1", judgeId: "j1", value: 9 }];
    expect(scoreProgress({ activity, judges, entries, scores: one })).toEqual({ submitted: 1, possible: 2, complete: false });
    const both = [...one, { entryId: "e1", judgeId: "j2", value: 8 }];
    expect(scoreProgress({ activity, judges, entries, scores: both }).complete).toBe(true);
  });

  it("is never complete for an empty activity", () => {
    expect(scoreProgress({ activity, judges: [], entries: [], scores: [] }).complete).toBe(false);
  });
});
