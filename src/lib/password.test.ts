import { describe, expect, it } from "vitest";
import { hashPassword, passwordVersion, verifyPassword } from "./password";

describe("passwords", () => {
  it("verifies the right password and rejects others", async () => {
    const stored = await hashPassword("correct horse battery");
    expect(stored.startsWith("scrypt$")).toBe(true);
    expect(await verifyPassword("correct horse battery", stored)).toBe(true);
    expect(await verifyPassword("correct horse batterY", stored)).toBe(false);
    expect(await verifyPassword("", stored)).toBe(false);
  });

  it("salts every hash", async () => {
    const a = await hashPassword("same password");
    const b = await hashPassword("same password");
    expect(a).not.toBe(b);
    expect(passwordVersion(a)).not.toBe(passwordVersion(b));
  });

  it("rejects malformed stored values", async () => {
    expect(await verifyPassword("anything", "not-a-hash")).toBe(false);
  });
});
