import { describe, expect, it } from "vitest";
import { shuffle } from "./shuffle";

describe("shuffle", () => {
  it("swaps each place, from the last, with the one picked", () => {
    // Picks 0, then 1, then 0: [a b c d] → [d b c a] → [d c b a] → [c d b a].
    const picks = [0, 1, 0];
    expect(shuffle(["a", "b", "c", "d"], () => picks.shift()!)).toEqual(["c", "d", "b", "a"]);
  });

  it("keeps every item once and leaves the list it was given alone", () => {
    const items = ["Agila", "Banog", "Cabagan", "Dalisay", "Esteban"];
    for (let run = 0; run < 50; run++) {
      const order = shuffle(items);
      expect([...order].sort()).toEqual([...items].sort());
    }
    expect(items).toEqual(["Agila", "Banog", "Cabagan", "Dalisay", "Esteban"]);
  });

  it("can come out in any order", () => {
    const seen = new Set<string>();
    for (let run = 0; run < 600 && seen.size < 6; run++) seen.add(shuffle(["a", "b", "c"]).join(""));
    expect(seen.size).toBe(6);
  });

  it("leaves nothing and a single item as they are", () => {
    expect(shuffle([])).toEqual([]);
    expect(shuffle(["Agila"])).toEqual(["Agila"]);
  });
});
