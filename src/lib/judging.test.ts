import { describe, expect, it } from "vitest";
import { entryNeighbors, judgeView, showEntryColumns } from "./judging";

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

describe("entryNeighbors", () => {
  it("starts at the first entry when nothing is on screen", () => {
    expect(entryNeighbors(entries, null)).toMatchObject({ index: -1, entry: null, previous: null, next: entries[0] });
  });

  it("finds the entries before and after the current one", () => {
    expect(entryNeighbors(entries, "e1")).toMatchObject({ index: 0, entry: entries[0], previous: null, next: entries[1] });
    expect(entryNeighbors(entries, "e2")).toMatchObject({ index: 1, entry: entries[1], previous: entries[0], next: null });
  });
});

describe("showEntryColumns", () => {
  it("puts the entry judges are shown on the LED wall too", () => {
    expect(showEntryColumns("e2")).toEqual({ current_entry_id: "e2", led_entry_id: "e2" });
  });

  it("leaves the LED wall alone when judges go back to waiting", () => {
    expect(showEntryColumns(null)).toEqual({ current_entry_id: null });
  });
});
