/**
 * The privacy screen's sense of tilt (see usePrivacyScreen). From a device's orientation reading (alpha: turned about
 * the vertical, beta: tipped front to back, gamma: side to side, in degrees), the direction its screen faces, and how
 * far that has turned from where its judge holds it. Turning the screen toward a neighbour, tipping it away or laying it
 * flat all count; spinning it in its own plane (portrait to landscape) doesn't, since it still faces the judge. Pure,
 * so it's tested without a device.
 */

export type Vec = [number, number, number];

const RAD = Math.PI / 180;

/**
 * The way the screen faces, as a unit vector in the room, for an orientation reading (the device's z axis, turned by
 * alpha about the vertical, then beta about its x axis, then gamma about its y axis). A device that doesn't report alpha
 * counts it as 0: tipping still shows, turning on the spot doesn't.
 */
export function facing(alpha: number | null, beta: number, gamma: number): Vec {
  const a = (alpha ?? 0) * RAD;
  const b = beta * RAD;
  const g = gamma * RAD;
  return [
    Math.cos(a) * Math.sin(g) + Math.sin(a) * Math.sin(b) * Math.cos(g),
    Math.sin(a) * Math.sin(g) - Math.cos(a) * Math.sin(b) * Math.cos(g),
    Math.cos(b) * Math.cos(g),
  ];
}

/** The angle between two unit vectors, in degrees. */
export function angle(a: Vec, b: Vec): number {
  const dot = a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  return Math.acos(Math.min(1, Math.max(-1, dot))) / RAD;
}

const normalize = (v: Vec): Vec => {
  const length = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / length, v[1] / length, v[2] / length];
};

export type TiltGuardOptions = {
  /** Hide once the screen has turned this far from where it's held, in degrees. */
  hideAt?: number;
  /** Show again once it's back within this, in degrees: a little closer than hideAt, so it doesn't flicker at the edge. */
  showAt?: number;
  /** Within this of where it's held, the device is still being held: where it's held follows it, slowly. */
  settleWithin?: number;
  /** How slowly where it's held follows the device, in ms (the time it takes to move most of the way). */
  settleMs?: number;
};

/**
 * Whether the screen should be hidden, reading by reading. Where the judge holds the device is the first reading,
 * then follows them slowly as they shift in their seat (within settleWithin); a quicker or bigger turn, toward a
 * neighbour, away from them or face up on the table, hides the screen until it's turned back. `hold()` makes where the
 * device is now the place it's held: the judge's own choice to carry on in a new position.
 */
export function createTiltGuard({ hideAt = 35, showAt = 25, settleWithin = 15, settleMs = 10_000 }: TiltGuardOptions = {}) {
  let held: Vec | null = null;
  let last: Vec | null = null;
  let lastAt: number | null = null;
  let hidden = false;
  const usable = (n: number | null): n is number => n !== null && Number.isFinite(n);
  return {
    /** A reading, at `at` ms. Without beta and gamma (a device without the sensor) it changes nothing. */
    reading(alpha: number | null, beta: number | null, gamma: number | null, at: number): boolean {
      if (!usable(beta) || !usable(gamma)) return hidden;
      const now = facing(usable(alpha) ? alpha : null, beta, gamma);
      last = now;
      if (!held) {
        held = now;
        lastAt = at;
        return hidden;
      }
      const off = angle(held, now);
      hidden = hidden ? off > showAt : off > hideAt;
      if (!hidden && off <= settleWithin && lastAt !== null) {
        const step = 1 - Math.exp(-Math.max(0, at - lastAt) / settleMs);
        held = normalize([held[0] + (now[0] - held[0]) * step, held[1] + (now[1] - held[1]) * step, held[2] + (now[2] - held[2]) * step]);
      }
      lastAt = at;
      return hidden;
    },
    /** Hold the device where it is now: the screen shows, and turning is measured from here. */
    hold(): void {
      if (last) held = last;
      hidden = false;
    },
    get hidden() {
      return hidden;
    },
  };
}
