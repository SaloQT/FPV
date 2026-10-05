import { describe, expect, it } from 'vitest';
import type { TerrainData } from '../../contracts';
import { generateTerrainAsync } from './client';
import { generateTerrain, terrainDefaults, terrainSteps } from './generate';
import { generateTerrain as generateFromIndex, generateTerrainAsync as asyncFromIndex } from './index';
import { hashFloats } from './noise';
import { TUNING } from './tuning';

const SLOW = 60000;

const N = 128;
const CELL = 12;
const SMALL = { quality: 'low', resolution: N, cellSize: CELL } as const;

const fingerprint = (d: TerrainData): number[] => [d.height, d.maps.soil, d.maps.flow, d.maps.deposit, d.maps.wetness].map(hashFloats);

const cache = new Map<number, TerrainData>();
/** Generation is deterministic, so tests can share one result per seed instead of paying for it repeatedly. */
function terrain(seed: number): TerrainData {
  let d = cache.get(seed);
  if (d === undefined) {
    d = generateTerrain({ seed, ...SMALL });
    cache.set(seed, d);
  }
  return d;
}

/** Rim and repose-angle artefacts only show up once the grid is fine enough, so those tests use this larger map. */
const BIG = 256;
const BIG_CELL = 6;
const bigCache = new Map<number, TerrainData>();
function bigTerrain(seed: number): TerrainData {
  let d = bigCache.get(seed);
  if (d === undefined) {
    d = generateTerrain({ seed, quality: 'low', resolution: BIG, cellSize: BIG_CELL });
    bigCache.set(seed, d);
  }
  return d;
}

describe('determinism', () => {
  it('the same seed gives bit-identical height and maps', () => {
    const again = generateTerrain({ seed: 1337, ...SMALL });
    expect(fingerprint(again)).toEqual(fingerprint(terrain(1337)));
    expect(again.waterLevel).toBe(terrain(1337).waterLevel);
    expect(again.minHeight).toBe(terrain(1337).minHeight);
    expect(again.maxHeight).toBe(terrain(1337).maxHeight);
  });

  it('a different seed gives a different terrain', () => {
    const a = fingerprint(terrain(1));
    const b = fingerprint(terrain(2));
    for (let k = 0; k < a.length; k++) expect(a[k]).not.toBe(b[k]);
  });

  it('does not depend on how much progress reporting or slicing happens', () => {
    const quiet = generateTerrain({ seed: 5, ...SMALL });
    const talkative = generateTerrain({ seed: 5, ...SMALL }, () => {});
    expect(fingerprint(talkative)).toEqual(fingerprint(quiet));
  });

  it('is unaffected by Math.random', () => {
    const real = Math.random;
    Math.random = () => {
      throw new Error('terrain generation must not use Math.random');
    };
    try {
      expect(fingerprint(generateTerrain({ seed: 1, ...SMALL, resolution: 64 }))).toHaveLength(5);
    } finally {
      Math.random = real;
    }
  });

  it('the Worker-less async client returns the same bits as the synchronous call', async () => {
    const viaClient = await generateTerrainAsync({ seed: 1337, ...SMALL });
    expect(fingerprint(viaClient)).toEqual(fingerprint(terrain(1337)));
    const viaIndex = await asyncFromIndex({ seed: 1337, ...SMALL });
    expect(fingerprint(viaIndex)).toEqual(fingerprint(terrain(1337)));
    expect(fingerprint(generateFromIndex({ seed: 1337, ...SMALL }))).toEqual(fingerprint(terrain(1337)));
  });
});

describe('output shape', () => {
  it('refines beyond the hydraulic grid while retaining full-size finite material maps', () => {
    const stages: string[] = [];
    const d = generateTerrain({ seed: 1337, quality: 'medium' }, (stage) => {
      if (stages[stages.length - 1] !== stage) stages.push(stage);
    });
    expect(d.resolution).toBe(1024);
    expect(d.cellSize).toBe(3);
    expect(d.origin).toEqual([-1536, -1536]);
    const lastErosion = stages.lastIndexOf('Eroding slopes');
    expect(lastErosion).toBeGreaterThan(0);
    expect(stages[lastErosion + 1]).toBe('Refining terrain');
    expect(stages.slice(lastErosion + 1)).toContain('Mapping materials');
    expect(d.height).toHaveLength(1024 * 1024);
    expect(d.minHeight).toBe(0);
    expect(d.maxHeight).toBeCloseTo(220, 2);
    for (const map of Object.values(d.maps)) {
      expect(map).toHaveLength(d.height.length);
      // Aggregate checks avoid a million individual assertion objects per map.
      let valid = true;
      let nonzero = false;
      for (const v of map) {
        if (!Number.isFinite(v) || v < 0 || v > 1) valid = false;
        if (v > 0) nonzero = true;
      }
      expect(valid).toBe(true);
      expect(nonzero).toBe(true);
    }
  }, SLOW);

  it('follows the TerrainData conventions', () => {
    const d = terrain(1337);
    expect(d.seed).toBe(1337);
    expect(d.resolution).toBe(N);
    expect(d.cellSize).toBe(CELL);
    expect(d.origin).toEqual([-(N * CELL) / 2, -(N * CELL) / 2]);
    for (const a of [d.height, d.maps.soil, d.maps.flow, d.maps.deposit, d.maps.wetness]) {
      expect(a).toBeInstanceOf(Float32Array);
      expect(a.length).toBe(N * N);
    }
    const buffers = new Set([d.height.buffer, d.maps.soil.buffer, d.maps.flow.buffer, d.maps.deposit.buffer, d.maps.wetness.buffer]);
    expect(buffers.size).toBe(5);
  });

  it('has finite heights whose min and max match minHeight and maxHeight', () => {
    for (const seed of [1, 2, 1337]) {
      const d = terrain(seed);
      let lo = Infinity;
      let hi = -Infinity;
      for (const v of d.height) {
        expect(Number.isFinite(v)).toBe(true);
        lo = Math.min(lo, v);
        hi = Math.max(hi, v);
      }
      expect(d.minHeight).toBe(lo);
      expect(d.maxHeight).toBe(hi);
    }
  });

  it('rescales so the lowest point is 0 and the peak-to-valley relief is the requested one', () => {
    const d = terrain(1337);
    expect(d.minHeight).toBe(0);
    expect(d.maxHeight).toBeCloseTo(220, 2);
    const custom = generateTerrain({ seed: 3, ...SMALL, resolution: 64, relief: 90 });
    expect(custom.minHeight).toBe(0);
    expect(custom.maxHeight - custom.minHeight).toBeCloseTo(90, 3);
  });

  it('keeps every material map inside [0, 1] with no NaN or Infinity, and none of them is flat', () => {
    for (const seed of [1, 2, 1337]) {
      const d = terrain(seed);
      for (const [name, map] of Object.entries(d.maps)) {
        let lo = Infinity;
        let hi = -Infinity;
        let sum = 0;
        for (const v of map) {
          expect(Number.isFinite(v), `${name} finite`).toBe(true);
          lo = Math.min(lo, v);
          hi = Math.max(hi, v);
          sum += v;
        }
        expect(lo, `${name} min`).toBeGreaterThanOrEqual(0);
        expect(hi, `${name} max`).toBeLessThanOrEqual(1);
        expect(hi - lo, `${name} spread`).toBeGreaterThan(0.5);
        expect(sum / map.length, `${name} mean`).toBeGreaterThan(0.02);
        expect(sum / map.length, `${name} mean`).toBeLessThan(0.98);
      }
    }
  }, SLOW);

  it('only sets a lake level inside the height range, and keeps the flyable centre dry', () => {
    for (const seed of [1, 2, 7, 1337]) {
      const d = terrain(seed);
      if (d.waterLevel === -Infinity) continue;
      expect(d.waterLevel).toBeGreaterThan(d.minHeight);
      expect(d.waterLevel).toBeLessThan(d.maxHeight);
      const lo = Math.floor(0.4 * N);
      const hi = Math.ceil(0.6 * N);
      for (let j = lo; j < hi; j++) for (let i = lo; i < hi; i++) expect(d.height[j * N + i]).toBeGreaterThan(d.waterLevel);
    }
  });

  it('has no cliff or lip around the rim, even on tall terrain: the outer ring is no steeper than the ground inside it', () => {
    const step = (h: Float32Array, a: number, b: number): number => Math.abs(h[a] - h[b]) / CELL;
    for (const seed of [7, 1337]) {
      const { height: h } = generateTerrain({ seed, ...SMALL, relief: 600 });
      let rim = 0;
      let inside = 0;
      for (let k = 2; k < N - 2; k++) {
        rim = Math.max(rim, step(h, k, N + k), step(h, (N - 1) * N + k, (N - 2) * N + k), step(h, k * N, k * N + 1), step(h, k * N + N - 1, k * N + N - 2));
        rim = Math.max(rim, step(h, k, k + 1), step(h, (N - 1) * N + k, (N - 1) * N + k + 1), step(h, k * N, (k + 1) * N), step(h, k * N + N - 1, (k + 1) * N + N - 1));
        for (let i = 2; i < N - 3; i++) inside = Math.max(inside, step(h, k * N + i, k * N + i + 1), step(h, i * N + k, (i + 1) * N + k));
      }
      expect(rim, `seed ${seed}`).toBeLessThanOrEqual(inside);
    }
  });

  it('applies talus in metres: the steepest hard-rock faces stand at the rock repose angle, not a third of it', () => {
    const rock = (Math.atan(TUNING.thermal.rockTan) * 180) / Math.PI;
    for (const seed of [7, 1337]) {
      const { height: h } = bigTerrain(seed);
      let steepest = 0;
      for (let j = 1; j < BIG - 1; j++) {
        for (let i = 1; i < BIG - 1; i++) {
          const gx = (h[j * BIG + i + 1] - h[j * BIG + i - 1]) / (2 * BIG_CELL);
          const gz = (h[(j + 1) * BIG + i] - h[(j - 1) * BIG + i]) / (2 * BIG_CELL);
          steepest = Math.max(steepest, Math.atan(Math.hypot(gx, gz)));
        }
      }
      const deg = (steepest * 180) / Math.PI;
      expect(deg, `seed ${seed}`).toBeGreaterThan(rock - 6);
      expect(deg, `seed ${seed}`).toBeLessThan(rock + 5);
    }
  }, SLOW);

  it('leaves the centre of the map flat-ish and the rest of it mountainous', () => {
    for (const seed of [1, 2, 1337]) {
      const { height: h } = terrain(seed);
      let centre = 0;
      let centreCount = 0;
      let all = 0;
      let allCount = 0;
      for (let j = 1; j < N - 1; j++) {
        for (let i = 1; i < N - 1; i++) {
          const gx = (h[j * N + i + 1] - h[j * N + i - 1]) / (2 * CELL);
          const gz = (h[(j + 1) * N + i] - h[(j - 1) * N + i]) / (2 * CELL);
          const slope = Math.hypot(gx, gz);
          all += slope;
          allCount++;
          if (Math.abs(i - N / 2) < 0.1 * N && Math.abs(j - N / 2) < 0.1 * N) {
            centre += slope;
            centreCount++;
          }
        }
      }
      expect(centre / centreCount).toBeLessThan(0.14);
      expect(centre / centreCount).toBeLessThan(0.5 * (all / allCount));
    }
  });
});

describe('parameters', () => {
  it('has the documented defaults per quality and hands out copies', () => {
    expect(terrainDefaults('low')).toEqual({ resolution: 512, cellSize: 4, relief: 220 });
    expect(terrainDefaults('medium')).toEqual({ resolution: 1024, cellSize: 3, relief: 220 });
    expect(terrainDefaults('high')).toEqual({ resolution: 2048, cellSize: 2, relief: 220 });
    expect(terrainDefaults('ultra')).toEqual({ resolution: 2048, cellSize: 1.5, relief: 220 });
    const d = terrainDefaults('low');
    d.resolution = 1;
    expect(terrainDefaults('low').resolution).toBe(512);
  });

  it('rejects unusable resolutions and sizes', () => {
    const bad = (p: { resolution?: number; cellSize?: number; relief?: number }): void => {
      expect(() => generateTerrain({ seed: 1, quality: 'low', ...p })).toThrow(RangeError);
    };
    bad({ resolution: 100 });
    bad({ resolution: 16 });
    bad({ resolution: 48.5 });
    bad({ cellSize: 0 });
    bad({ cellSize: -2 });
    bad({ relief: 0 });
    bad({ relief: Number.NaN });
  });

  it('rejects bad parameters through the async client too', async () => {
    await expect(generateTerrainAsync({ seed: 1, quality: 'low', resolution: 100 })).rejects.toThrow(RangeError);
  });

  it('builds the smallest supported grid', () => {
    const d = generateTerrain({ seed: 4, quality: 'low', resolution: 32, cellSize: 40 });
    expect(d.resolution).toBe(32);
    expect(d.height).toHaveLength(32 * 32);
    for (const v of d.height) expect(Number.isFinite(v)).toBe(true);
  });
});

describe('progress reporting', () => {
  it('is monotonic, spans 0 to 1, names its stages, and never leaves a gap much larger than 2%', () => {
    const calls: Array<[string, number]> = [];
    generateTerrain({ seed: 5, ...SMALL }, (stage, fraction) => calls.push([stage, fraction]));
    expect(calls.length).toBeGreaterThan(40);
    expect(calls[0][1]).toBe(0);
    expect(calls[calls.length - 1][1]).toBe(1);
    let gap = 0;
    for (let k = 1; k < calls.length; k++) {
      expect(calls[k][1]).toBeGreaterThanOrEqual(calls[k - 1][1]);
      gap = Math.max(gap, calls[k][1] - calls[k - 1][1]);
    }
    expect(gap).toBeLessThan(0.03);
    for (const [stage, fraction] of calls) {
      expect(stage.length).toBeGreaterThan(0);
      expect(fraction).toBeGreaterThanOrEqual(0);
      expect(fraction).toBeLessThanOrEqual(1);
    }
    expect(new Set(calls.map((c) => c[0])).size).toBeGreaterThanOrEqual(5);
  });

  it('reaches the async caller as well', async () => {
    const seen: number[] = [];
    await generateTerrainAsync({ seed: 6, ...SMALL, resolution: 64 }, (_stage, fraction) => seen.push(fraction));
    expect(seen.length).toBeGreaterThan(10);
    expect(seen[seen.length - 1]).toBe(1);
  });

  it('can be driven in small steps, each a safe point to hand control back', () => {
    const gen = terrainSteps({ seed: 7, ...SMALL, resolution: 64 });
    let yields = 0;
    for (;;) {
      const r = gen.next();
      if (r.done === true) {
        expect(r.value.resolution).toBe(64);
        break;
      }
      yields++;
    }
    expect(yields).toBeGreaterThan(30);
  });
});
