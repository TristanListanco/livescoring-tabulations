import { describe, expect, it } from "vitest";
import { angle, createTiltGuard, facing } from "./tilt";

describe("the way the screen faces", () => {
  it("is a unit vector, and turns as the device does", () => {
    for (const [alpha, beta, gamma] of [
      [0, 0, 0],
      [30, 45, 10],
      [200, -80, 60],
    ]) {
      const [x, y, z] = facing(alpha, beta, gamma);
      expect(Math.hypot(x, y, z)).toBeCloseTo(1, 10);
    }
    // Lying flat, tipped up 30 degrees.
    expect(angle(facing(0, 0, 0), facing(0, 30, 0))).toBeCloseTo(30, 6);
    // Held upright and turned 40 degrees on the spot, toward a neighbour.
    expect(angle(facing(0, 90, 0), facing(40, 90, 0))).toBeCloseTo(40, 6);
    // Spun in its own plane (portrait to landscape) it still faces the same way.
    expect(angle(facing(0, 0, 0), facing(90, 0, 0))).toBeCloseTo(0, 6);
  });

  it("without alpha, still sees tipping", () => {
    expect(angle(facing(null, 60, 0), facing(null, 20, 0))).toBeCloseTo(40, 6);
  });
});

describe("the tilt guard", () => {
  it("holds the first reading, hides past 35 degrees and shows again within 25", () => {
    const guard = createTiltGuard();
    let t = 0;
    // Held nearly upright, then turned toward a neighbour.
    const turn = (alpha: number) => guard.reading(alpha, 80, 0, (t += 50));
    expect(turn(0)).toBe(false);
    expect(turn(30)).toBe(false);
    expect(turn(40)).toBe(true);
    // Back to 30 isn't enough: it shows once it's within 25.
    expect(turn(30)).toBe(true);
    expect(turn(20)).toBe(false);
  });

  it("follows the judge shifting slowly, and still hides a quick turn", () => {
    const guard = createTiltGuard();
    let t = 0;
    guard.reading(0, 80, 0, t);
    // Ten degrees, held for a minute: where it's held follows.
    for (let i = 0; i < 1200; i++) guard.reading(10, 80, 0, (t += 50));
    // 42 degrees from the start is only 32 from where it's held now: it shows.
    expect(guard.reading(42, 80, 0, (t += 100))).toBe(false);
    // A quick turn well past that hides it.
    expect(guard.reading(60, 80, 0, (t += 100))).toBe(true);
  });

  it("can be held in a new position by the judge", () => {
    const guard = createTiltGuard();
    guard.reading(0, 80, 0, 0);
    // Laid flat on the table: hidden, until the judge says to carry on there.
    expect(guard.reading(0, 0, 0, 100)).toBe(true);
    guard.hold();
    expect(guard.hidden).toBe(false);
    expect(guard.reading(0, 2, 1, 200)).toBe(false);
  });

  it("ignores readings without the sensor", () => {
    const guard = createTiltGuard();
    expect(guard.reading(null, null, null, 0)).toBe(false);
    expect(guard.reading(0, Number.NaN, 0, 50)).toBe(false);
  });
});
