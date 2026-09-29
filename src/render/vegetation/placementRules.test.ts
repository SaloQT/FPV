import { describe, expect, it } from 'vitest';
import type { TerrainData } from '../../contracts';
import { MAX_SLOPE_DEG, MIN_SOIL, PlacementRules, type Pick } from './placementRules';
import { TerrainFields } from './terrainFields';
import { VARIANT_DEFS, VARIANTS_OF } from './variants';

const N = 64;
const CELL = 8;
const EXTENT = (N - 1) * CELL;

interface Ground {
  soil: number;
  wetness: number;
  flow: number;
  /** Rise over run along +X. */
  slope: number;
  base: number;
  water: number;
}

const FLAT: Ground = { soil: 0.8, wetness: 0.5, flow: 0, slope: 0, base: 20, water: -Infinity };

function terrainOf(g: Partial<Ground>): TerrainData {
  const o = { ...FLAT, ...g };
  const height = new Float32Array(N * N);
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) height[j * N + i] = o.base + o.slope * i * CELL;
  const fill = (v: number): Float32Array => new Float32Array(N * N).fill(v);
  return {
    seed: 11, resolution: N, cellSize: CELL, origin: [-EXTENT / 2, -EXTENT / 2], height,
    maps: { soil: fill(o.soil), flow: fill(o.flow), deposit: fill(0), wetness: fill(o.wetness) },
    minHeight: 0, maxHeight: 100, waterLevel: o.water,
  };
}

interface Counts {
  trees: number;
  bushes: number;
  conifers: number;
  cells: number;
}

/** Runs the plant rule over every 3 m cell of the interior. */
function plantCounts(g: Partial<Ground>, order: 1 | -1 = 1): Counts & { hits: string[] } {
  const f = new TerrainFields(terrainOf(g));
  const rules = new PlacementRules(f, 1234);
  const pick: Pick = { variant: 0, scale: 1, yaw: 0, tint: 0 };
  const out: Counts & { hits: string[] } = { trees: 0, bushes: 0, conifers: 0, cells: 0, hits: [] };
  const range = 60;
  for (let a = 0; a < 2 * range; a++) {
    const cx = order === 1 ? a - range : range - a - 1;
    for (let cz = -range; cz < range; cz++) {
      const kind = rules.plant(cx, cz, (cx + 0.5) * 3, (cz + 0.5) * 3, pick);
      out.cells++;
      if (kind === 0) continue;
      out.hits.push(`${cx},${cz},${pick.variant},${pick.scale.toFixed(4)}`);
      if (kind === 1) {
        out.trees++;
        if (pick.variant === VARIANTS_OF.spruce[0] || pick.variant === VARIANTS_OF.spruce[1] || pick.variant === VARIANTS_OF.pine[0]) out.conifers++;
      } else out.bushes++;
    }
  }
  return out;
}

function rockCounts(g: Partial<Ground>): { rocks: number; minScale: number; maxScale: number; variants: Set<number> } {
  const f = new TerrainFields(terrainOf(g));
  const rules = new PlacementRules(f, 1234);
  const pick: Pick = { variant: 0, scale: 1, yaw: 0, tint: 0 };
  const out = { rocks: 0, minScale: Infinity, maxScale: 0, variants: new Set<number>() };
  for (let cx = -60; cx < 60; cx++) {
    for (let cz = -60; cz < 60; cz++) {
      if (!rules.rock(cx, cz, (cx + 0.5) * 4, (cz + 0.5) * 4, pick)) continue;
      out.rocks++;
      out.minScale = Math.min(out.minScale, pick.scale);
      out.maxScale = Math.max(out.maxScale, pick.scale);
      out.variants.add(pick.variant);
    }
  }
  return out;
}

describe('PlacementRules.plant', () => {
  it('plants both trees and bushes on flat, deep, dry-land soil', () => {
    const c = plantCounts({});
    expect(c.trees).toBeGreaterThan(500);
    expect(c.bushes).toBeGreaterThan(50);
    expect(c.trees + c.bushes).toBeLessThan(c.cells);
  });

  it('is a pure function of the cell: visiting in another order gives the same plants', () => {
    const a = plantCounts({}, 1), b = plantCounts({}, -1);
    expect(a.hits.length).toBeGreaterThan(500);
    expect([...b.hits].sort()).toEqual([...a.hits].sort());
  });

  it(`refuses soil at or below ${MIN_SOIL} and accepts it just above`, () => {
    expect(plantCounts({ soil: MIN_SOIL }).hits.length).toBe(0);
    expect(plantCounts({ soil: 0.1 }).hits.length).toBe(0);
    expect(plantCounts({ soil: MIN_SOIL + 0.05 }).hits.length).toBeGreaterThan(0);
  });

  it(`refuses slopes of ${MAX_SLOPE_DEG} degrees and more, thins them below that`, () => {
    const steep = Math.tan(((MAX_SLOPE_DEG + 1) * Math.PI) / 180);
    expect(plantCounts({ slope: steep }).hits.length).toBe(0);
    const gentle = plantCounts({ slope: 0.15 }).hits.length, moderate = plantCounts({ slope: 0.45 }).hits.length;
    expect(moderate).toBeGreaterThan(0);
    expect(gentle).toBeGreaterThan(moderate);
    expect(gentle).toBeLessThanOrEqual(plantCounts({}).hits.length);
  });

  it('keeps 0.8 m of dry ground above the water and nothing in river channels', () => {
    expect(plantCounts({ water: FLAT.base - 0.5 }).hits.length).toBe(0);
    expect(plantCounts({ water: FLAT.base - 0.79 }).hits.length).toBe(0);
    expect(plantCounts({ water: FLAT.base - 5 }).hits.length).toBeGreaterThan(500);
    expect(plantCounts({ flow: 0.9 }).hits.length).toBe(0);
    expect(plantCounts({ flow: 0.75 }).hits.length).toBeLessThan(plantCounts({ flow: 0 }).hits.length * 0.8);
  });

  it('stops at the tree line, which sits between 56% and 76% of the height range', () => {
    expect(plantCounts({ base: 88 }).hits.length).toBe(0);
    expect(plantCounts({ base: 77 }).hits.length).toBe(0);
    expect(plantCounts({ base: 45 }).hits.length).toBeGreaterThan(100);
  });

  it('grows more on wet ground', () => {
    const dry = plantCounts({ wetness: 0 }), wet = plantCounts({ wetness: 1 });
    expect(wet.hits.length).toBeGreaterThan(dry.hits.length * 1.5);
  });

  it('shifts from broadleaf in the lowlands to conifers up the mountain', () => {
    const low = plantCounts({ base: 3 }), high = plantCounts({ base: 55 });
    expect(low.trees).toBeGreaterThan(50);
    expect(high.trees).toBeGreaterThan(50);
    expect(low.conifers / low.trees).toBeLessThan(0.35);
    expect(high.conifers / high.trees).toBeGreaterThan(0.65);
  });

  it('draws plausible sizes and species for every pick', () => {
    const f = new TerrainFields(terrainOf({}));
    const rules = new PlacementRules(f, 5);
    const pick: Pick = { variant: 0, scale: 1, yaw: 0, tint: 0 };
    let checked = 0;
    for (let cx = -60; cx < 60; cx++) {
      for (let cz = -60; cz < 60; cz++) {
        const kind = rules.plant(cx, cz, (cx + 0.5) * 3, (cz + 0.5) * 3, pick);
        if (kind === 0) continue;
        checked++;
        const def = VARIANT_DEFS[pick.variant];
        expect(def.group).toBe(kind === 1 ? 'tree' : 'bush');
        expect(pick.scale).toBeGreaterThan(kind === 1 ? 0.45 : 0.55);
        expect(pick.scale).toBeLessThan(kind === 1 ? 1.35 : 1.65);
        expect(pick.yaw).toBeGreaterThanOrEqual(0);
        expect(pick.yaw).toBeLessThan(2 * Math.PI + 1e-9);
        expect(pick.tint >>> 24).toBe(128);
      }
    }
    expect(checked).toBeGreaterThan(500);
  });
});

describe('PlacementRules.rock', () => {
  it('finds few rocks on flat, soily ground and many on steep or bare ground', () => {
    const flat = rockCounts({}), steep = rockCounts({ slope: 0.7 }), bare = rockCounts({ soil: 0.1 });
    expect(steep.rocks).toBeGreaterThan(flat.rocks * 4);
    expect(bare.rocks).toBeGreaterThan(flat.rocks * 4);
    expect(steep.rocks).toBeGreaterThan(1000);
  });

  it('follows stream beds but not the channels themselves, and never in water', () => {
    const dry = rockCounts({}), stream = rockCounts({ flow: 0.5 }), river = rockCounts({ flow: 0.95 });
    expect(stream.rocks).toBeGreaterThan(dry.rocks * 3);
    expect(river.rocks).toBe(0);
    expect(rockCounts({ soil: 0.1, water: FLAT.base }).rocks).toBe(0);
  });

  it('draws radii from 0.3 m to 4 m with mostly small stones', () => {
    const r = rockCounts({ slope: 0.7 });
    expect(r.minScale).toBeGreaterThanOrEqual(0.3);
    expect(r.maxScale).toBeLessThanOrEqual(4);
    expect(r.maxScale).toBeGreaterThan(1.5);
  });

  it('picks shapes by ground: tall chunks on cliffs, slabs on bare ground, round boulders in streams', () => {
    const steep = rockCounts({ slope: 0.7 }), bare = rockCounts({ soil: 0.1 }), stream = rockCounts({ flow: 0.5 });
    expect([...steep.variants].sort((a, b) => a - b)).toEqual([VARIANTS_OF.rock[0], VARIANTS_OF.rock[3]]);
    expect([...bare.variants].sort((a, b) => a - b)).toEqual([VARIANTS_OF.rock[0], VARIANTS_OF.rock[2]]);
    expect([...stream.variants].sort((a, b) => a - b)).toEqual([VARIANTS_OF.rock[1], VARIANTS_OF.rock[2]]);
    for (const v of new Set([...steep.variants, ...bare.variants, ...stream.variants])) expect(VARIANT_DEFS[v].group).toBe('rock');
  });
});
