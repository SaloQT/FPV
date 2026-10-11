import type { Vec3 } from '../../contracts';
import { MAX_PARK_PLANTINGS } from '../../world/park/planting';
import type { ParkPlanting } from '../../world/park/types';
import type { RTPrimitive } from '../contracts';
import type { InstanceSet, VegPlacement } from './placement';
import { MAX_WOOD_CAPSULES, plantCanopyShadows, plantWoodShadows } from './plantShadows';
import { VARIANT_DEFS } from './variants';

/** Both snorm16 components are -32768, which the terrain normal encoder never emits. */
export const PARK_PLANT_NORMAL = 0x80008000;
/** Explicit planted trees remain visible to the park's own draw range on every tier. */
export const PARK_PLANT_DISTANCE = 1900;

export function packPlantTint(tint: Vec3): number {
  const c = tint.map(v => Math.round(Math.max(0, Math.min(2, v)) * 127.5));
  return (c[0] | c[1] << 8 | c[2] << 16 | 128 << 24) >>> 0;
}

/** Stable explicit-plant prefix; natural forest ordering and source arrays are untouched. */
export function prependParkPlantings(forest: VegPlacement, requested: readonly ParkPlanting[] = []): { placement: VegPlacement; count: number } {
  const count = Math.min(requested.length, MAX_PARK_PLANTINGS);
  if (count === 0) return { placement: forest, count: 0 };
  const source = forest.plants, total = source.count + count;
  const plants: InstanceSet = { count: total, pos: new Float32Array(total * 3), scale: new Float32Array(total), yaw: new Float32Array(total),
    variant: new Uint8Array(total), tint: new Uint32Array(total), nrm: new Uint32Array(total), pathDist: new Float32Array(total) };
  plants.pos.set(source.pos.subarray(0, source.count * 3), count * 3);
  for (const key of ['scale', 'yaw', 'variant', 'tint', 'nrm', 'pathDist'] as const) plants[key].set(source[key].subarray(0, source.count), count);
  let trees = forest.trees, bushes = forest.bushes;
  for (let i = 0; i < count; i++) {
    const plant = requested[i];
    plants.pos.set(plant.pos, i * 3); plants.scale[i] = plant.scale; plants.yaw[i] = plant.yaw; plants.variant[i] = plant.variant;
    plants.tint[i] = packPlantTint(plant.tint); plants.nrm[i] = PARK_PLANT_NORMAL; plants.pathDist[i] = Infinity;
    if (VARIANT_DEFS[plant.variant].group === 'tree') trees++; else bushes++;
  }
  const plantRing = new Float32Array(total); plantRing.set(forest.plantRing.subarray(0, source.count), count);
  return { placement: { ...forest, plants, trees, bushes, plantRing, obstacleTrees: forest.obstacleTrees + count }, count };
}

export function tierPlantCount(placement: VegPlacement, naturalLimit: number, parkCount: number): number {
  return Math.min(placement.plants.count, naturalLimit + parkCount);
}

/** Soft Beer–Lambert canopy proxies: one to three spheres per planting, fitted to the leaves that are drawn, placed with the planting's yaw and scale. */
export function parkCanopyProxies(plantings: readonly ParkPlanting[] = []): RTPrimitive[] {
  return plantings.slice(0, MAX_PARK_PLANTINGS).flatMap(plant => plantCanopyShadows(plant.variant, plant));
}

export const MAX_PARK_WOOD_SHADOWS = MAX_WOOD_CAPSULES;

/** A bounded shadow skeleton: chords that stay within half a radius of the drawn trunk and thick limbs. The raster wood and the 24-segment physical skeleton stay intact. */
export function parkWoodProxies(plantings: readonly ParkPlanting[] = []): RTPrimitive[] {
  return plantings.slice(0, MAX_PARK_PLANTINGS).flatMap(plant => plantWoodShadows(plant.variant, plant));
}
