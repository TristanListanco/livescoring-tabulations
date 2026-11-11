import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const { testToolsAllowed } = await import("./environment");

describe("where the test tools are offered", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("never on the live site", () => {
    vi.stubEnv("VERCEL_ENV", "production");
    vi.stubEnv("TEST_TOOLS", "on");
    expect(testToolsAllowed()).toBe(false);
  });

  it("a preview has them only when turned on (a testing preview)", () => {
    vi.stubEnv("VERCEL_ENV", "preview");
    vi.stubEnv("TEST_TOOLS", "");
    vi.stubEnv("TEST_TOOLS", "on");
    expect(testToolsAllowed()).toBe(true);
  });

  it("the dev server has them", () => {
    vi.stubEnv("VERCEL_ENV", "");
    vi.stubEnv("TEST_TOOLS", "");
    expect(testToolsAllowed()).toBe(true);
  });

  it("a production build on a laptop at the venue, on the live database, has none unless it says it's a test one (CI)", () => {
    vi.stubEnv("VERCEL_ENV", "");
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("TEST_TOOLS", "");
    expect(testToolsAllowed()).toBe(false);
    vi.stubEnv("TEST_TOOLS", "on");
    expect(testToolsAllowed()).toBe(true);
  });
});
