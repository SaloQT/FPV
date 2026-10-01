import { describe, expect, it } from 'vitest';
import type { RTPrimitive } from '../contracts';
import {
  CANOPY_CORE, CANOPY_EXTINCTION, canopyOpticalDepth, canopyTransmittance, isCanopyProxy, sphereChord,
} from './canopy';

const FOLIAGE = { albedo: [0.045, 0.09, 0.025] as [number, number, number], roughness: 1, metalness: 0 };
const crown = (radius: number): RTPrimitive => ({ type: 'sphere', center: [0, 10, 0], radius, material: FOLIAGE });

describe('isCanopyProxy', () => {
  it('accepts the vegetation crown sphere only', () => {
    expect(isCanopyProxy(crown(4))).toBe(true);
    expect(isCanopyProxy({ type: 'capsule', a: [0, 0, 0], b: [0, 5, 0], radius: 0.3, material: FOLIAGE })).toBe(false);
    expect(isCanopyProxy({ type: 'sphere', center: [0, 0, 0], radius: 1, material: { albedo: [0.3, 0.3, 0.3], roughness: 0.9, metalness: 0 } })).toBe(false);
    expect(isCanopyProxy({ type: 'sphere', center: [0, 0, 0], radius: 1, material: { ...FOLIAGE, metalness: 1 } })).toBe(false);
    expect(isCanopyProxy({ type: 'sphere', center: [0, 0, 0], radius: 1, material: { ...FOLIAGE, emissive: [1, 1, 1] } })).toBe(false);
  });
});

describe('sphereChord', () => {
  it('returns entry and exit of a ray through the centre', () => {
    expect(sphereChord([0, 0, 0], 2, [0, -10, 0], [0, 1, 0], 100)).toEqual([8, 12]);
  });
  it('clips to the ray origin when it starts inside and to tMax', () => {
    expect(sphereChord([0, 0, 0], 2, [0, 0, 0], [0, 1, 0], 100)).toEqual([0, 2]);
    expect(sphereChord([0, 0, 0], 2, [0, -10, 0], [0, 1, 0], 9)).toEqual([8, 9]);
  });
  it('is null for a miss, a sphere behind the origin and a sphere beyond tMax', () => {
    expect(sphereChord([0, 0, 0], 2, [5, -10, 0], [0, 1, 0], 100)).toBeNull();
    expect(sphereChord([0, 0, 0], 2, [0, 10, 0], [0, 1, 0], 100)).toBeNull();
    expect(sphereChord([0, 0, 0], 2, [0, -10, 0], [0, 1, 0], 5)).toBeNull();
  });
});

describe('canopyTransmittance', () => {
  const c = [0, 10, 0], up = [0, 1, 0];

  it('is exactly 1 for a miss', () => {
    expect(canopyTransmittance(c, 4, [20, 0, 0], up, 1000)).toBe(1);
  });

  it('through a deep crown with mean noise stays inside the 0.1 .. 0.35 band of a leafy canopy', () => {
    const t = canopyTransmittance(c, 4.5, [0, 0, 0], up, 1000);
    expect(t).toBeGreaterThan(0.1);
    expect(t).toBeLessThan(0.35);
  });

  it('is bracketed by the full-chord and the core-chord Beer-Lambert values (the rim is thinner than the core)', () => {
    const r = 6;
    const t = canopyTransmittance(c, r, [0, 10 - r, 0], up, 1000);
    expect(t).toBeGreaterThan(Math.exp(-CANOPY_EXTINCTION * 2 * r));
    expect(t).toBeLessThan(Math.exp(-CANOPY_EXTINCTION * CANOPY_CORE * r));
  });

  it('is soft: transmittance rises monotonically from the centre to the silhouette', () => {
    let prev = 0;
    for (let off = 0; off <= 4.4; off += 0.4) {
      const t = canopyTransmittance(c, 4.5, [off, 0, 0], up, 1000);
      expect(t).toBeGreaterThanOrEqual(prev - 1e-12);
      prev = t;
    }
    expect(prev).toBeGreaterThan(0.9);
  });

  it('follows the clump noise: denser noise darkens, sparser noise lights', () => {
    const dense = canopyTransmittance(c, 4.5, [0, 0, 0], up, 1000, () => 1);
    const mean = canopyTransmittance(c, 4.5, [0, 0, 0], up, 1000, () => 0.5);
    const sparse = canopyTransmittance(c, 4.5, [0, 0, 0], up, 1000, () => 0);
    expect(dense).toBeLessThan(mean);
    expect(mean).toBeLessThan(sparse);
  });

  it('multiplies over two crowns on the same ray (optical depths add)', () => {
    const a = canopyOpticalDepth([0, 10, 0], 4, [0, 0, 0], up, 1000);
    const b = canopyOpticalDepth([0, 30, 0], 4, [0, 0, 0], up, 1000);
    expect(b).toBeCloseTo(a, 10);
  });
});
