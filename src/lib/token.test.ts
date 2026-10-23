import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const { fingerprint, fingerprints, signToken, verifyToken } = await import("./token");

const OLD = "old-secret-old-secret-old-secret-0001";
const NEW = "new-secret-new-secret-new-secret-0002";
const payload = { role: "judge" as const, sub: "judge-1", dev: "device-1", exp: Date.now() + 60_000 };

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("session tokens", () => {
  it("are accepted for their role while they last, and refused once changed", () => {
    vi.stubEnv("SESSION_SECRET", NEW);
    const token = signToken(payload);
    expect(verifyToken(token, "judge")).toMatchObject({ sub: "judge-1", dev: "device-1" });
    expect(verifyToken(token, "admin")).toBeNull();
    const [body, signature] = token.split(".");
    const forged = Buffer.from(JSON.stringify({ ...payload, sub: "judge-2" })).toString("base64url");
    expect(verifyToken(`${forged}.${signature}`, "judge")).toBeNull();
    expect(verifyToken(`${body}.`, "judge")).toBeNull();
    expect(verifyToken(signToken({ ...payload, exp: Date.now() - 1 }), "judge")).toBeNull();
  });

  it("refuse a token signed with another secret", () => {
    vi.stubEnv("SESSION_SECRET", OLD);
    const token = signToken(payload);
    vi.stubEnv("SESSION_SECRET", NEW);
    expect(verifyToken(token, "judge")).toBeNull();
  });

  it("signed with the previous secret still work while it rotates, and new ones are signed with the new secret", () => {
    vi.stubEnv("SESSION_SECRET", OLD);
    const before = signToken(payload);
    vi.stubEnv("SESSION_SECRET", NEW);
    vi.stubEnv("SESSION_SECRET_PREVIOUS", OLD);
    expect(verifyToken(before, "judge")).toMatchObject({ sub: "judge-1" });
    const after = signToken(payload);
    // Once the previous secret is removed, only the new one counts.
    vi.stubEnv("SESSION_SECRET_PREVIOUS", "");
    expect(verifyToken(after, "judge")).toMatchObject({ sub: "judge-1" });
    expect(verifyToken(before, "judge")).toBeNull();
  });

  it("ignore a previous secret too short to be one", () => {
    vi.stubEnv("SESSION_SECRET", OLD);
    const token = signToken(payload);
    vi.stubEnv("SESSION_SECRET", NEW);
    vi.stubEnv("SESSION_SECRET_PREVIOUS", "too-short");
    expect(verifyToken(token, "judge")).toBeNull();
  });

  it("need a SESSION_SECRET of at least 32 characters", () => {
    vi.stubEnv("SESSION_SECRET", "too-short");
    expect(() => signToken(payload)).toThrow(/at least 32 characters/);
  });
});

describe("fingerprints", () => {
  it("are the current one, plus the previous secret's while it rotates", () => {
    vi.stubEnv("SESSION_SECRET", OLD);
    const old = fingerprint("admin password");
    vi.stubEnv("SESSION_SECRET", NEW);
    vi.stubEnv("SESSION_SECRET_PREVIOUS", OLD);
    expect(fingerprints("admin password")).toEqual([fingerprint("admin password"), old]);
    expect(fingerprint("admin password")).not.toBe(old);
    vi.stubEnv("SESSION_SECRET_PREVIOUS", "");
    expect(fingerprints("admin password")).toEqual([fingerprint("admin password")]);
  });
});
