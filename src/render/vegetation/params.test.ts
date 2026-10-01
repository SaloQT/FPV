import { describe, expect, it } from 'vitest';
import type { RenderQuality } from '../../contracts';
import { qualityProfile } from '../contracts';
import { BLADE_BYTES, CHUNK_SLOTS, MAX_GRASS_BYTES, PATCH_SIZE, TREE_TIER, VEG_PARAM_BYTES, annulusSlots, createParamViews, grassBudget, nearDensity, packVegParams, type VegParamInput } from './params';
import { TIER_LIMITS } from './placement';

const TIERS: RenderQuality[] = ['low', 'medium', 'high', 'ultra'];
const budgets = TIERS.map((t) => grassBudget(qualityProfile(t)));

describe('annulusSlots', () => {
  it('integrates the density over a ring exactly where the falloff is flat', () => {
    expect(annulusSlots(2, 6, 10, 100, 1000)).toBeCloseTo(Math.PI * (36 - 4) * 10, 1);
  });

  it('follows 1/d^2 beyond the full-density radius, so each octave of distance adds the same blade count', () => {
    const a = annulusSlots(10, 20, 100, 5, 1000), b = annulusSlots(20, 40, 100, 5, 1000);
    expect(b / a).toBeCloseTo(1, 1);
  });

  it('fades to nothing at the far distance', () => {
    expect(annulusSlots(99, 100, 100, 5, 100)).toBeLessThan(annulusSlots(60, 61, 100, 5, 100) * 0.2);
  });
});

describe('nearDensity', () => {
  it('puts every tier at meadow-like blade counts and keeps the tiers ordered', () => {
    const d = TIERS.map((t) => nearDensity(qualityProfile(t).grassBladesPerM2));
    expect(d[0]).toBeGreaterThanOrEqual(300);
    for (let i = 1; i < d.length; i++) expect(d[i]).toBeGreaterThan(d[i - 1]);
    expect(d[3]).toBeLessThanOrEqual(4000);
  });

  it('never scales a tier by less than 3x or more than 6x', () => {
    for (const x of [1, 60, 400, 900, 5000]) {
      const k = nearDensity(x) / x;
      expect(k).toBeGreaterThanOrEqual(3 - 1e-9);
      expect(k).toBeLessThanOrEqual(6 + 1e-9);
    }
  });
});

describe('grassBudget', () => {
  it('scales the capacities up with the quality tier', () => {
    for (let i = 1; i < TIERS.length; i++) {
      expect(budgets[i].bladeBytes).toBeGreaterThan(budgets[i - 1].bladeBytes);
      expect(budgets[i].chunkCap).toBeGreaterThan(budgets[i - 1].chunkCap);
      expect(budgets[i].distance).toBeGreaterThan(budgets[i - 1].distance);
    }
  });

  it('holds whole workgroups per LOD, laid out back to back in one buffer', () => {
    for (const b of budgets) {
      for (const c of b.caps) { expect(c % CHUNK_SLOTS).toBe(0); expect(c).toBeGreaterThan(0); }
      expect(b.offsets).toEqual([0, b.caps[0] * BLADE_BYTES, (b.caps[0] + b.caps[1]) * BLADE_BYTES]);
      expect(b.bladeBytes).toBe((b.caps[0] + b.caps[1] + b.caps[2]) * BLADE_BYTES);
      expect(b.bladeBytes).toBeLessThanOrEqual(MAX_GRASS_BYTES);
    }
  });

  it('hashes 4 m patches into a camera-centred grid that covers the view distance', () => {
    for (const [i, b] of budgets.entries()) {
      const q = qualityProfile(TIERS[i]);
      expect(b.patchSize).toBe(PATCH_SIZE);
      expect(b.cellsPerSide * b.patchSize).toBeGreaterThanOrEqual(2 * q.grassDistance + 2 * b.patchSize);
      expect(b.slotsPerPatch).toBe(nearDensity(q.grassBladesPerM2) * PATCH_SIZE * PATCH_SIZE);
      expect(b.lodDistance[0]).toBeLessThan(b.lodDistance[1]);
      expect(b.lodDistance[1]).toBeLessThan(b.distance);
    }
  });

  it('clamps to the byte limit while keeping every LOD alive and workgroup-aligned', () => {
    const q = qualityProfile('ultra');
    for (const limit of [1 << 20, 4 << 20, 32 << 20]) {
      const b = grassBudget(q, limit);
      expect(b.bladeBytes).toBeLessThanOrEqual(limit);
      for (const c of b.caps) { expect(c).toBeGreaterThanOrEqual(CHUNK_SLOTS); expect(c % CHUNK_SLOTS).toBe(0); }
    }
    expect(grassBudget(q, 1 << 30).bladeBytes).toBeLessThanOrEqual(MAX_GRASS_BYTES);
    expect(grassBudget(q, 4 << 20).bladeBytes).toBeLessThan(grassBudget(q).bladeBytes);
  });

  it('caps the full-density radius so a long view distance does not multiply the near-field cost', () => {
    for (const b of budgets) expect(b.fullRadius).toBeLessThanOrEqual(7);
  });

  it('gives the near LOD the densest packing: capacity per metre of radius falls with distance', () => {
    const b = budgets[2];
    const edges = [0, b.lodDistance[0], b.lodDistance[1], b.distance];
    const perMetre = b.caps.map((c, i) => c / (edges[i + 1] - edges[i]));
    expect(perMetre[0]).toBeGreaterThan(perMetre[2]);
  });
});

describe('TREE_TIER', () => {
  it('draws further and at higher detail as the tier rises', () => {
    for (let i = 1; i < TIERS.length; i++) {
      expect(TREE_TIER[TIERS[i]].maxDistance).toBeGreaterThan(TREE_TIER[TIERS[i - 1]].maxDistance);
      expect(TREE_TIER[TIERS[i]].lodScale).toBeGreaterThan(TREE_TIER[TIERS[i - 1]].lodScale);
    }
  });

  it('keeps the placement limits monotonic and inside the 16k-40k plant range', () => {
    for (let i = 1; i < TIERS.length; i++) {
      expect(TIER_LIMITS[TIERS[i]].plants).toBeGreaterThan(TIER_LIMITS[TIERS[i - 1]].plants);
      expect(TIER_LIMITS[TIERS[i]].rocks).toBeGreaterThan(TIER_LIMITS[TIERS[i - 1]].rocks);
    }
    expect(TIER_LIMITS.low.plants).toBe(16000);
    expect(TIER_LIMITS.ultra.plants).toBe(40000);
    expect(TIER_LIMITS.low.rocks).toBeGreaterThanOrEqual(2000);
    expect(TIER_LIMITS.ultra.rocks).toBeLessThanOrEqual(4000);
  });
});

describe('packVegParams', () => {
  const budget = grassBudget(qualityProfile('high'));
  const base: VegParamInput = {
    windDir: [3, 4], windSpeed: 6, quad: null, budget, waterLevel: 12.5, seed: 77, cameraXZ: [100.3, -250.9],
    tree: { lodScale: 1, maxDistance: 1600, minPixels: 1.5, slots: 4096, draws: 36 },
  };
  const pack = (over: Partial<VegParamInput> = {}) => {
    const v = createParamViews();
    packVegParams(v, { ...base, ...over });
    return v;
  };

  it('fills exactly the 144-byte uniform of nine vec4 blocks', () => {
    const v = createParamViews();
    expect(v.f32.byteLength).toBe(VEG_PARAM_BYTES);
    expect(v.f32.length).toBe(36);
  });

  it('normalises the wind direction, keeps the speed and survives a zero vector', () => {
    const v = pack();
    expect(v.f32[0]).toBeCloseTo(0.6, 6);
    expect(v.f32[1]).toBeCloseTo(0.8, 6);
    expect(v.f32[2]).toBe(6);
    const still = pack({ windDir: [0, 0] });
    expect(Math.hypot(still.f32[0], still.f32[1])).toBeCloseTo(1, 6);
  });

  it('parks a missing quad far below the world so prop wash never touches anything', () => {
    expect(pack().f32[5]).toBeLessThan(-1e8);
    expect(pack().f32[7]).toBe(0);
    const v = pack({ quad: { pos: [1, 2, 3], vel: [4, 5, 6], thrust: 6.5 } });
    expect(Array.from(v.f32.slice(4, 8))).toEqual([1, 2, 3, 6.5]);
    expect(Array.from(v.f32.slice(8, 11))).toEqual([4, 5, 6]);
  });

  it('describes the grass grid: patch, distances, density, and the cell the camera-centred grid starts at', () => {
    const v = pack();
    expect(v.f32[12]).toBe(budget.patchSize);
    expect(v.f32[13]).toBe(budget.distance);
    expect(v.f32[14]).toBeCloseTo(budget.fullRadius, 6);
    expect(v.f32[15]).toBeCloseTo(nearDensity(qualityProfile('high').grassBladesPerM2), 4);
    expect(v.f32[16]).toBeCloseTo(budget.lodDistance[0], 5);
    expect(v.f32[17]).toBeCloseTo(budget.lodDistance[1], 5);
    expect(v.f32[19]).toBe(budget.slotsPerPatch);
    const half = (budget.cellsPerSide * budget.patchSize) / 2;
    expect(v.i32[20]).toBe(Math.floor((100.3 - half) / budget.patchSize));
    expect(v.i32[21]).toBe(Math.floor((-250.9 - half) / budget.patchSize));
    expect(v.i32[22]).toBe(budget.cellsPerSide);
    expect(v.i32[23]).toBe(77);
    expect(Array.from(v.u32.slice(24, 28))).toEqual([...budget.caps, budget.chunkCap]);
  });

  it('snaps the grid in whole patches: small camera moves keep the cell, crossing a patch edge shifts it by one', () => {
    const a = pack({ cameraXZ: [10, 10] }), b = pack({ cameraXZ: [10.5, 10.5] });
    expect([b.i32[20], b.i32[21]]).toEqual([a.i32[20], a.i32[21]]);
    const c = pack({ cameraXZ: [10 + budget.patchSize, 10] });
    expect(c.i32[20]).toBe(a.i32[20] + 1);
    expect(c.i32[21]).toBe(a.i32[21]);
  });

  it('turns "no water" into a level nothing can be below', () => {
    expect(pack({ waterLevel: 12.5 }).f32[18]).toBe(12.5);
    expect(pack({ waterLevel: -Infinity }).f32[18]).toBeLessThan(-1e8);
    expect(pack({ waterLevel: NaN }).f32[18]).toBeLessThan(-1e8);
  });

  it('carries the tree cull parameters', () => {
    const v = pack();
    expect(Array.from(v.f32.slice(28, 31))).toEqual([1, 1600, 1.5]);
    expect([v.u32[32], v.u32[33]]).toEqual([4096, 36]);
  });
});
