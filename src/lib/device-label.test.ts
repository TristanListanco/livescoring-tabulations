import { describe, expect, it } from "vitest";
import { deviceLabel } from "./device-label";

describe("deviceLabel", () => {
  it("names common phones, tablets and browsers", () => {
    expect(deviceLabel("Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1")).toBe("iPhone · Safari");
    expect(deviceLabel("Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36")).toBe("Android phone · Chrome");
    expect(deviceLabel("Mozilla/5.0 (Linux; Android 14; SM-X710) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36")).toBe("Android tablet · Chrome");
    expect(deviceLabel("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36 Edg/130.0")).toBe("Windows · Edge");
  });

  it("copes with a missing user agent", () => {
    expect(deviceLabel(null)).toBe("Unknown device · browser");
  });
});
