import { describe, expect, it } from "vitest";
import { hashPassword, oneOfFew, passwordVersion, verifyPassword } from "./password";
import { passwordProblem } from "./password-rules";

describe("password rules", () => {
  it("accepts 8 or more characters with a number and a special character", () => {
    expect(passwordProblem("tabulate-2026")).toBeNull();
    expect(passwordProblem("Abcdef1!")).toBeNull();
    expect(passwordProblem("ñandú#2026")).toBeNull();
  });

  it("names every rule a password misses", () => {
    expect(passwordProblem("abc")).toBe("Passwords need at least 8 characters, a number and a special character.");
    expect(passwordProblem("abcdefgh1")).toBe("Passwords need a special character.");
    expect(passwordProblem("abcdefgh!")).toBe("Passwords need a number.");
    expect(passwordProblem("ab1!")).toBe("Passwords need at least 8 characters.");
  });

  it("doesn't count spaces as special characters", () => {
    expect(passwordProblem("correct horse 1")).toBe("Passwords need a special character.");
  });

  it("refuses very long passwords", () => {
    expect(passwordProblem(`${"a".repeat(200)}1!`)).toBe("That password is too long.");
  });
});

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

describe("oneOfFew", () => {
  it("runs at most two at a time, and every one in turn", async () => {
    let running = 0;
    let most = 0;
    const done: number[] = [];
    const work = (n: number) =>
      oneOfFew(async () => {
        running++;
        most = Math.max(most, running);
        await new Promise((r) => setTimeout(r, 5));
        running--;
        done.push(n);
        return n;
      });
    const results = await Promise.all([1, 2, 3, 4, 5, 6].map(work));
    expect(results).toEqual([1, 2, 3, 4, 5, 6]);
    expect(most).toBe(2);
    expect(done.sort()).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it("frees its place when the work fails", async () => {
    await expect(oneOfFew(async () => Promise.reject(new Error("no")))).rejects.toThrow("no");
    await expect(Promise.all([1, 2, 3].map((n) => oneOfFew(async () => n)))).resolves.toEqual([1, 2, 3]);
  });
});
