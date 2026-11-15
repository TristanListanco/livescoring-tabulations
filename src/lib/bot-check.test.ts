import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const verdict = vi.fn();
vi.mock("botid/server", () => ({ checkBotId: () => verdict() }));
const { signInByBot } = await import("./bot-check");

afterEach(() => {
  vi.unstubAllEnvs();
  verdict.mockReset();
});

describe("bot check on sign-in", () => {
  it("is left out off Vercel (a venue laptop, local development), where the sign-in limits guard alone", async () => {
    vi.stubEnv("VERCEL", "");
    expect(await signInByBot("admin")).toBe(false);
    expect(verdict).not.toHaveBeenCalled();
  });

  it("refuses what BotID calls a bot on Vercel", async () => {
    vi.stubEnv("VERCEL", "1");
    verdict.mockResolvedValue({ isBot: true });
    expect(await signInByBot("judge")).toBe(true);
    verdict.mockResolvedValue({ isBot: false });
    expect(await signInByBot("judge")).toBe(false);
  });

  it("lets a sign-in through to the limits when the check can't be made, rather than locking people out", async () => {
    vi.stubEnv("VERCEL", "1");
    verdict.mockRejectedValue(new Error("unreachable"));
    expect(await signInByBot("admin")).toBe(false);
  });
});
