import { describe, expect, it } from "vitest";
import { activityFixture } from "./test-fixtures";
import { applyKey, averageText, overMax, parseScore, rankEntries, scoreProgress, type Key, type ScoreRules } from "./scoring";

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
  const rules = activityFixture();
  const judges = [
    { id: "j1", name: "A", photoUrl: null, position: 0 },
    { id: "j2", name: "B", photoUrl: null, position: 1 },
  ];
  const entries = [
    { id: "e1", name: "One", photoUrl: null, position: 0 },
    { id: "e2", name: "Two", photoUrl: null, position: 1 },
    { id: "e3", name: "Three", photoUrl: null, position: 2 },
    { id: "e4", name: "Four", photoUrl: null, position: 3 },
  ];

  it("ranks by average with shared ranks for ties and unscored entries last", () => {
    const rows = rankEntries(
      entries,
      judges,
      [
        { entryId: "e1", judgeId: "j1", value: 8 },
        { entryId: "e1", judgeId: "j2", value: 9 },
        { entryId: "e2", judgeId: "j1", value: 9.5 },
        { entryId: "e3", judgeId: "j1", value: 8.5 },
      ],
      rules,
    );
    expect(rows.map((r) => [r.entry.id, r.rank, averageText(r.average, rules)])).toEqual([
      ["e2", 1, "9.50"],
      ["e1", 2, "8.50"],
      ["e3", 2, "8.50"],
      ["e4", null, "—"],
    ]);
    expect(rows[1].count).toBe(2);
  });

  it("ignores scores from judges that no longer exist", () => {
    const rows = rankEntries(entries.slice(0, 1), judges, [{ entryId: "e1", judgeId: "gone", value: 10 }], rules);
    expect(rows[0].average).toBeNull();
  });

  const three = [...judges, { id: "j3", name: "C", photoUrl: null, position: 2 }];
  const thirds = [
    { entryId: "e1", judgeId: "j1", value: 8 },
    { entryId: "e1", judgeId: "j2", value: 9 },
    { entryId: "e1", judgeId: "j3", value: 9 },
  ];

  it("rounds averages to the results' decimal places", () => {
    const shown = (resultDecimals: 0 | 1 | 2 | 3 | 4) => {
      const r = activityFixture({ resultDecimals });
      return averageText(rankEntries(entries.slice(0, 1), three, thirds, r)[0].average, r);
    };
    expect([0, 1, 2, 3, 4].map((d) => shown(d as 0 | 1 | 2 | 3 | 4))).toEqual(["9", "8.7", "8.67", "8.667", "8.6667"]);
  });

  it("rounds halves up, whatever the floating point error", () => {
    // 8.125 and 1.005 aren't exact in binary; the average still rounds up.
    const r = activityFixture({ resultDecimals: 2 });
    const avg = (values: number[]) =>
      averageText(
        rankEntries(
          entries.slice(0, 1),
          three.slice(0, values.length),
          values.map((value, i) => ({ entryId: "e1", judgeId: `j${i + 1}`, value })),
          r,
        )[0].average,
        r,
      );
    expect(avg([8.25, 8])).toBe("8.13");
    expect(avg([1.01, 1])).toBe("1.01");
    expect(
      averageText(
        rankEntries(entries.slice(0, 1), three, thirds, activityFixture({ resultDecimals: 0 }))[0].average,
        activityFixture({ resultDecimals: 0 }),
      ),
    ).toBe("9");
  });

  it("ties entries whose averages look the same", () => {
    const scores = [
      { entryId: "e1", judgeId: "j1", value: 8.5 },
      { entryId: "e1", judgeId: "j2", value: 8.6 },
      { entryId: "e2", judgeId: "j1", value: 8.5 },
      { entryId: "e2", judgeId: "j2", value: 8.7 },
    ];
    const ranks = (resultDecimals: 0 | 1 | 2) =>
      rankEntries(entries.slice(0, 2), judges, scores, activityFixture({ resultDecimals })).map((r) => r.rank);
    expect(ranks(2)).toEqual([1, 2]);
    expect(ranks(0)).toEqual([1, 1]);
  });

  it("ranks criteria shown scaled to 10 on the scaled value", () => {
    const r = activityFixture({ scoringMode: "criteria", criteriaDisplay: "ten", resultDecimals: 1 });
    const rows = rankEntries(
      entries.slice(0, 2),
      judges.slice(0, 1),
      [
        { entryId: "e1", judgeId: "j1", value: 87.4 },
        { entryId: "e2", judgeId: "j1", value: 87.1 },
      ],
      r,
    );
    expect(rows.map((row) => [averageText(row.average, r), row.rank])).toEqual([
      ["8.7", 1],
      ["8.7", 1],
    ]);
  });
});

describe("overMax", () => {
  it("flags typed scores above the max straight away", () => {
    expect(overMax("11", { max: 10 })).toBe(true);
    expect(overMax("10.5", { max: 10 })).toBe(true);
    expect(overMax("10", { max: 10 })).toBe(false);
    expect(overMax("10.", { max: 10 })).toBe(false);
    expect(overMax("", { max: 10 })).toBe(false);
    expect(overMax("31", { max: 30 })).toBe(true);
  });
});

describe("scoreProgress", () => {
  const activity = activityFixture();
  const judges = [
    { id: "j1", name: "A", photoUrl: null, position: 0 },
    { id: "j2", name: "B", photoUrl: null, position: 1 },
  ];
  const entries = [{ id: "e1", name: "One", photoUrl: null, position: 0 }];

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
