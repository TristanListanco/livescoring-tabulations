import { describe, expect, it } from "vitest";
import { fullName, firstNames, nameParts } from "./names";

const judge = (id: string, firstName: string | null, lastName: string | null, name = fullName(firstName ?? "", lastName ?? "")) => ({
  id,
  name,
  firstName,
  lastName,
});

describe("names", () => {
  it("joins first and last name into the full name", () => {
    expect(fullName(" Maria ", " Santos ")).toBe("Maria Santos");
  });

  it("splits a full name saved before names were split", () => {
    expect(nameParts(judge("j1", null, null, "Maria Clara Santos"))).toEqual({ first: "Maria Clara", last: "Santos" });
    expect(nameParts(judge("j1", null, null, "Madonna"))).toEqual({ first: "Madonna", last: "" });
    expect(nameParts(judge("j1", "Maria", "Santos"))).toEqual({ first: "Maria", last: "Santos" });
  });

  it("shows first names on the LED wall, with a last initial when two judges share one", () => {
    const names = firstNames([judge("j1", "Maria", "Santos"), judge("j2", "maria", "Reyes"), judge("j3", "Ben", "Torres"), judge("j4", null, null, "Ana Cruz")]);
    expect([...names.values()]).toEqual(["Maria S.", "maria R.", "Ben", "Ana Cruz"]);
  });
});
