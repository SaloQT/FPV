import { describe, expect, it } from 'vitest';
import { isCanopyProxy } from '../rt/canopy';
import { MAX_PARK_PLANTINGS } from '../../world/park/planting';
import type { ParkPlanting } from '../../world/park/types';
import { mul, yawPoint } from '../../world/park/math';
import { MAX_PARK_WOOD_SHADOWS, PARK_PLANT_DISTANCE, PARK_PLANT_NORMAL, packPlantTint, parkCanopyProxies, parkWoodProxies, prependParkPlantings, tierPlantCount } from './parkPlanting';
import { TIER_LIMITS, type InstanceSet, type VegPlacement } from './placement';
import { MAX_CANOPY_SPHERES } from './plantShadows';
import { variantPlan } from './variants';
import { resolveShader } from '../shaderLib';

function set(n: number): InstanceSet {
  const pos = new Float32Array(n * 3); for (let i = 0; i < n; i++) pos.set([i * 5, 10, 30], i * 3);
  return { count: n, pos, scale: new Float32Array(n).fill(0.9), yaw: new Float32Array(n).fill(0.3), variant: new Uint8Array(n).fill(2), tint: new Uint32Array(n).fill(0x80808080), nrm: new Uint32Array(n), pathDist: new Float32Array(n).fill(20) };
}
function forest(): VegPlacement { return { plants: set(40000), rocks: set(2), trees: 40000, bushes: 0, obstacleTrees: 2, plantRing: new Float32Array(40000).map((_, i) => i * 0.02) }; }
const plant: ParkPlanting = { pos: [10, 12, 30], yaw: 0.4, variant: 4, scale: 0.6, tint: [0.8, 1.1, 0.9] };

describe('priority park vegetation bridge', () => {
  it('prepends exact planting transforms and retains the natural forest as an unchanged suffix', () => {
    const original = forest(), plants = [plant, { ...plant, variant: 6, pos: [20, 12, 50] as [number, number, number] }];
    const { placement: merged, count } = prependParkPlantings(original, plants);
    expect(count).toBe(2); expect(merged.plants.count).toBe(40002); expect(merged.rocks).toBe(original.rocks);
    expect([...merged.plants.pos.slice(0, 6)]).toEqual(plants.flatMap(p => p.pos));
    expect(merged.plants.scale[0]).toBe(Math.fround(plant.scale)); expect(merged.plants.yaw[0]).toBe(Math.fround(plant.yaw));
    expect(merged.plants.tint[0]).toBe(packPlantTint(plant.tint)); expect(merged.plants.nrm[0]).toBe(PARK_PLANT_NORMAL);
    expect(merged.plants.pathDist[0]).toBe(Infinity);
    expect(merged.plants.pos.slice(6)).toEqual(original.plants.pos); expect(merged.plantRing.slice(2)).toEqual(original.plantRing);
    expect(merged.trees).toBe(original.trees + 1); expect(merged.bushes).toBe(1);
    expect(original.plants.count).toBe(40000); expect(prependParkPlantings(original).placement).toBe(original);
  });

  it('retains every explicit planting on every quality tier before spending its ordinary forest budget', () => {
    const plants = Array.from({ length: MAX_PARK_PLANTINGS }, (_, i) => ({ ...plant, pos: [i, 12, 0] as [number, number, number] }));
    const { placement, count } = prependParkPlantings(forest(), plants);
    for (const limit of Object.values(TIER_LIMITS)) {
      const visible = tierPlantCount(placement, limit.plants, count);
      expect(visible).toBe(Math.min(placement.plants.count, count + limit.plants));
      expect(visible).toBeGreaterThanOrEqual(MAX_PARK_PLANTINGS);
      expect(placement.plants.pos[(MAX_PARK_PLANTINGS - 1) * 3]).toBe(MAX_PARK_PLANTINGS - 1);
    }
  });

  it('places the translucent ray-tracing canopy spheres inside the planted crown, with the planting\'s own yaw and scale', () => {
    const plan = variantPlan(plant.variant)!, proxies = parkCanopyProxies([plant, { ...plant, tint: [1.8, 0.3, 1.8] }]);
    expect(proxies.length).toBeGreaterThanOrEqual(2); expect(proxies.length).toBeLessThanOrEqual(2 * MAX_CANOPY_SPHERES); expect(proxies.every(isCanopyProxy)).toBe(true);
    const crown = yawPoint(plant.pos, plant.yaw, mul(plan.crownC, plant.scale)), reach = Math.max(...plan.crownR) * plant.scale;
    for (const canopy of proxies) {
      if (canopy.type !== 'sphere') throw new Error('Missing planted crown');
      expect(Math.hypot(canopy.center[0] - crown[0], canopy.center[1] - crown[1], canopy.center[2] - crown[2])).toBeLessThan(reach);
      expect(canopy.radius).toBeGreaterThan(0.2 * Math.min(...plan.crownR) * plant.scale);
      expect(canopy.radius).toBeLessThan(1.3 * reach);
    }
  }, 60000);

  it('keeps physical wood rigid and uses the same park draw distance in culling and shading', () => {
    const tree = resolveShader('vegetation/tree.wgsl', { LOD: 0 }), cull = resolveShader('vegetation/tree_cull.wgsl');
    for (const shader of [tree, cull]) { expect(shader).toContain(`PARK_PLANT_DISTANCE : f32 = ${PARK_PLANT_DISTANCE}.0`); expect(shader).toContain('PARK_PLANT_NORMAL : u32 = 0x80008000u'); }
    expect(tree).toContain('inst.nrm == PARK_PLANT_NORMAL && !leafKind');
    expect(tree).toContain('if (!rigidWood)');
  });

  it('bounds opaque tree shadows while retaining the exact instance and skeleton endpoints', () => {
    for (let variant = 0; variant < 8; variant++) {
      const placed = { ...plant, variant }, plan = variantPlan(variant)!, shadows = parkWoodProxies([placed]);
      expect(shadows.length).toBeLessThanOrEqual(MAX_PARK_WOOD_SHADOWS);
      if (variant >= 6) { expect(shadows).toHaveLength(0); continue; }
      expect(shadows.length).toBeGreaterThanOrEqual(3);
      const endpoints = plan.limbs.filter(limb => limb.order <= 1).flatMap(limb => limb.pts.map(p => yawPoint(placed.pos, placed.yaw, mul(p, placed.scale))));
      for (const shadow of shadows) {
        expect(isCanopyProxy(shadow)).toBe(false);
        if (shadow.type !== 'capsule') throw new Error('Wood must cast opaque capsule shadows');
        expect(endpoints).toContainEqual(shadow.a); expect(endpoints).toContainEqual(shadow.b);
        expect(shadow.radius).toBeGreaterThan(0); expect(shadow.material.metalness).toBe(0);
      }
    }
  });
});
