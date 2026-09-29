import { describe, expect, it } from 'vitest';
import type { TerrainData } from '../../contracts';
import { createTerrainSampler } from '../../world/terrain';
import { fbm2, fbm3, hash2, hash3, smoothstep, valueNoise2, valueNoise3 } from './noise';
import { SpatialHash } from './spatialHash';
import { TerrainFields } from './terrainFields';

describe('hash noise', () => {
  it('is a pure function that spreads evenly over [0, 1)', () => {
    let sum = 0, min = 1, max = 0;
    const bins = new Uint32Array(10);
    for (let i = 0; i < 20000; i++) {
      const h = hash2(i % 141, Math.floor(i / 141), 5);
      expect(hash2(i % 141, Math.floor(i / 141), 5)).toBe(h);
      sum += h; min = Math.min(min, h); max = Math.max(max, h); bins[Math.floor(h * 10)]++;
    }
    expect(sum / 20000).toBeGreaterThan(0.49);
    expect(sum / 20000).toBeLessThan(0.51);
    expect(min).toBeGreaterThanOrEqual(0);
    expect(max).toBeLessThan(1);
    for (const b of bins) expect(Math.abs(b - 2000)).toBeLessThan(200);
  });

  it('changes with the seed and the lattice coordinates', () => {
    expect(hash2(3, 4, 1)).not.toBe(hash2(3, 4, 2));
    expect(hash2(3, 4, 1)).not.toBe(hash2(4, 3, 1));
    expect(hash3(1, 2, 3, 0)).not.toBe(hash3(3, 2, 1, 0));
  });

  it('interpolates value noise continuously and hits the lattice values exactly', () => {
    expect(valueNoise2(7, -3, 9)).toBeCloseTo(hash2(7, -3, 9), 12);
    expect(valueNoise3(2, 5, -8, 4)).toBeCloseTo(hash3(2, 5, -8, 4), 12);
    let worst = 0;
    for (let i = 0; i < 2000; i++) {
      const x = i * 0.013, y = i * 0.007;
      worst = Math.max(worst, Math.abs(valueNoise2(x + 1e-4, y, 3) - valueNoise2(x, y, 3)));
    }
    expect(worst).toBeLessThan(2e-3);
  });

  it('keeps fractal noise inside [0, 1] with a mean near one half', () => {
    let sum2 = 0, sum3 = 0;
    const n = 4000;
    for (let i = 0; i < n; i++) {
      const a = fbm2(i * 0.37, i * 0.11, 2, 4), b = fbm3(i * 0.37, i * 0.11, i * 0.23, 2, 3);
      expect(a).toBeGreaterThanOrEqual(0);
      expect(a).toBeLessThanOrEqual(1);
      expect(b).toBeGreaterThanOrEqual(0);
      expect(b).toBeLessThanOrEqual(1);
      sum2 += a; sum3 += b;
    }
    expect(Math.abs(sum2 / n - 0.5)).toBeLessThan(0.05);
    expect(Math.abs(sum3 / n - 0.5)).toBeLessThan(0.05);
  });

  it('smoothsteps monotonically between the edges', () => {
    expect(smoothstep(1, 3, 0)).toBe(0);
    expect(smoothstep(1, 3, 4)).toBe(1);
    expect(smoothstep(1, 3, 2)).toBe(0.5);
    let prev = 0;
    for (let x = 1; x <= 3; x += 0.05) { const s = smoothstep(1, 3, x); expect(s).toBeGreaterThanOrEqual(prev); prev = s; }
  });
});

describe('SpatialHash', () => {
  it('finds a stored disc closer than half the summed radii times the factor, and only then', () => {
    const h = new SpatialHash(0, 0, 100, 100, 10, 8);
    h.add(50, 50, 4, 0);
    expect(h.conflicts(50, 53.9, 4, 0, 1, 1)).toBe(true);
    expect(h.conflicts(50, 54.1, 4, 0, 1, 1)).toBe(false);
    expect(h.conflicts(50, 52.9, 2, 0, 1, 1)).toBe(true);
    expect(h.conflicts(50, 53.1, 2, 0, 1, 1)).toBe(false);
  });

  it('spaces other groups by the cross factor instead of the same-group factor', () => {
    const h = new SpatialHash(0, 0, 100, 100, 10, 8);
    h.add(20, 20, 4, 0);
    expect(h.conflicts(20, 25, 4, 0, 1, 0.5)).toBe(false);
    expect(h.conflicts(20, 25, 4, 0, 2, 0.5)).toBe(true);
    expect(h.conflicts(20, 21.9, 4, 1, 1, 0.5)).toBe(true);
    expect(h.conflicts(20, 22.1, 4, 1, 1, 0.5)).toBe(false);
  });

  it('matches a brute-force check over thousands of random discs, growing past its capacity', () => {
    const h = new SpatialHash(-200, -200, 200, 200, 12, 4);
    const discs: [number, number, number][] = [];
    let s = 12345;
    const rnd = (): number => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; };
    for (let i = 0; i < 3000; i++) {
      const x = rnd() * 400 - 200, z = rnd() * 400 - 200, r = 1 + rnd() * 10;
      const brute = discs.some(([dx, dz, dr]) => Math.hypot(dx - x, dz - z) < 0.5 * (r + dr));
      expect(h.conflicts(x, z, r, 0, 1, 1)).toBe(brute);
      if (!brute) { h.add(x, z, r, 0); discs.push([x, z, r]); }
    }
    expect(h.count).toBe(discs.length);
    expect(discs.length).toBeGreaterThan(200);
  });

  it('reports overlaps within the summed radii plus padding', () => {
    const h = new SpatialHash(0, 0, 50, 50, 8, 4);
    h.add(10, 10, 2, 0);
    expect(h.overlaps(10, 14.4, 2, 0.5)).toBe(true);
    expect(h.overlaps(10, 14.6, 2, 0.5)).toBe(false);
  });

  it('clamps queries outside the grid to its edge cells', () => {
    const h = new SpatialHash(0, 0, 40, 40, 8, 4);
    h.add(-5, -5, 2, 0);
    expect(h.conflicts(-4, -4, 2, 0, 1, 1)).toBe(true);
    expect(h.conflicts(-30, -30, 2, 0, 1, 1)).toBe(false);
  });
});

function ramp(n: number, cell: number): TerrainData {
  const height = new Float32Array(n * n), soil = new Float32Array(n * n), flow = new Float32Array(n * n), wet = new Float32Array(n * n);
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      height[j * n + i] = 2 * i * cell + 0.5 * j * cell;
      soil[j * n + i] = i / (n - 1);
      flow[j * n + i] = j / (n - 1);
      wet[j * n + i] = 0.25;
    }
  }
  return { seed: 1, resolution: n, cellSize: cell, origin: [-100, -50], height, maps: { soil, flow, deposit: new Float32Array(n * n), wetness: wet }, minHeight: 0, maxHeight: 1000, waterLevel: 0 };
}

describe('TerrainFields', () => {
  const f = new TerrainFields(ramp(33, 4));

  it('reads bilinearly: exact on a linear ramp between the samples', () => {
    expect(f.height(-100, -50)).toBeCloseTo(0, 5);
    expect(f.height(-90.5, -41.25)).toBeCloseTo(2 * 9.5 + 0.5 * 8.75, 4);
    expect(f.soil(-36, 0)).toBeCloseTo(16 / 32, 5);
    expect(f.flow(0, 14)).toBeCloseTo(16 / 32, 5);
    expect(f.wetness(3, 3)).toBeCloseTo(0.25, 6);
  });

  it('follows the terrain mesh triangulation exactly (TerrainSampler.heightAt), also on twisted quads', () => {
    const data = ramp(17, 8);
    for (let j = 0; j < 17; j++) for (let i = 0; i < 17; i++) data.height[j * 17 + i] += 3 * ((i * 7 + j * 3) % 5);
    const fields = new TerrainFields(data), sampler = createTerrainSampler(data);
    let worst = 0;
    for (let k = 0; k < 500; k++) {
      const x = -100 + ((k * 37) % 128) + 0.37 * (k % 3), z = -50 + ((k * 53) % 128) + 0.21 * (k % 5);
      worst = Math.max(worst, Math.abs(fields.height(x, z) - sampler.heightAt(x, z)));
    }
    expect(worst).toBeLessThan(1e-3);
  });

  it('clamps to the grid outside it instead of reading past the arrays', () => {
    expect(Number.isFinite(f.height(1e6, -1e6))).toBe(true);
    expect(f.soil(-1e6, 0)).toBeCloseTo(0, 5);
    expect(f.soil(1e6, 0)).toBeGreaterThan(0.99);
  });

  it('measures the gradient with central differences and leaves it in gx, gz', () => {
    const g = f.gradient(-30, -10);
    expect(f.gx).toBeCloseTo(2, 5);
    expect(f.gz).toBeCloseTo(0.5, 5);
    expect(g).toBeCloseTo(Math.hypot(2, 0.5), 5);
  });

  it('tests membership with a margin', () => {
    expect(f.inside(0, 0, 10)).toBe(true);
    expect(f.inside(-95, 0, 10)).toBe(false);
    expect(f.inside(-95, 0, 2)).toBe(true);
    expect(f.inside(0, 1000, 0)).toBe(false);
  });
});
