import { describe, expect, it } from 'vitest';
import { computeMaps, pickWaterLevel, type MapInputs, type TerrainMaps } from './maps';
import { minMax } from './grid';
import { Noise2D } from './noise';

const N = 64;
const CELL = 8;

function run(height: Float32Array, seed = 1, report: (f: number) => void = () => {}): TerrainMaps {
  const [lo, hi] = minMax(height);
  const inputs: MapInputs = {
    height,
    n: N,
    cell: CELL,
    seed,
    minHeight: lo,
    maxHeight: hi,
    gain: new Float32Array(N * N),
    visits: new Float32Array(N * N),
  };
  const gen = computeMaps(inputs, report);
  for (;;) {
    const r = gen.next();
    if (r.done === true) return r.value;
  }
}

function field(f: (i: number, j: number) => number): Float32Array {
  const h = new Float32Array(N * N);
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) h[j * N + i] = f(i, j);
  return h;
}

/** A V-shaped valley with steep walls that falls gently toward +Z, so all water collects along the floor line. */
const valley = (): Float32Array => field((i, j) => CELL * (1.5 * Math.abs(i - (N - 1) / 2) + 0.1 * (N - 1 - j)));

function meanOver(map: Float32Array, i0: number, i1: number, j0: number, j1: number): number {
  let sum = 0;
  let count = 0;
  for (let j = j0; j < j1; j++) {
    for (let i = i0; i < i1; i++) {
      sum += map[j * N + i];
      count++;
    }
  }
  return sum / count;
}

describe('computeMaps', () => {
  it('produces four maps within [0, 1] and reports progress ending at exactly 1', () => {
    const noise = new Noise2D(3);
    const h = field((i, j) => 60 * noise.simplex(i * 0.08, j * 0.08) + 10 * noise.simplex(i * 0.3, j * 0.3));
    const seen: number[] = [];
    const maps = run(h, 3, (f) => seen.push(f));
    for (const map of [maps.soil, maps.flow, maps.deposit, maps.wetness]) {
      expect(map).toHaveLength(N * N);
      for (const v of map) {
        expect(Number.isFinite(v)).toBe(true);
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(1);
      }
    }
    for (let k = 1; k < seen.length; k++) expect(seen[k]).toBeGreaterThanOrEqual(seen[k - 1]);
    expect(seen[seen.length - 1]).toBe(1);
  });

  it('is deterministic and leaves the input heights untouched', () => {
    const h = valley();
    const copy = Float32Array.from(h);
    const a = run(h);
    const b = run(h);
    expect(Array.from(a.soil)).toEqual(Array.from(b.soil));
    expect(Array.from(a.wetness)).toEqual(Array.from(b.wetness));
    expect(Array.from(h)).toEqual(Array.from(copy));
  });

  it('puts drainage and moisture along a valley floor rather than on its walls', () => {
    const maps = run(valley());
    const floor = 31;
    const wall = 8;
    expect(meanOver(maps.flow, floor, floor + 2, 32, 60)).toBeGreaterThan(meanOver(maps.flow, wall, wall + 2, 32, 60) + 0.3);
    expect(meanOver(maps.wetness, floor, floor + 2, 32, 60)).toBeGreaterThan(meanOver(maps.wetness, wall, wall + 2, 32, 60) + 0.1);
  });

  it('leaves less soil on steep rock faces than on gentle ground', () => {
    const gentle = field((i, j) => CELL * (0.05 * (N - 1 - j) + (i > 40 ? 1.8 * (i - 40) : 0)));
    const maps = run(gentle);
    expect(meanOver(maps.soil, 4, 34, 8, 56)).toBeGreaterThan(meanOver(maps.soil, 46, 60, 8, 56) + 0.2);
  });

  it('reads deposition from the erosion gain input', () => {
    const h = valley();
    const [lo, hi] = minMax(h);
    const gain = new Float32Array(N * N);
    for (let j = 20; j < 30; j++) for (let i = 4; i < 12; i++) gain[j * N + i] = 3;
    const gen = computeMaps({ height: h, n: N, cell: CELL, seed: 1, minHeight: lo, maxHeight: hi, gain, visits: new Float32Array(N * N) }, () => {});
    let r = gen.next();
    while (r.done !== true) r = gen.next();
    expect(meanOver(r.value.deposit, 5, 11, 21, 29)).toBeGreaterThan(0.5);
    expect(meanOver(r.value.deposit, 40, 60, 40, 60)).toBe(0);
  });
});

describe('pickWaterLevel', () => {
  const dish = (low: (i: number, j: number) => boolean, base = 0): Float32Array => field((i, j) => base + (low(i, j) ? 0 : 100));

  it('sets the level 6% up the height range when a corner basin holds a modest lake', () => {
    const h = dish((i, j) => i < 10 && j < 10);
    expect(pickWaterLevel(h, N, 0, 100)).toBeCloseTo(6, 6);
    const lifted = dish((i, j) => i < 10 && j < 10, 50);
    expect(pickWaterLevel(lifted, N, 50, 150)).toBeCloseTo(56, 6);
  });

  it('refuses a lake when low ground reaches the flyable centre', () => {
    expect(pickWaterLevel(dish((i, j) => Math.hypot(i - N / 2, j - N / 2) < 6), N, 0, 100)).toBe(-Infinity);
  });

  it('refuses puddles too small to matter and seas that would swamp the map', () => {
    expect(pickWaterLevel(dish((i, j) => i === 0 && j === 0), N, 0, 100)).toBe(-Infinity);
    expect(pickWaterLevel(dish((i) => i < 16), N, 0, 100)).toBe(-Infinity);
  });

  it('gives no lake on terrain that never dips below the level', () => {
    expect(pickWaterLevel(dish(() => false), N, 0, 100)).toBe(-Infinity);
  });
});
