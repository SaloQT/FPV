import { describe, expect, it } from 'vitest';
import type { Quat, Vec3 } from '../contracts';
import { quatAxisX, quatLookAlong, quatMul, quatRotate, quatSlerp, quatYaw } from './quat';

const IDENTITY: Quat = [0, 0, 0, 1];

function expectVec(v: Vec3, x: number, y: number, z: number, digits = 9): void {
  expect(v[0]).toBeCloseTo(x, digits);
  expect(v[1]).toBeCloseTo(y, digits);
  expect(v[2]).toBeCloseTo(z, digits);
}

describe('quatYaw', () => {
  it('turns -Z (forward) toward -X for positive yaw: counter-clockwise from above', () => {
    const q = quatYaw(Math.PI / 2, [0, 0, 0, 1]);
    expectVec(quatRotate(q, [0, 0, -1], [0, 0, 0]), -1, 0, 0);
  });

  it('is the identity at zero yaw', () => {
    expect(quatYaw(0, [1, 1, 1, 1])).toEqual(IDENTITY);
  });
});

describe('quatAxisX', () => {
  it('pitches the nose (-Z) up for a positive angle', () => {
    const q = quatAxisX(30 * (Math.PI / 180), [0, 0, 0, 1]);
    const f = quatRotate(q, [0, 0, -1], [0, 0, 0]);
    expect(f[1]).toBeCloseTo(Math.sin(Math.PI / 6), 9);
    expect(f[2]).toBeCloseTo(-Math.cos(Math.PI / 6), 9);
  });
});

describe('quatMul', () => {
  it('applies the right operand first', () => {
    const yaw = quatYaw(Math.PI / 2, [0, 0, 0, 1]);
    const tilt = quatAxisX(Math.PI / 2, [0, 0, 0, 1]);
    const q = quatMul(yaw, tilt, [0, 0, 0, 1]);
    const viaParts = quatRotate(yaw, quatRotate(tilt, [0, 0, -1], [0, 0, 0]), [0, 0, 0]);
    expectVec(quatRotate(q, [0, 0, -1], [0, 0, 0]), viaParts[0], viaParts[1], viaParts[2]);
  });

  it('is safe when the output aliases an input', () => {
    const a = quatYaw(0.4, [0, 0, 0, 1]);
    const b = quatAxisX(0.7, [0, 0, 0, 1]);
    const expected = quatMul(a, b, [0, 0, 0, 1]);
    quatMul(a, b, a);
    for (let i = 0; i < 4; i++) expect(a[i]).toBeCloseTo(expected[i], 12);
  });

  it('keeps unit length', () => {
    const q = quatMul(quatYaw(1.1, [0, 0, 0, 1]), quatAxisX(-0.4, [0, 0, 0, 1]), [0, 0, 0, 1]);
    expect(Math.hypot(...q)).toBeCloseTo(1, 12);
  });
});

describe('quatRotate', () => {
  it('leaves vectors alone under the identity', () => {
    expectVec(quatRotate(IDENTITY, [1, 2, 3], [0, 0, 0]), 1, 2, 3);
  });

  it('is safe when the output aliases the input vector', () => {
    const v: Vec3 = [1, 0, 0];
    quatRotate(quatYaw(Math.PI / 2, [0, 0, 0, 1]), v, v);
    expectVec(v, 0, 0, -1);
  });
});

describe('quatSlerp', () => {
  it('returns the endpoints at t = 0 and t = 1', () => {
    const a = quatYaw(0.2, [0, 0, 0, 1]);
    const b = quatYaw(1.4, [0, 0, 0, 1]);
    const out: Quat = [0, 0, 0, 1];
    quatSlerp(a, b, 0, out);
    for (let i = 0; i < 4; i++) expect(out[i]).toBeCloseTo(a[i], 12);
    quatSlerp(a, b, 1, out);
    for (let i = 0; i < 4; i++) expect(out[i]).toBeCloseTo(b[i], 12);
  });

  it('interpolates the angle linearly', () => {
    const out = quatSlerp(quatYaw(0, [0, 0, 0, 1]), quatYaw(1, [0, 0, 0, 1]), 0.25, [0, 0, 0, 1]);
    expect(2 * Math.atan2(out[1], out[3])).toBeCloseTo(0.25, 9);
  });

  it('takes the short way round when the signs are opposite', () => {
    const a = quatYaw(0.1, [0, 0, 0, 1]);
    const b = quatYaw(0.3, [0, 0, 0, 1]).map((c) => -c) as Quat;
    const out = quatSlerp(a, b, 0.5, [0, 0, 0, 1]);
    expect(2 * Math.atan2(out[1], out[3])).toBeCloseTo(0.2, 9);
  });

  it('survives identical inputs', () => {
    const a = quatYaw(0.5, [0, 0, 0, 1]);
    const out = quatSlerp(a, a, 0.5, [0, 0, 0, 1]);
    for (let i = 0; i < 4; i++) expect(out[i]).toBeCloseTo(a[i], 12);
  });

  it('is safe when the output aliases an input', () => {
    const a = quatYaw(0, [0, 0, 0, 1]);
    quatSlerp(a, quatYaw(1, [0, 0, 0, 1]), 0.5, a);
    expect(2 * Math.atan2(a[1], a[3])).toBeCloseTo(0.5, 9);
  });
});

describe('quatLookAlong', () => {
  const dirs: Vec3[] = [
    [0, 0, -1],
    [1, 0, 0],
    [0, 0, 1],
    [-1, 0, 0],
    [1, 1, -1],
    [-0.3, -0.8, 0.5],
    [0.2, 5, 0.1],
  ];

  it('points the camera -Z axis along the requested direction', () => {
    for (const d of dirs) {
      const q = quatLookAlong(d[0], d[1], d[2], [0, 0, 0, 1]);
      const len = Math.hypot(...d);
      expectVec(quatRotate(q, [0, 0, -1], [0, 0, 0]), d[0] / len, d[1] / len, d[2] / len, 7);
      expect(Math.hypot(...q)).toBeCloseTo(1, 9);
    }
  });

  it('keeps the camera right axis horizontal', () => {
    for (const d of dirs) {
      const q = quatLookAlong(d[0], d[1], d[2], [0, 0, 0, 1]);
      expect(quatRotate(q, [1, 0, 0], [0, 0, 0])[1]).toBeCloseTo(0, 9);
    }
  });

  it('keeps the camera up axis in the upper hemisphere', () => {
    for (const d of dirs) {
      const q = quatLookAlong(d[0], d[1], d[2], [0, 0, 0, 1]);
      expect(quatRotate(q, [0, 1, 0], [0, 0, 0])[1]).toBeGreaterThan(0);
    }
  });

  it('is the identity when looking along -Z', () => {
    const q = quatLookAlong(0, 0, -1, [0, 0, 0, 0]);
    expect(Math.abs(q[3])).toBeCloseTo(1, 9);
  });

  it('copes with looking straight up and straight down', () => {
    for (const y of [1, -1]) {
      const q = quatLookAlong(0, y, 0, [0, 0, 0, 1]);
      expectVec(quatRotate(q, [0, 0, -1], [0, 0, 0]), 0, y, 0, 7);
      expect(Number.isFinite(q[0] + q[1] + q[2] + q[3])).toBe(true);
    }
  });

  it('gives a finite result for a zero vector', () => {
    const q = quatLookAlong(0, 0, 0, [0, 0, 0, 1]);
    expect(Math.hypot(...q)).toBeCloseTo(1, 9);
  });
});
