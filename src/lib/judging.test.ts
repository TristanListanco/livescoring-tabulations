import { describe, expect, it } from "vitest";
import { judgeView } from "./judging";

const entries = [
  { id: "e1", name: "Agila", photoUrl: null, position: 0 },
  { id: "e2", name: "Bagwis", photoUrl: null, position: 1 },
];
const none = new Map<string, number>();

describe("judgeView", () => {
  it("keeps judges waiting until the session starts", () => {
    expect(judgeView({ sessionState: "draft", currentEntryId: "e1" }, entries, none)).toEqual({ kind: "not-started" });
  });

  it("waits for the organizer to show an entry", () => {
    expect(judgeView({ sessionState: "live", currentEntryId: null }, entries, none)).toEqual({ kind: "waiting" });
    expect(judgeView({ sessionState: "live", currentEntryId: "deleted" }, entries, none)).toEqual({ kind: "waiting" });
  });

  it("shows only the entry the organizer picked", () => {
    expect(judgeView({ sessionState: "live", currentEntryId: "e2" }, entries, none)).toEqual({ kind: "scoring", entry: entries[1], number: 2 });
  });

  it("waits for the next entry once the judge has scored the current one", () => {
    const mine = new Map([["e2", 9.5]]);
    expect(judgeView({ sessionState: "live", currentEntryId: "e2" }, entries, mine)).toEqual({ kind: "scored", entry: entries[1], number: 2, value: 9.5 });
  });

  it("closes when the session ends", () => {
    expect(judgeView({ sessionState: "ended", currentEntryId: "e1" }, entries, none)).toEqual({ kind: "ended" });
  });
});
