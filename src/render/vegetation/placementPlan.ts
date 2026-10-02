import type { QualityProfile } from '../contracts';
import { FAR_TIER } from './params';
import { TIER_LIMITS } from './placement';

/**
 * Everything the vegetation module sizes GPU buffers by. Compared every frame against the quality profile in force, so a live change of
 * the grass density or distance (the Performance 240 preset keeps the tier but cuts both) rebuilds what depends on it, not only a tier change.
 */
export interface VegPlan {
  grassBladesPerM2: number;
  grassDistance: number;
  /** Instance caps of the real trees and bushes and of the rocks. */
  plants: number;
  rocks: number;
  /** Canopy cards standing in for trees beyond the real-tree draw distance, and the distance they are placed and drawn to (m). */
  farCards: number;
  farDistance: number;
}

export interface VegRebuild {
  grass: boolean;
  trees: boolean;
  far: boolean;
}

export function vegPlan(q: Pick<QualityProfile, 'tier' | 'grassBladesPerM2' | 'grassDistance' | 'terrainViewDistance'>): VegPlan {
  const limits = TIER_LIMITS[q.tier];
  return {
    grassBladesPerM2: q.grassBladesPerM2,
    grassDistance: q.grassDistance,
    plants: limits.plants,
    rocks: limits.rocks,
    farCards: FAR_TIER[q.tier].cards,
    farDistance: q.terrainViewDistance,
  };
}

/**
 * What must be rebuilt to go from plan `a` (null: nothing built yet) to `b`. The far cards depend on the tree cap too: which ground the
 * real trees leave bare is the ground they stand in for.
 */
export function diffPlans(a: VegPlan | null, b: VegPlan): VegRebuild {
  if (!a) return { grass: true, trees: true, far: true };
  const trees = a.plants !== b.plants || a.rocks !== b.rocks;
  return {
    grass: a.grassBladesPerM2 !== b.grassBladesPerM2 || a.grassDistance !== b.grassDistance,
    trees,
    far: a.plants !== b.plants || a.farCards !== b.farCards || a.farDistance !== b.farDistance,
  };
}
