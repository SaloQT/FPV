import { describe, expect, it } from 'vitest';
import { qualityProfile, type QualityProfile } from '../contracts';
import { performanceProfile } from '../qualityPresets';
import { FAR_TIER } from './params';
import { TIER_LIMITS } from './placement';
import { diffPlans, vegPlan } from './placementPlan';

const tiers = ['low', 'medium', 'high', 'ultra'] as const;

describe('vegPlan', () => {
  it('reads the caps of the tier and the grass and view distance of the live profile', () => {
    const q = qualityProfile('medium');
    expect(vegPlan(q)).toEqual({
      grassBladesPerM2: q.grassBladesPerM2, grassDistance: q.grassDistance, plants: TIER_LIMITS.medium.plants, rocks: TIER_LIMITS.medium.rocks,
      farCards: FAR_TIER.medium.cards, farDistance: q.terrainViewDistance,
    });
  });

  it('gives every tier more of everything than the one below', () => {
    for (let i = 1; i < tiers.length; i++) {
      const a = vegPlan(qualityProfile(tiers[i - 1])), b = vegPlan(qualityProfile(tiers[i]));
      for (const k of ['grassBladesPerM2', 'grassDistance', 'plants', 'rocks', 'farCards', 'farDistance'] as const) expect(b[k]).toBeGreaterThan(a[k]);
    }
  });
});

describe('diffPlans', () => {
  const high = vegPlan(qualityProfile('high'));

  it('rebuilds everything the first time and nothing when the plan is unchanged', () => {
    expect(diffPlans(null, high)).toEqual({ grass: true, trees: true, far: true });
    expect(diffPlans(high, { ...high })).toEqual({ grass: false, trees: false, far: false });
  });

  it('sees the Performance 240 preset, which keeps the tier but thins the grass: grass only', () => {
    const perf = vegPlan(performanceProfile(qualityProfile('high')));
    expect(perf.grassBladesPerM2).toBeLessThan(high.grassBladesPerM2);
    expect(diffPlans(high, perf)).toEqual({ grass: true, trees: false, far: false });
    expect(diffPlans(perf, high)).toEqual({ grass: true, trees: false, far: false });
  });

  it('rebuilds grass for a change of density or distance alone, whatever the tier says', () => {
    const q: QualityProfile = qualityProfile('low');
    const base = vegPlan(q);
    expect(diffPlans(base, vegPlan({ ...q, grassBladesPerM2: q.grassBladesPerM2 + 1 }))).toEqual({ grass: true, trees: false, far: false });
    expect(diffPlans(base, vegPlan({ ...q, grassDistance: q.grassDistance + 1 }))).toEqual({ grass: true, trees: false, far: false });
  });

  it('rebuilds the trees and the far cards on a change of instance caps, and only the far cards on a change of view distance', () => {
    expect(diffPlans(high, { ...high, plants: high.plants + 1 })).toEqual({ grass: false, trees: true, far: true });
    expect(diffPlans(high, { ...high, rocks: high.rocks + 1 })).toEqual({ grass: false, trees: true, far: false });
    expect(diffPlans(high, { ...high, farCards: high.farCards + 1 })).toEqual({ grass: false, trees: false, far: true });
    expect(diffPlans(high, { ...high, farDistance: high.farDistance + 1 })).toEqual({ grass: false, trees: false, far: true });
  });

  it('rebuilds all three across a tier change', () => {
    for (let i = 1; i < tiers.length; i++) {
      expect(diffPlans(vegPlan(qualityProfile(tiers[i - 1])), vegPlan(qualityProfile(tiers[i])))).toEqual({ grass: true, trees: true, far: true });
    }
  });
});
