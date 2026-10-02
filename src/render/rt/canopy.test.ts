import { describe, expect, it } from 'vitest';
import type { RTPrimitive } from '../contracts';
import {
  CANOPY_CORE, CANOPY_EXTINCTION, CANOPY_LOBE, CANOPY_RIM_NOISE, canopyLobe, canopyOpticalDepth, canopyTransmittance, isCanopyProxy, sphereChord,
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

describe('crown shadow shape', () => {
  const c = [0, 10, 0], up = [0, 1, 0], r = 4.5;
  // Smooth hash-lattice value noise: stands in for the shader's valueNoise3.
  const lattice = (x: number, y: number, z: number): number => { const v = Math.sin(x * 127.1 + y * 311.7 + z * 74.7) * 43758.5453; return v - Math.floor(v); };
  const noise = (x: number, y: number, z: number): number => {
    const fx = Math.floor(x), fy = Math.floor(y), fz = Math.floor(z);
    const sm = (t: number): number => t * t * (3 - 2 * t);
    const ax = sm(x - fx), ay = sm(y - fy), az = sm(z - fz);
    const mix = (a: number, b: number, t: number): number => a + (b - a) * t;
    const h = (i: number, j: number, k: number): number => lattice(fx + i, fy + j, fz + k);
    return mix(mix(mix(h(0, 0, 0), h(1, 0, 0), ax), mix(h(0, 1, 0), h(1, 1, 0), ax), ay), mix(mix(h(0, 0, 1), h(1, 0, 1), ax), mix(h(0, 1, 1), h(1, 1, 1), ax), ay), az);
  };

  it('the lobe pattern is bounded and zero-mean-ish so the mean crown size is kept', () => {
    let sum = 0, n = 0;
    for (let x = -1; x <= 1; x += 0.1) for (let z = -1; z <= 1; z += 0.1) { const l = canopyLobe([x, 0.2, z], c); expect(Math.abs(l)).toBeLessThanOrEqual(1); sum += l; n++; }
    expect(Math.abs(sum / n)).toBeLessThan(0.35);
    expect(CANOPY_RIM_NOISE + CANOPY_LOBE).toBeLessThan(0.5);
  });

  it('the silhouette is not a circle: the radius of the 0.85 transmittance contour varies with the azimuth', () => {
    const radii: number[] = [];
    for (let k = 0; k < 24; k++) {
      const a = (k / 24) * 2 * Math.PI;
      let lo = 0, hi = r;
      for (let i = 0; i < 24; i++) {
        const mid = (lo + hi) / 2;
        const t = canopyTransmittance(c, r, [mid * Math.cos(a), 0, mid * Math.sin(a)], up, 1000, noise);
        if (t < 0.85) lo = mid; else hi = mid;
      }
      radii.push((lo + hi) / 2);
    }
    const mean = radii.reduce((x, y) => x + y, 0) / radii.length;
    expect((Math.max(...radii) - Math.min(...radii)) / mean).toBeGreaterThan(0.12);
    expect(mean).toBeGreaterThan(0.6 * r);
    expect(mean).toBeLessThan(r);
  });

  it('the shadow never leaves the proxy sphere: transmittance is exactly 1 outside its silhouette', () => {
    for (let k = 0; k < 16; k++) {
      const a = (k / 16) * 2 * Math.PI;
      expect(canopyTransmittance(c, r, [1.02 * r * Math.cos(a), 0, 1.02 * r * Math.sin(a)], up, 1000, noise)).toBe(1);
    }
  });

  it('the dither: another jitter moves the estimate, and the stratified mean agrees with the midpoint rule', () => {
    const o = [0.7, 0, 0.3];
    const mid = canopyOpticalDepth(c, r, o, up, 1000, noise, 0.5);
    expect(canopyOpticalDepth(c, r, o, up, 1000, noise, 0.1)).not.toBeCloseTo(mid, 3);
    let mean = 0;
    const n = 32;
    for (let j = 0; j < n; j++) mean += canopyOpticalDepth(c, r, o, up, 1000, noise, (j + 0.5) / n) / n;
    expect(Math.abs(mean - mid) / mid).toBeLessThan(0.15);
  });

  it('a crown crossed along the 22 degree sun ray still passes 0.1 .. 0.4 of the light through its middle', () => {
    const d = [Math.cos(0.38) * 0.5, Math.sin(0.38), Math.cos(0.38) * Math.sqrt(0.75)];
    const o = [-d[0] / d[1] * 10, 0, -d[2] / d[1] * 10];
    const t = canopyTransmittance(c, r, o, d, 1e4, noise);
    expect(t).toBeGreaterThan(0.1);
    expect(t).toBeLessThan(0.4);
  });
});
