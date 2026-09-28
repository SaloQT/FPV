import { describe, expect, it } from 'vitest';
import { buildMaxPyramid, buildNormalHorizon, horizonSteps, packTerrainMaps } from './terrainUpload';

function grid(n: number, f: (i: number, j: number) => number): Float32Array {
  const h = new Float32Array(n * n);
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) h[j * n + i] = f(i, j);
  return h;
}

describe('buildMaxPyramid', () => {
  it('has a full chain down to 1x1 whose level m is the max over 2^m blocks', () => {
    const n = 16;
    const h = grid(n, (i, j) => Math.sin(i * 1.3) * 7 + Math.cos(j * 0.7) * 5 + i * 0.1);
    const pyr = buildMaxPyramid(h, n);
    expect(pyr.length).toBe(5);
    expect(pyr.map((l) => l.length)).toEqual([256, 64, 16, 4, 1]);
    for (let m = 1; m < pyr.length; m++) {
      const size = n >> m, block = 1 << m;
      for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
        let best = -Infinity;
        for (let dy = 0; dy < block; dy++) for (let dx = 0; dx < block; dx++) best = Math.max(best, h[(y * block + dy) * n + x * block + dx]);
        expect(pyr[m][y * size + x]).toBe(best);
      }
    }
    expect(pyr[4][0]).toBe(Math.max(...h));
  });
});

describe('buildNormalHorizon', () => {
  const n = 64, cell = 4;

  it('flat ground: normal is +Y and the horizon AO is fully open', () => {
    const t = buildNormalHorizon(grid(n, () => 10), n, cell);
    for (const p of [0, 31 * n + 31, n * n - 1]) {
      expect(t[p * 4]).toBe(128);
      expect(t[p * 4 + 1]).toBe(255);
      expect(t[p * 4 + 2]).toBe(128);
      expect(t[p * 4 + 3]).toBe(255);
    }
  });

  it('plane sloping up toward +X tilts the normal toward -X, with the exact slope', () => {
    const slope = 0.5;
    const t = buildNormalHorizon(grid(n, (i) => i * cell * slope), n, cell);
    const o = (20 * n + 20) * 4;
    const nx = (t[o] / 255) * 2 - 1, ny = (t[o + 1] / 255) * 2 - 1, nz = (t[o + 2] / 255) * 2 - 1;
    const inv = 1 / Math.hypot(1, slope);
    expect(nx).toBeCloseTo(-slope * inv, 1);
    expect(ny).toBeCloseTo(inv, 1);
    expect(nz).toBeCloseTo(0, 1);
  });

  it('plane sloping toward +Z (south) tilts the normal toward -Z', () => {
    const t = buildNormalHorizon(grid(n, (_, j) => j * cell * 0.3), n, cell);
    const o = (20 * n + 20) * 4;
    expect((t[o + 2] / 255) * 2 - 1).toBeLessThan(-0.25);
    expect(t[o]).toBeGreaterThan(126);
    expect(t[o]).toBeLessThan(130);
  });

  it('a pit is more occluded than the surrounding plateau, and stays within 0..255', () => {
    const h = grid(n, (i, j) => (Math.abs(i - 32) < 3 && Math.abs(j - 32) < 3 ? -20 : 0));
    const t = buildNormalHorizon(h, n, cell);
    const pit = t[(32 * n + 32) * 4 + 3];
    const flat = t[(5 * n + 5) * 4 + 3];
    expect(flat).toBeGreaterThan(240);
    expect(pit).toBeLessThan(flat - 60);
  });

  it('interior AO equals a brute-force horizon march', () => {
    const h = grid(n, (i, j) => Math.sin(i * 0.4) * Math.cos(j * 0.3) * 6);
    const t = buildNormalHorizon(h, n, cell);
    const steps = horizonSteps(cell);
    const dirs = [[1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1]];
    const i = 30, j = 33;
    let occ = 0;
    for (const [dx, dy] of dirs) {
      let maxT = 0;
      for (const s of steps) {
        const ii = Math.min(n - 1, Math.max(0, i + dx * s)), jj = Math.min(n - 1, Math.max(0, j + dy * s));
        maxT = Math.max(maxT, (h[jj * n + ii] - h[j * n + i]) / (Math.hypot(dx, dy) * s * cell));
      }
      occ += (maxT * maxT) / (1 + maxT * maxT);
    }
    expect(t[(j * n + i) * 4 + 3]).toBe(Math.round((1 - occ / 8) * 255));
  });

  it('horizon march distances are bounded and start at one texel', () => {
    const s = horizonSteps(8);
    expect(s[0]).toBe(1);
    expect(s[s.length - 1] * 8).toBeLessThanOrEqual(96);
    expect(horizonSteps(200)).toEqual([1]);
    expect(s.length).toBeLessThanOrEqual(16);
  });

  it('N=2048 completes within budget', () => {
    const N = 2048;
    const h = grid(N, (i, j) => Math.sin(i * 0.01) * 30 + Math.cos(j * 0.013) * 20);
    const t0 = performance.now();
    const t = buildNormalHorizon(h, N, 4);
    const ms = performance.now() - t0;
    expect(t.length).toBe(N * N * 4);
    expect(ms).toBeLessThan(2500);
  }, 20000);
});

describe('packTerrainMaps', () => {
  it('packs soil, flow, deposit, wetness into rgba and clamps', () => {
    const maps = { soil: new Float32Array([0, 1, 0, 0]), flow: new Float32Array([0.5, 2, 0, 0]), deposit: new Float32Array([0.25, -1, 0, 0]), wetness: new Float32Array([1, 0.1, 0, 0]) };
    const p = packTerrainMaps(maps, 2);
    expect(Array.from(p.slice(0, 4))).toEqual([0, 128, 64, 255]);
    expect(Array.from(p.slice(4, 8))).toEqual([255, 255, 0, 26]);
  });
});
