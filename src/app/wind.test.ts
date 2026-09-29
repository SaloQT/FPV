import { describe, expect, it } from 'vitest';
import { WindModel } from './wind';

function sample(w: WindModel, seconds: number, dt = 0.05): { speeds: number[]; froms: number[] } {
  const speeds: number[] = [];
  const froms: number[] = [];
  for (let t = 0; t < seconds; t += dt) {
    w.update(dt);
    speeds.push(w.speed);
    froms.push(w.physics.fromDirection);
  }
  return { speeds, froms };
}

describe('WindModel', () => {
  it('is dead calm with a zero mean', () => {
    const w = new WindModel(3);
    w.configure(0, 90);
    const { speeds } = sample(w, 60);
    expect(Math.max(...speeds)).toBe(0);
    expect(w.physics.meanSpeed).toBe(0);
  });

  it('breathes around the mean within the swing and never goes negative', () => {
    const w = new WindModel(5);
    w.configure(8, 0);
    const { speeds } = sample(w, 300);
    expect(Math.min(...speeds)).toBeGreaterThanOrEqual(0);
    expect(Math.max(...speeds)).toBeLessThanOrEqual(8 * 1.4 + 1e-9);
    expect(Math.min(...speeds)).toBeGreaterThanOrEqual(8 * 0.6 - 1e-9);
    // Really varies, and slowly: consecutive samples differ by little.
    expect(Math.max(...speeds) - Math.min(...speeds)).toBeGreaterThan(1);
    for (let i = 1; i < speeds.length; i++) expect(Math.abs(speeds[i] - speeds[i - 1])).toBeLessThan(0.5);
  });

  it('is deterministic per seed and differs between seeds', () => {
    const a = new WindModel(11);
    const b = new WindModel(11);
    const c = new WindModel(12);
    for (const w of [a, b, c]) w.configure(6, 45);
    const sa = sample(a, 40).speeds;
    const sb = sample(b, 40).speeds;
    const sc = sample(c, 40).speeds;
    expect(sa).toEqual(sb);
    expect(sa).not.toEqual(sc);
  });

  it('keeps the direction a unit vector that points where the air travels', () => {
    const w = new WindModel(2);
    // From the west (270 degrees): the air moves east, +X.
    w.configure(4, 270);
    for (let i = 0; i < 400; i++) {
      w.update(0.1);
      expect(Math.hypot(w.dirXZ[0], w.dirXZ[1])).toBeCloseTo(1, 12);
    }
    const calm = new WindModel(2);
    calm.configure(0.0001, 270);
    calm.update(0);
    expect(calm.dirXZ[0]).toBeGreaterThan(0.99);
    // From the north (0 degrees): the air moves toward +Z (south).
    const n = new WindModel(2);
    n.configure(0, 0);
    expect(n.dirXZ[1]).toBeCloseTo(1, 12);
  });

  it('hands the same arrays and config object out forever (no per-frame allocation)', () => {
    const w = new WindModel(1);
    const dir = w.dirXZ;
    const phys = w.physics;
    w.configure(5, 10);
    sample(w, 5);
    expect(w.dirXZ).toBe(dir);
    expect(w.physics).toBe(phys);
    expect(phys.meanSpeed).toBe(w.speed);
  });

  it('sanitises non-finite and negative settings and clamps huge frame steps', () => {
    const w = new WindModel(1);
    w.configure(Number.NaN, Number.POSITIVE_INFINITY);
    expect(w.meanSpeed).toBe(0);
    expect(w.speed).toBe(0);
    w.configure(-5, 0);
    expect(w.meanSpeed).toBe(0);
    w.configure(3, 0);
    w.update(1e9); // a stalled tab must not throw the phase into garbage
    expect(Number.isFinite(w.speed)).toBe(true);
    expect(w.speed).toBeGreaterThanOrEqual(0);
    w.update(-1); // negative dt does not run time backwards
    expect(Number.isFinite(w.speed)).toBe(true);
  });
});
