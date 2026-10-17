import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const { pageantsAvailable, testToolsAllowed } = await import("./environment");

describe("where the test tools and pageant mode are offered", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("the live site has neither: pageants are coming soon there", () => {
    vi.stubEnv("VERCEL_ENV", "production");
    vi.stubEnv("TEST_TOOLS", "on");
    expect(testToolsAllowed()).toBe(false);
    expect(pageantsAvailable()).toBe(false);
  });

  it("a preview has them only when turned on (a testing preview)", () => {
    vi.stubEnv("VERCEL_ENV", "preview");
    vi.stubEnv("TEST_TOOLS", "");
    expect(pageantsAvailable()).toBe(false);
    vi.stubEnv("TEST_TOOLS", "on");
    expect(testToolsAllowed()).toBe(true);
    expect(pageantsAvailable()).toBe(true);
  });

  it("the dev server has both", () => {
    vi.stubEnv("VERCEL_ENV", "");
    vi.stubEnv("TEST_TOOLS", "");
    expect(testToolsAllowed()).toBe(true);
    expect(pageantsAvailable()).toBe(true);
  });

  it("a production build on a laptop at the venue, on the live database, has neither unless it says it's a test one (CI)", () => {
    vi.stubEnv("VERCEL_ENV", "");
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("TEST_TOOLS", "");
    expect(testToolsAllowed()).toBe(false);
    expect(pageantsAvailable()).toBe(false);
    vi.stubEnv("TEST_TOOLS", "on");
    expect(testToolsAllowed()).toBe(true);
  });
});
