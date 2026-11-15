import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const { codeLookup, openCode, sealCode, vaultReady } = await import("./code-vault");

const KEY = "a-data-key-of-at-least-32-characters-0001";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("judge codes at rest", () => {
  it("does nothing without DATA_KEY, so codes stay as before", () => {
    vi.stubEnv("DATA_KEY", "");
    expect(vaultReady()).toBe(false);
    expect(codeLookup("ABC234")).toBeNull();
    expect(sealCode("ABC234", "judge-1")).toBeNull();
    vi.stubEnv("DATA_KEY", "too-short");
    expect(vaultReady()).toBe(false);
  });

  it("finds a code by a keyed hash that doesn't show it", () => {
    vi.stubEnv("DATA_KEY", KEY);
    const lookup = codeLookup("ABC234")!;
    expect(lookup).toMatch(/^[0-9a-f]{64}$/);
    expect(codeLookup("ABC234")).toBe(lookup);
    expect(codeLookup("ABC235")).not.toBe(lookup);
    // Another key, another hash: a copy of the database can't be checked against guesses without DATA_KEY.
    vi.stubEnv("DATA_KEY", `${KEY}x`);
    expect(codeLookup("ABC234")).not.toBe(lookup);
  });

  it("seals a code for its judge, freshly each time, and opens it again", () => {
    vi.stubEnv("DATA_KEY", KEY);
    const sealed = sealCode("ABC234", "judge-1")!;
    expect(sealed).not.toContain("ABC234");
    expect(sealCode("ABC234", "judge-1")).not.toBe(sealed);
    expect(openCode(sealed, "judge-1")).toBe("ABC234");
  });

  it("won't open a code moved to another judge, tampered with, or sealed with another key", () => {
    vi.stubEnv("DATA_KEY", KEY);
    const sealed = sealCode("ABC234", "judge-1")!;
    expect(openCode(sealed, "judge-2")).toBeNull();
    const [v, iv, data, tag] = sealed.split(".");
    const flipped = Buffer.from(data, "base64url");
    flipped[0] ^= 1;
    expect(openCode([v, iv, flipped.toString("base64url"), tag].join("."), "judge-1")).toBeNull();
    expect(openCode("not-sealed", "judge-1")).toBeNull();
    vi.stubEnv("DATA_KEY", `${KEY}x`);
    expect(openCode(sealed, "judge-1")).toBeNull();
  });
});
