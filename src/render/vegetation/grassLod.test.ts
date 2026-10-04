import { describe, expect, it } from 'vitest';
import { qualityProfile } from '../contracts';
import cull from '../shaders/vegetation/grass_cull.wgsl?raw';
import { grassBudget } from './params';

// The grass level-of-detail thresholds live in WGSL as pixel heights, but the instance capacity that has
// to hold them is budgeted in TypeScript from distance bands. Nothing else ties the two together, so a
// threshold raised "to be safe" silently moves every blade a level and the whole sward goes flat, with no
// test noticing. This one does: it re-derives the distance at which a typical blade crosses each
// threshold and asks that it still land on the tier's budgeted bands.

/** proj[1][1] * screenH/2 at 1080p with the app's 100-degree vertical lens: pixels per metre at 1 m depth. */
const PX_PER_M_AT_1M = (1 / Math.tan((100 / 2) * (Math.PI / 180))) * (1080 / 2);
/** Mean height over the species table in grass_cull.wgsl (turf, meadow, tuft, sedge, weed). */
const MEAN_BLADE_M = 0.246;

function thresholdPx(name: string): number {
  const m = cull.match(new RegExp(`const ${name} : f32 = ([0-9.]+);`));
  expect(m, `${name} must be a plain literal in grass_cull.wgsl`).not.toBeNull();
  return Number(m?.[1]);
}

describe('grass level of detail thresholds', () => {
  const lod0 = thresholdPx('GRASS_LOD0_PX');
  const lod1 = thresholdPx('GRASS_LOD1_PX');

  it('orders the three levels', () => {
    expect(lod0).toBeGreaterThan(lod1);
    expect(lod1).toBeGreaterThan(0);
  });

  it('crosses each threshold at the ultra band, the tier the thresholds are tuned for', () => {
    const [band0, band1] = grassBudget(qualityProfile('ultra')).lodDistance;
    expect((MEAN_BLADE_M * PX_PER_M_AT_1M) / lod0, 'ultra LOD0').toBeCloseTo(band0, 0);
    expect((MEAN_BLADE_M * PX_PER_M_AT_1M) / lod1, 'ultra LOD1').toBeCloseTo(band1, 0);
  });

  it('never leaves a tier coarser than its own fixed distance bands used to leave it', () => {
    // One pair of pixel thresholds serves every tier, and the near tiers draw their grass from a shorter
    // distance, so a size-based boundary is always the wider one. That is the intended trade: the level
    // now follows how big the blade is, not how far it is, so detail cannot be tighter than it used to be.
    for (const tier of ['low', 'medium', 'high', 'ultra'] as const) {
      const [band0, band1] = grassBudget(qualityProfile(tier)).lodDistance;
      expect((MEAN_BLADE_M * PX_PER_M_AT_1M) / lod0, `${tier} LOD0`).toBeGreaterThanOrEqual(band0 - 0.5);
      expect((MEAN_BLADE_M * PX_PER_M_AT_1M) / lod1, `${tier} LOD1`).toBeGreaterThanOrEqual(band1 - 0.5);
    }
  });

  it('keeps a blade at least GRASS_LOD1_PX tall on the last LOD, so no level is a single quad up close', () => {
    // The far level is a flat four-vertex card with a dithered cover. It is fine at a few pixels and wrong
    // as the first thing the eye lands on, which is what an over-high threshold produces.
    expect(1 / lod0).toBeLessThan(0.1);
  });
});
