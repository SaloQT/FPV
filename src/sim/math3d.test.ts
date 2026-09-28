import { describe, expect, it } from 'vitest';
import type { Quat, Vec3 } from '../contracts';
import { Rng, quatIntegrateBody, quatMul, quatRotate, quatRotateInv, quatSetYaw, quatToMat3, tiltAngle } from './math3d';
import { airDensity, groundEffect } from './propeller';

function axisAngle(ax: number, ay: number, az: number, angle: number): Quat {
  const n = Math.hypot(ax, ay, az);
  const s = Math.sin(angle / 2) / n;
  return [ax * s, ay * s, az * s, Math.cos(angle / 2)];
}

function quatError(a: Quat, b: Quat): number {
  const d = Math.abs(a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3]);
  return 2 * Math.acos(Math.min(1, d));
}

describe('quaternion integration', () => {
  it('constant body rate gives the exact rotation over 4 kHz steps', () => {
    const w: Vec3 = [3.1, -7.4, 12.6];
    const q: Quat = [0, 0, 0, 1];
    const steps = 4000;
    for (let i = 0; i < steps; i++) quatIntegrateBody(q, w[0], w[1], w[2], 1 / 4000);
    const angle = Math.hypot(...w) * 1;
    expect(quatError(q, axisAngle(w[0], w[1], w[2], angle))).toBeLessThan(1e-9);
  });

  it('is exact for one large step and for arbitrary step splitting', () => {
    const w: Vec3 = [-20, 5, 9];
    const big: Quat = [0, 0, 0, 1];
    quatIntegrateBody(big, w[0], w[1], w[2], 0.25);
    const split: Quat = [0, 0, 0, 1];
    for (let i = 0; i < 250; i++) quatIntegrateBody(split, w[0], w[1], w[2], 0.001);
    const exact = axisAngle(w[0], w[1], w[2], Math.hypot(...w) * 0.25);
    expect(quatError(big, exact)).toBeLessThan(1e-12);
    expect(quatError(split, exact)).toBeLessThan(1e-10);
  });

  it('composes with a starting attitude in the body frame', () => {
    const q0 = axisAngle(1, 2, 3, 0.7);
    const q: Quat = [q0[0], q0[1], q0[2], q0[3]];
    for (let i = 0; i < 2000; i++) quatIntegrateBody(q, 0, 8, 0, 1 / 4000);
    const expected: Quat = [0, 0, 0, 1];
    quatMul(expected, q0, axisAngle(0, 1, 0, 4));
    expect(quatError(q, expected)).toBeLessThan(1e-10);
  });

  it('keeps unit norm over a million small steps and survives zero rate', () => {
    const q: Quat = [0, 0, 0, 1];
    for (let i = 0; i < 1_000_000; i++) quatIntegrateBody(q, 5, 3, -2, 1 / 4000);
    expect(Math.hypot(q[0], q[1], q[2], q[3])).toBeCloseTo(1, 12);
    quatIntegrateBody(q, 0, 0, 0, 1 / 4000);
    expect(Math.hypot(q[0], q[1], q[2], q[3])).toBeCloseTo(1, 12);
  });
});

describe('quaternion helpers', () => {
  it('rotate and rotateInv are inverse and agree with the matrix', () => {
    const q = axisAngle(0.3, -0.8, 0.5, 1.9);
    const v: Vec3 = [0.4, -1.2, 2.5];
    const w: Vec3 = [0, 0, 0];
    const back: Vec3 = [0, 0, 0];
    quatRotate(q, v[0], v[1], v[2], w);
    quatRotateInv(q, w[0], w[1], w[2], back);
    for (let i = 0; i < 3; i++) expect(back[i]).toBeCloseTo(v[i], 12);
    const m = new Float64Array(9);
    quatToMat3(q, m);
    for (let r = 0; r < 3; r++) expect(m[3 * r] * v[0] + m[3 * r + 1] * v[1] + m[3 * r + 2] * v[2]).toBeCloseTo(w[r], 12);
  });

  it('positive yaw turns the nose (-Z) to the left (-X)', () => {
    const q: Quat = [0, 0, 0, 1];
    quatSetYaw(q, Math.PI / 2);
    const out: Vec3 = [0, 0, 0];
    quatRotate(q, 0, 0, -1, out);
    expect(out[0]).toBeCloseTo(-1, 12);
    expect(out[2]).toBeCloseTo(0, 12);
  });

  it('tiltAngle is 0 upright, pi inverted', () => {
    expect(tiltAngle([0, 0, 0, 1])).toBeCloseTo(0, 6);
    expect(tiltAngle([1, 0, 0, 0])).toBeCloseTo(Math.PI, 6);
    expect(tiltAngle(axisAngle(0, 0, 1, 0.5))).toBeCloseTo(0.5, 9);
  });
});

describe('Rng', () => {
  it('is deterministic per seed and gaussian with unit variance', () => {
    const a = new Rng(42), b = new Rng(42), c = new Rng(43);
    let same = true, differs = false;
    for (let i = 0; i < 100; i++) {
      const x = a.gauss();
      if (x !== b.gauss()) same = false;
      if (x !== c.gauss()) differs = true;
    }
    expect(same).toBe(true);
    expect(differs).toBe(true);
    const r = new Rng(7);
    let sum = 0, sum2 = 0;
    const n = 100_000;
    for (let i = 0; i < n; i++) {
      const g = r.gauss();
      sum += g;
      sum2 += g * g;
    }
    expect(Math.abs(sum / n)).toBeLessThan(0.02);
    expect(sum2 / n).toBeGreaterThan(0.97);
    expect(sum2 / n).toBeLessThan(1.03);
  });

  it('reseed restarts the sequence', () => {
    const r = new Rng(9);
    const first = [r.next(), r.gauss(), r.gauss()];
    r.reseed(9);
    expect([r.next(), r.gauss(), r.gauss()]).toEqual(first);
  });
});

describe('atmosphere', () => {
  it('matches ISA density at sea level and 2000 m', () => {
    expect(airDensity(0, 15)).toBeCloseTo(1.225, 3);
    expect(airDensity(2000)).toBeCloseTo(1.0066, 3);
    expect(airDensity(0, 35)).toBeLessThan(airDensity(0, 15));
  });

  it('ground effect rises towards the ground and clamps to 1.4', () => {
    const r = 0.065;
    expect(groundEffect(r, r)).toBeCloseTo(1 / (1 - 0.0625), 6);
    expect(groundEffect(4 * r, r)).toBeLessThan(groundEffect(r, r));
    expect(groundEffect(0.001, r)).toBeLessThanOrEqual(1.4);
    expect(groundEffect(10, r)).toBeCloseTo(1, 3);
  });
});
